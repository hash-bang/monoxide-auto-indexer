var _ = require('lodash');
var async = require('async-chainable');
var monoxide = require('monoxide');


/**
* Function to clean up unused indexes
* @param {Object} [options] Optional settings to pass to the cleaner
* @param {function} [options.modelFilter=()=>true] Function to filter collections / models - by default all are used
* @param {function} [options.indexFilter] Filter for indexes, by default this omits only `_id` fields
* @param {boolean} [options.dryRun=false] Dont actually remove indexes, just report on what would be removed
* @param {number} [options.hitMin=100] The minimum number of hits for an index to be retained
* @param {function} [finish] Optional callback to call when cleaning completes
*
* @emits autoIndexer.clean Fired as (index) when an index is cleaned based on the cleaning criteria
*/
var cleanIndexes = function(options, finish) {
	// Argument mangling {{{
	if (_.isFunction(options)) { // Called as (callback)
		[options, finish] = [{}, options];
	}
	// }}}

	var settings = _.defaults(options, {
		modelFilter: model => true,
		indexFilter: index => ! _.isEqual(_.keys(index.spec), ['_id']),
		ignoreErrors: true,
		dryRun: false,
		hitMin: 100,
	});

	async()
		// Extract indexes stats from models {{{
		.map('indexes', monoxide.models, function(next, model, modelId) {
			if (!settings.modelFilter(modelId)) return next();
			model.$mongoModel.aggregate({$indexStats: {}}, (err, indexes) => {
				if (err) return next(err);
				next(null, indexes.map(i => ({
					id:
						modelId
						+ '.'
						+ (
							_.keys(i.key).length == 1
								? (_.isEqual(_.values(i.key), [-1]) ? '-' : '') + _.keys(i.key)[0]
								: '{' + _(i.key).map((v, k) => v == 1 ? k : '-' + k).join(',') + '}'
						),
					model: model,
					spec: i.key,
					hits: i.accesses.ops,
					since: i.accesses.since,
				})));
			});
		})
		// }}}
		// Flatten indexes {{{
		.then('indexes', function(next) {
			next(null, _(this.indexes)
				.values()
				.flatten()
				.value()
			);
		})
		// }}}
		// Apply filters {{{
		.then('indexes', function(next) {
			next(null, this.indexes
				// Filter by settings.indexFilter {{{
				.filter(i => {
					if (settings.indexFilter) return settings.indexFilter.call(i, i);
					return true;
				})
				// }}}
				// Filter by hits {{{
				.filter(i => {
					if (settings.hitMin && i.hits < settings.hitMin) return true;
					return false;
				})
				// }}}
			);
		})
		// }}}
		// Remove the candidate indexes {{{
		.forEach('indexes', function(next, index) {
			index.model.fire('autoIndexer.clean', ()=> {}, index);
			if (settings.dryRun) return next();
			index.model.$mongoModel.dropIndex(index.spec, (err) => {
				if (settings.ignoreErrors) return next();
				if (err) return next(err);
				next();
			});
		})
		// }}}
		.end(finish);
};


/**
* Factory function to create a autoIndexer instance populated with settings
* @param {Object} [options] Optional settings to pass to the plugin
* @param {function} [options.modelFilter=()=>true] Function to filter collections / models - by default all are used
* @param {number} [options.indexThrottle=1000*60] How often in milliseconds to throttle index queries
* @param {boolean} [options.indexResetOnBuild=true] Whether to reset the index cache when building a new index
* @param {boolean} [options.indexCreateErrors=false] Pass on index creation errors to the intial query handler, if false creation errors are ignored
* @param {boolean} [options.sortIndexes=false] Sort the created indexes alphabetically, this is easier to read but has a slight performance hit
* @returns {function} Monoxide compatible plugin function
*
* @emits autoIndexer.query Fired as (indexes) whenever a query is initiated from a model and the indexable fields have been extracted
* @emits autoIndexer.build Fired as (index, mongoSpec) whenever an index is about to be created
*/
module.exports = function(options) {
	var settings = _.defaults(options, {
		modelFilter: model => true,
		indexThrottle: 1000 * 60, // Every 1m
		indexResetOnBuild: true,
		ignoreCreateErrors: false,
		sortIndexes: false,
	});

	return function(finish, monoxide) {
		// Glue index cleaner to main Monoxide model
		monoxide.cleanIndexes = cleanIndexes;

		_(monoxide.models)
			.pickBy((modelSpec, id) => settings.modelFilter(id))
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

		if (_.isFunction(finish)) return finish();
	};
};
