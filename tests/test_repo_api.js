'use strict';

let supertest = require('supertest-as-promised');
let app = require('../server/server');
let assert = require('chai').assert;
let RepoManager = require('../server/lib/gitrepo').RepoManager;

describe('Repository API', function() {
  let client = supertest(app);
  let manager = new RepoManager(app.get('lunchBadger').repoPath);

  afterEach(function() {
    return manager.removeAllRepos();
  });

  it('should be able to to create a repo', function() {
    function create() {
      return client
        .post('/api/repos/')
        .send({id: 'another-item'})
        .expect(200, {id: 'another-item'});
    }

    function check() {
      return client
        .get('/api/repos/another-item')
        .expect(200, {id: 'another-item', branches: []});
    }

    return create().then(check);
  });

  it('should be able to tell you when a repository doesn\'t exist', function() {
    return client
      .get('/api/repos/test-config/exists')
      .expect(200, {exists: false});
  });

  describe('with existing empty repo', function() {
    beforeEach(function() {
      return client
        .post('/api/repos/')
        .send({id: 'test-config'})
        .expect(200);
    });

    it('should be able to tell that the repository exists', function() {
      return client
        .get('/api/repos/test-config/exists')
        .expect(200, {exists: true});
    });

    it('should be able to delete the repo', function() {
      function del() {
        return client
          .del('/api/repos/test-config')
          .expect(200, {count: 1});
      }

      function check() {
        return client
          .get('/api/repos/test-config')
          .expect(404);
      }

      return del().then(check);
    });
  });
});
