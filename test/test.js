var _ = require('lodash');
var expect = require('chai').expect;
var monoxide = require('monoxide');
var testSetup = require('./setup');

describe('monoxide-auto-indexer', function() {
	before(testSetup.init);
	after(testSetup.teardown);
	afterEach('clear all hooks', done => {
		_(monoxide.models).forEach(model => {
			model.$hooks = _.omitBy(model.$hooks, (v, k) => k.startsWith('autoIndexer.'));
		});
		done();
	});

	it('should correctly identify when to create indexes (no indexing)', function(done) {
		var hookCalls = {};
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				hookCalls['autoIndexer.query'] = indexes;
				hookDone();
			})
			.hook('autoIndexer.build', _.once(()=> done('should not actually build anything')))
			.find()
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(2);

				expect(hookCalls).to.deep.equal({});

				done();
			});
	});


	it('should correctly identify when to create indexes (name [via sort])', function(done) {
		var hookCalls = {};
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				hookCalls['autoIndexer.query'] = indexes;
				hookDone();
			})
			.hook('autoIndexer.build', (hookDone, index, mongoSpec) => {
				hookCalls['autoIndexer.build'] = {index, mongoSpec};
				hookDone();
			})
			.find()
			.sort('name')
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(2);

				expect(hookCalls['autoIndexer.query']).to.be.deep.equal([['name']]);
				expect(hookCalls['autoIndexer.build']).to.be.deep.equal({
					index: ['name'],
					mongoSpec: {name: 1},
				});

				done();
			});
	});


	it('should have created the index {name: 1}', done => {
		monoxide.models.users.getIndexes((err, indexes) => {
			expect(err).to.not.be.ok;
			expect(indexes).to.satisfy(indexes => indexes.some(i => _.isEqual(i.key, {name: 1})));
			done();
		});
	});


	it('should correctly identify when to create indexes (role [via sort])', function(done) {
		var hookCalls = {};
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				hookCalls['autoIndexer.query'] = indexes;
				hookDone();
			})
			.hook('autoIndexer.build', _.once(()=> done('should not actually build anything')))
			.find()
			.sort('role')
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(2);

				expect(hookCalls['autoIndexer.query']).to.be.deep.equal([['role']]);

				done();
			});
	});


	it('should correctly identify when to create indexes (-name [via sort])', function(done) {
		var hookCalls = {};
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				hookCalls['autoIndexer.query'] = indexes;
				hookDone();
			})
			.hook('autoIndexer.build', (hookDone, index, mongoSpec) => {
				hookCalls['autoIndexer.build'] = {index, mongoSpec};
				hookDone();
			})
			.find()
			.sort('-name')
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(2);

				expect(hookCalls['autoIndexer.query']).to.be.deep.equal([['-name']]);
				expect(hookCalls['autoIndexer.build']).to.be.deep.equal({
					index: ['-name'],
					mongoSpec: {name: -1},
				});

				done();
			});
	});

	it('should have created the index {name: -1}', done => {
		monoxide.models.users.getIndexes((err, indexes) => {
			expect(err).to.not.be.ok;
			expect(indexes).to.satisfy(indexes => indexes.some(i => _.isEqual(i.key, {name: -1})));
			done();
		});
	});


	it('should correctly identify when to create indexes (name + role [via query])', function(done) {
		var hookCalls = {};

		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				hookCalls['autoIndexer.query'] = indexes;
				hookDone();
			})
			.hook('autoIndexer.build', (hookDone, index, mongoSpec) => {
				hookCalls['autoIndexer.build'] = {index, mongoSpec};
				hookDone();
			})
			.find({
				name: 'Joe Random',
				role: 'user',
			})
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(1);

				expect(hookCalls['autoIndexer.query']).to.be.deep.equal([['name', 'role']]);
				expect(hookCalls['autoIndexer.build']).to.be.deep.equal({
					index: ['name', 'role'],
					mongoSpec: {name: 1, role: 1},
				});

				done();
			});
	});


	it('should have created the index {name: 1, role: 1}', done => {
		monoxide.models.users.getIndexes((err, indexes) => {
			expect(err).to.not.be.ok;
			expect(indexes).to.satisfy(indexes => indexes.some(i => _.isEqual(i.key, {name: 1, role: 1})));
			done();
		});
	});


	it('should correctly identify when to create indexes (name [via sort], role [via query])', function(done) {
		var hookCalls = {};
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				hookCalls['autoIndexer.query'] = indexes;
				hookDone();
			})
			.hook('autoIndexer.build', _.once((a, index) => done(`should not actually build anything - index should have been created in previous step. Asked to build [${index}]`)))
			.find({role: 'user'})
			.sort('name')
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(2);

				expect(hookCalls['autoIndexer.query']).to.be.deep.equal([['name'], ['role']]);

				done();
			});
	});


	it('should correctly identify deep indexes via dotted notation (mostPurchased.number == 5 [via query], role [via sort])', function(done) {
		var hookCalls = {};
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				hookCalls['autoIndexer.query'] = indexes;
				hookDone();
			})
			.hook('autoIndexer.build', (hookDone, index, mongoSpec) => {
				hookCalls['autoIndexer.build'] = {index, mongoSpec};
				hookDone();
			})
			.find({'mostPurchased.0.number': 5})
			.sort('role')
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(1);

				expect(hookCalls['autoIndexer.query']).to.be.deep.equal([['mostPurchased.0.number'], ['role']]);
				expect(hookCalls['autoIndexer.build']).to.be.deep.equal({
					index: ['mostPurchased.0.number'],
					mongoSpec: {'mostPurchased.0.number': 1},
				});

				done();
			});
	});

});
