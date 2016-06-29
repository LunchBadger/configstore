'use strict';

let supertest = require('supertest-as-promised');
let app = require('../server/server');
let assert = require('chai').assert;
let RepoManager = require('../server/lib/gitrepo').RepoManager;

describe('Branch API', function() {
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

  function createNewBranch(branchName) {
    let data = {
      files: {
        'fileA': 'A bunch of configuration',
        'fileB': 'Some more configuration'
      }
    };
    return client
      .patch(`/api/repos/test-config/branches/${branchName}/files`)
      .send(data)
      .set('Content-type', 'application/merge-patch+json')
      .expect(200);
  }

  it('should be able to create a new branch', function() {
    return createNewBranch('new-branch').then((res) => {
      assert.property(res, 'revision');
    });
  });

  describe('with an existing branch', function() {
    beforeEach(function() {
      return createNewBranch('my-branch');
    });

    it('should be able to download a file from the branch', function() {
      return client
        .get('/api/repos/test-config/branches/my-branch/files/fileA')
        .expect(200)
        .expect('Content-type', 'application/octet-stream')
        .expect('A bunch of configuration');
    });

    it('should return error when trying to download a non-existent file',
      function() {
        return client
          .get('/api/repos/test-config/branches/my-branch/files/fakeFile')
          .expect(404);
      });

    it('should be able to copy the branch', function() {
      function copy() {
        return client
          .put('/api/repos/test-config/branches/second-branch')
          .send({
            revision: 'my-branch'
          })
          .expect(200);
      }

      function check(newBranch) {
        return Promise.all([
          client
            .get('/api/repos/test-config/branches/second-branch/files/fileA')
            .expect(200, 'A bunch of configuration'),
          client
            .get('/api/repos/test-config/branches/my-branch')
            .expect(200)
            .then((oldBranch) => {
              assert.equals(newBranch.revision, oldBranch.revision);
            })
        ]);
      }

      return copy().then(check);
    });

    it('should return an error when trying to copy a non-existent branch',
      function() {
        return client
          .put('/api/repos/test-config/branches/second-branch')
          .send({
            revision: 'does-not-exist'
          })
          .expect('400');
      });

    it('should be able to delete the branch', function() {
      function del() {
        return client
          .del('/api/repos/test-config/branches/my-branch')
          .expect(200);
      }

      function check() {
        return client
          .get('/api/repos/test-config/branches/my-branch')
          .expect(404);
      }

      return del().then(check);
    });

    it('should be able to get the current revision of the branch', function() {
      return client
        .get('/api/repos/test-config/branches/my-branch')
        .expect(200)
        .then((branch) => {
          assert.propertyVal(branch, 'name', 'my-branch');
          assert.property(branch, 'revision');
        });
    });

    it('should return error when getting the revision of a bad branch',
      function() {
        return client
          .get('/api/repos/test-config/branches/does-not-exist')
          .expect(404);
      });

    it('should be able to get all branches in the repo', function() {
      return client
        .get('/api/repos/test-config')
        .then((repo) => {
          assert.property(repo, 'branches');
          assert.property(repo.branches, 'my-branch');
        });
    });

    it('should be able to add a new file');
    it('should be able to modify a file');
  });
});
