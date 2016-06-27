'use strict'

let supertest = require('supertest-as-promised');
let app = require('../server/server');
let assert = require('chai').assert;
let RepoManager = require('../server/lib/gitrepo').RepoManager;


describe('Environment API', function() {
  let client = supertest(app);
  let manager = new RepoManager(app.get('lunchBadger').repoPath);
  let testRepo = null;

  beforeEach(function() {
    return manager.createRepo('test-config').then((repo) => {
      testRepo = repo;
    });
  });

  afterEach(function() {
    testRepo = null;
    return manager.removeAllRepos();
  });

  it('should be able to update a file to a new branch', function() {
    let data = {
      name: 'branch1', files: {
        'fileA': 'A bunch of configuration',
        'fileB': 'Some more configuration'
      }
    };
    return client
      .put('/api/repos/test-config/branches/')
      .send(data)
      .expect(200)
      .then((res) => {
        assert.property(res, 'revision');
      })
  });


  xit('should be able to create an environment', function() {
    return client
      .post('/api/repos/test-config/branches')
      .send({'name': 'master'})
  });
  xit('should be able to delete an environment', function() {

  });
  xit('should be able to download a file', function() {

  });

  xit('should be able to get the current environment revision',
    function() {

    });
  xit('should change the environment revision when a file is updated',
    function() {

    });
});
