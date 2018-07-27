var _ = require('lodash');
var async = require('async-chainable');

/**
* Factory function to create a autoIndexer instance populated with settings
* @param {Object} [options] Optional settings to pass to the plugin
* @param {number} [indexThrottle=1000*60] How often in milliseconds to throttle index queries
* @param {boolean} [indexResetOnBuild=true] Whether to reset the index cache when building a new index
* @param {boolean} [indexCreateErrors=false] Pass on index creation errors to the intial query handler, if false creation errors are ignored
* @param {boolean} [sortIndexes=false] Sort the created indexes alphabetically, this is easier to read but has a slight performance hit
* @returns {function} Monoxide compatible plugin function
*
* @emits autoIndexer.query Fired as (indexes) whenever a query is initiated from a model and the indexable fields have been extracted
* @emits autoIndexer.build Fired as (index, mongoIndexes) whenever an index is about to be created
*/
module.exports = function(options) {
	var settings = _.defaults(options, {
		sortIndexes: false,
		indexThrottle: 1000 * 60, // Every 1m
		indexResetOnBuild: true,
		ignoreCreateErrors: false,
	});

	return function(finish, monoxide) {
		_(monoxide.models)
			.forEach(model => model.hook('query', (done, q) => {
				async()
					// Determine indexes {{{
					.then('indexes', function(next) {
						var indexes = [];

						// Query fields {{{
						var fields = _(q)
							.pickBy((criteria, field) => !field.startsWith('$'))
							.keys()
							.value();

						if (fields.length) indexes.push(fields);
						// }}}
						// Sort {{{
						if (q.$sort) indexes.push(q.$sort);
						// }}}

						if (!indexes.length) return next('SKIP');

						// Sort all index collections {{{
						if (settings.sortIndexes) {
							indexes = _(indexes)
								.map(i => i.sort())
								.sortBy(i => i.join(','))
								.value();
						}
						// }}}

						next(null, indexes);
					})
					// }}}
					// Fire event autoIndexer.query {{{
					.then(function(next) {
						model.fire('autoIndexer.query', ()=> next(), this.indexes);
					})
					// }}}
					// Scoop existing indexes (with a throttle) {{{
					.then('existingIndexes', function(next) {
						// FIXME: The caching function here doesn't seem to be working - MC 2018-07-26
						if (!model.aiIndexCache || model.aiIndexCache.created < Date.now() - settings.indexThrottle) { // Query indexes now
							model.getIndexes((err, indexes) => {
								if (err) return next(err);
								model.aiIndexCache = {
									created: Date.now(),
									indexes,
								};
								next(null, indexes);
							});
						} else { // Use existing index cache
							next(null, model.aiIndexCache.indexes);
						}
					})
					// }}}
					// Create the missing indexes {{{
					.forEach('indexes', function(next, index) {
						// Build Mongo's Object style index spec
						var mongoSpec = _(index)
							.mapKeys()
							.mapValues(k => k.startsWith('-') ? -1 : 1)
							.mapKeys((v, k) => _.trimStart(k, '-'))
							.value()

						if (!this.existingIndexes.some(i => _.isEqual(i.key, mongoSpec))) {
							model.fire('autoIndexer.build', function(err) {
								if (err) return next(err);
								model.$mongoModel.createIndex(mongoSpec, function(err) {
									if (settings.ignoreCreateErrors) return next();
									if (err) return next(err);
									if (settings.indexResetOnBuild) delete model.aiIndexCache; // Remove cached indexes when adding an index
									next();
								});
							}, index, mongoSpec);
						} else { // Index already exists - skip
							next();
						}
					})
					// }}}
					.end(function(err) {
						if (err && err === 'SKIP') {
							done();
						} else if (err) {
							done(err);
						} else {
							done();
						}
					});
			}));

		return finish();
	};
};
