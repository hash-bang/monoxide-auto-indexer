var _ = require('lodash');
var async = require('async-chainable');

/**
* Factory function to create a autoIndexer instance populated with settings
* @param {Object} [options] Optional settings to pass to the plugin
* @returns {function} Monoxide compatible plugin function
*
* @emits autoIndexer.query Fired whenever a query is initiated from a model and the indexable fields have been extracted. Fired as (indexes)
*/
module.exports = function(options) {
	var settings = _.defaults(options, {
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

						if (fields.length) indexes = indexes.concat(fields);
						// }}}
						// Sort {{{
						if (q.$sort) indexes = indexes.concat(q.$sort);
						// }}}
						// Sort all keys {{{
						indexes.sort();
						// }}}

						next(null, indexes);
					})
					// }}}
					// Fire event autoIndexer.query {{{
					.then(function(next) {
						model.fire('autoIndexer.query', undefined, this.indexes);
					})
					// }}}
					// Scoop existing indexes (with a throttle) {{{
					.then('existingIndexes', function(next) {
						model.getIndexes(next);
					})
					// }}}
					// Create the index {{{
					.then(function(next) {
						// model.$mongoModel.createIndex
						console.log('BUILD',
							_(this.indexes)
								.mapKeys()
								.mapValues(k => k.startsWith('-') ? -1 : 1)
								.mapKeys((v, k) => _.trimStart(k, '-'))
								.value()
						);
					})
					// }}}
					.end(done);
			}));

		return finish();
	};
};
