'use strict';

let supertest = require('supertest-as-promised');
let app = require('../server/server');
let assert = require('chai').assert;
let RepoManager = require('../server/lib/gitrepo').RepoManager;

describe('Branch API', function() {
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
      fileA: 'A bunch of configuration',
      fileB: 'Some more configuration'
    };
    return supertest(app)
      .patch(`/api/repos/test-config/branches/${branchName}/files`)
      .send(data)
      .expect(204);
  }

  it('should be able to create a new branch', function() {
    return createNewBranch('new-branch').then((res) => {
      assert.isString(res.headers['etag']);
      assert.notEqual(res.headers['etag'], 'undefined');
    });
  });

  describe('with an existing branch', function() {
    let revision = null;

    beforeEach(function() {
      return createNewBranch('my-branch')
        .then(res => {
          revision = res.get('ETag');
          return res;
        });
    });

    describe('uploading and downloading files', function() {
      it('should work from the branch', function() {
        return supertest(app)
          .get('/api/repos/test-config/branches/my-branch/files/fileA')
          .expect(200)
          .expect('A bunch of configuration')
          .then(res => {
            assert.deepProperty(res, 'headers.content-type');
            assert(res.headers['content-type'].startsWith(
              'application/octet-stream'));
          });
      });

      it('should return error when trying to download a non-existent file',
        function() {
          return supertest(app)
            .get('/api/repos/test-config/branches/my-branch/files/fakeFile')
            .expect(404);
        });

      it('should be able to add a new file and read it back', function() {
        let newRevision = null;

        function upload() {
          return supertest(app)
            .patch('/api/repos/test-config/branches/my-branch/files')
            .send({fileC: 'This is my new file'})
            .set('If-Match', revision)
            .expect(204)
            .then(res => {
              newRevision = res.headers.etag;
            });
        }

        function check() {
          return supertest(app)
            .get('/api/repos/test-config/branches/my-branch/files/fileC')
            .expect(200)
            .expect('This is my new file')
            .then(res => {
              assert.equal(res.header['etag'], newRevision);
            });
        }
        return upload().then(check);
      });

      it('should reject an update of a bad revision', function() {
        return supertest(app)
          .patch('/api/repos/test-config/branches/my-branch/files')
          .send({fileC: 'This is my new file'})
          .set('If-Match', 'incorrect-revision')
          .expect(412);
      });

      it('should reject an update if revision is not passed in', function() {
        return supertest(app)
          .patch('/api/repos/test-config/branches/my-branch/files')
          .send({fileC: 'This is my new file'})
          .expect(412);
      });

      it('should be able to modify a file', function() {
        function update() {
          return supertest(app)
            .patch('/api/repos/test-config/branches/my-branch/files')
            .send({fileA: 'Updated file'})
            .set('If-Match', revision)
            .expect(204);
        }

        function check() {
          return supertest(app)
            .get('/api/repos/test-config/branches/my-branch/files/fileA')
            .expect(200)
            .expect('Updated file');
        }

        return update().then(check);
      });

      it('should error when supplying no data', function() {
        return supertest(app)
          .patch('/api/repos/test-config/branches/my-branch/files')
          .set('If-Match', revision)
          .expect(400);
      });
    });

    it('should be able to copy the branch', function() {
      function copy() {
        return supertest(app)
          .put('/api/repos/test-config/branches/second-branch')
          .send({
            revision: 'my-branch'
          })
          .expect(200);
      }

      function check(newBranch) {
        return Promise.all([
          supertest(app)
            .get('/api/repos/test-config/branches/second-branch/files/fileA')
            .expect(200, 'A bunch of configuration'),
          supertest(app)
            .get('/api/repos/test-config/branches/my-branch')
            .expect(200)
            .then((oldBranch) => {
              assert.equal(newBranch.revision, oldBranch.revision);
            })
        ]);
      }

      return copy().then(check);
    });

    it('should return an error when trying to copy a non-existent branch',
      function() {
        return supertest(app)
          .put('/api/repos/test-config/branches/second-branch')
          .send({
            revision: 'does-not-exist'
          })
          .expect(400);
      });

    it('should be able to get the current revision of the branch', function() {
      return supertest(app)
        .get('/api/repos/test-config/branches/my-branch')
        .expect(200)
        .then(res => {
          assert.propertyVal(res.body, 'id', 'my-branch');
          assert.property(res.body, 'revision');
        });
    });

    it('should return an error when getting a bad branch', function() {
      return supertest(app)
        .get('/api/repos/test-config/branches/does-not-exist')
        .expect(404);
    });

    it('should be able to delete the branch', function() {
      function del() {
        return supertest(app)
          .del('/api/repos/test-config/branches/my-branch')
          .expect(200);
      }

      function check() {
        return supertest(app)
          .get('/api/repos/test-config/branches/my-branch')
          .expect(404);
      }

      return del().then(check);
    });

    it('should return an error when deleting a bad branch', function() {
      return supertest(app)
        .del('/api/repos/test-config/branches/does-not-exist')
        .expect(404);
    });

    xit('should be able to get all branches in the repo', function() {
      return supertest(app)
        .get('/api/repos/test-config')
        .then((repo) => {
          assert.property(repo, 'branches');
          assert.property(repo.branches, 'my-branch');
        });
    });
  });
});
