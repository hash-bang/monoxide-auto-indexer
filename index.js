var _ = require('lodash');
var async = require('async-chainable');
var debug = require('debug')('monoxide-auto-indexer');
var monoxide = require('monoxide');


/**
* Function to clean up unused indexes
* @param {Object} [options] Optional settings to pass to the cleaner
* @param {function} [options.modelFilter=()=>true] Function to filter collections / models - by default all are used
* @param {array|function} [options.indexFilter] Function (or array of functions) filter for indexes, by default this omits only `_id` fields and skips manually specified indexes if `ignoreManualSpec` is true
* @param {boolean} [options.dryRun=false] Dont actually remove indexes, just report on what would be removed
* @param {number} [options.hitMin=100] The minimum number of hits for an index to be retained
* @param {boolean} [options.ignoreErrors=true] Dont return a callback for index removal errors
* @param {boolean} [options.ignoreManualSpec=true] Dont try to clean indexes where the schema manually specifies that `{index:true}` or some variation thereof
* @param {function} [finish] Optional callback to call when cleaning completes
*
* @emits autoIndexer.consider Fired as (indexs) when a list of indexes to consider is available
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
		indexFilter: [
			index => ! _.isEqual(_.keys(index.spec), ['_id']), // Ignore _id fields
			index => {
				if (!settings.ignoreManualSpec) return true; // Manual spec ignore is disabled - assume passthrough

				var indexMeta = _.get(index.meta, index.path);
				if (!indexMeta) {
					debug('Cannot find path spec for', index.path, 'in model', index.model.$collection, 'when cleaning indexes, assuming this can be removed');
					return true;
				} else if (indexMeta.index) {
					debug('Filtering out manually indexed path', index.id);
					return false;
				} else { // Cannot find a meta spec and its not manually specified, consider this for cleaning
					return true;
				}
			},
		],
		ignoreErrors: true,
		ignoreManualSpec: true,
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
					path: _(i.key).keys().first(),
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
		// Extract meta information about model (if settings.ugnoreManualSpec) {{{
		.then(function(next) {
			if (!settings.ignoreManualSpec) return next();

			async()
				.set('meta', {})
				.set('models', _(this.indexes) // Prepare a list of models we need to examine
					.map(i => i.model)
					.uniqBy(i => i.$collection)
					.value()
				)
				// Ask each model for its meta spec {{{
				.forEach('models', function(next, model) {
					model.meta({$indexes: true}, (err, meta) => {
						if (err) return next(err);
						this.meta[model.$collection] = meta;
						next();
					});
				})
				// }}}
				// Glue the meta information to the index {{{
				.forEach(this.indexes, function(next, index) {
					index.meta = this.meta[index.model.$collection];
					next();
				})
				// }}}
				.end(next);
		})
		// }}}
		// Fire emitter about indexes we found {{{
		.then(function(next) {
			monoxide.fire('autoIndexer.consider', next, this.indexes);
		})
		// }}}
		// Apply filters {{{
		.then('indexes', function(next) {
			next(null, this.indexes
				// Filter by settings.indexFilter {{{
				.filter(i => {
					if (settings.indexFilter && _.isFunction(settings.indexFilter)) {
						return settings.indexFilter.call(i, i);
					} else if (settings.indexFilter && _.isArray(settings.indexFilter)) {
						return settings.indexFilter.every(test => test.call(i, i));
					} else { // No filters - assume true
						return true;
					}
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
			monoxide.fire('autoIndexer.clean', ()=> {}, index);
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
* @emits autoIndexer.build Fired as (model, index, mongoSpec) whenever an index is about to be created
* @emits autoIndexer.postBuild Fired as (model, index, mongoSpec, err) whenever an index has been created
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
					.parallel({
						// Determine indexes {{{
						indexes: function(next) {
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
						},
						// }}}
						// Scoop existing indexes (with a throttle) {{{
						existingIndexes: function(next) {
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
						},
						// }}}
						// Ask for model spec {{{
						meta: function(next) {
							model.meta(next);
						},
						// }}}
					})
					// Filter indexes for ones that make absolutely no sense - such as arrays or objects {{{
					.then('indexes', function(next) {
						return next(null,
							this.indexes
								.filter(indexes => indexes.every(index => {
									var spec = this.meta[index];
									if (!spec) return true; // Cannot find a spec object
									return (!['object', 'array'].includes(spec.type)) // Only return if the index type is not on a blacklist
								}))
						);
					})
					// }}}
					// Fire event autoIndexer.query {{{
					.then(function(next) {
						model.fire('autoIndexer.query', ()=> next(), this.indexes);
					})
					// }}}
					// Create the missing indexes {{{
					.forEach('indexes', function(next, index) {
						var mongoSpec = _(index)
							.mapKeys()
							.mapValues(k => k.startsWith('-') ? -1 : 1)
							.mapKeys((v, k) => _.trimStart(k, '-'))
							.value();

						var isExisting = this.existingIndexes.some(i => _.isEqual(i.key, mongoSpec))

						if (isExisting) return next();

						async()
							// Fire: autoIndexer.preBuild {{{
							.then(function(next) {
								model.fire('autoIndexer.build', ()=> next(), model, index, mongoSpec);
							})
							// }}}
							// Create the index {{{
							.then('buildResult', function(next) {
								model.$mongoModel.createIndex(mongoSpec) // For some reason createIndex() doesn't return an error to the callback so we have to use promises
									.then(()=> {
										if (settings.indexResetOnBuild) delete model.aiIndexCache; // Remove cached indexes when adding an index
										next();
									})
									.catch(err => {
										if (settings.ignoreCreateErrors) return next();
										return next(null, err.toString()); // Pass error as parameter return so the postBuild hook can read it
									});
							})
							// }}}
							// Fire: autoIndexer.preBuild {{{
							.then(function(next) {
								model.fire('autoIndexer.postBuild', next, model, index, mongoSpec, this.buildResult);
							})
							// }}}
							.end(next);
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

		finish();
	};
};
