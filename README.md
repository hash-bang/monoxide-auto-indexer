Monoxide-Auto-Indexer
=====================
Plugin for Monoxide to automatically manage MongoDB indexes.

```javascript
var monoxide = require('monoxide');
var monoxideAutoIndexer = require('monoxide-auto-indexer');

monoxide
	.connect('mongodb://localhost/monoxide-test')
	.use(monoxideAutoIndexer())
	.models.users.hook('autoIndexer.build', (hookDone, index) => {
		console.log('Created index', index);
		hookDone();
	});
```

See the [testkit](test/) for more complex examples.


API
===

AutoIndxer (main module)
------------------------
The module exports a function factory which can take the following settings:

| Setting             | Type     | Default                | Description                                                                                       |
|---------------------|----------|------------------------|---------------------------------------------------------------------------------------------------|
| `modelFilter`       | Function | (accepts all models)   | Function to filter collections / models - by default all are used                                 |
| `indexThrottle`     | Number   | `1000*60` (60 seconds) | How often in milliseconds to throttle index queries                                               |
| `indexResetOnBuild` | Boolean  | `true`                 | Whether to reset the index cache when building a new index                                        |
| `indexCreateErrors` | Boolean  | `false`                | Pass on index creation errors to the initial query handler, if false creation errors are ignored  |
| `sortIndexes`       | Boolean  | `false`                | Sort the created indexes alphabetically, this is easier to read but has a slight performance hit  |

Emits `autoIndexer.query` (as `(indexes)`) when querying an index and `autoIndexer.build` (as `(index, mongoSpec)`) when building a new index.



AutoIndexer.clean()
-------------------
Utility function to remove unused indexes.
Ideally this function should be called at an hour the system is not under load.

This function can take the following settings:


| Setting               | Type       | Default                     | Description                                                                                        |
|-----------------------|------------|-----------------------------|----------------------------------------------------------------------------------------------------|
| `modelFilter`         | Function   | (accepts all models)        | Function to filter collections / models - by default all are used                                  |
| `indexFilter`         | Function   | (rejects only `_id` fields) | Function to filter index selection from cleaning                                                   |
| `dryRun`              | Boolean    | `false`                     | Don't actually remove indexes, just report on what would be removed                                |
| `hitMin`              | Number     | `100`                       | The minimum number of hits for an index to be retained                                             |


Emits `autoIndexer.clean` with the single argument being the index that will be removed.
