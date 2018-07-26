var _ = require('lodash');

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

				model.fire('autoIndexer.query', null, indexes);
				done();
			}));

		return finish();
	};
};
