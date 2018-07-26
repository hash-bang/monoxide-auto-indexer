var _ = require('lodash');
var expect = require('chai').expect;
var monoxide = require('monoxide');
var testSetup = require('./setup');

describe('monoxide-auto-indexer', function() {
	before(testSetup.init);
	after(testSetup.teardown);
	afterEach('clear all hooks', ()=> _(monoxide.models).forEach(model => delete model.$hooks['autoIndexer.query']));

	it('should correctly identify when to create indexes (no indexing)', function(done) {
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				expect(indexes).to.be.deep.equal([]);
				hookDone();
				done();
			})
			.find()
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(2);
			});
	});


	it('should correctly identify when to create indexes (name [via sort])', function(done) {
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				expect(indexes).to.be.deep.equal(['name']);
				hookDone();
				done();
			})
			.find()
			.sort('name')
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(2);
			});
	});


	it('should correctly identify when to create indexes (name + role [via query])', function(done) {
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				expect(indexes).to.be.deep.equal(['name', 'role']);
				hookDone();
				done();
			})
			.find({
				name: 'Joe Random',
				role: 'user',
			})
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(1);
			});
	});

	it('should correctly identify when to create indexes (name [via sort], role [via query])', function(done) {
		monoxide.models.users
			.hook('autoIndexer.query', (hookDone, indexes) => {
				expect(indexes).to.be.deep.equal(['name', 'role']);
				hookDone();
				done();
			})
			.find({role: 'user'})
			.sort('name')
			.exec(function(err, res) {
				expect(err).to.be.not.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(2);
			});
	});
});
