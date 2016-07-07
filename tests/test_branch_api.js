'use strict';

let supertest = require('supertest-as-promised');
let app = require('../server/server');
let assert = require('chai').assert;
let RepoManager = require('../server/lib/gitrepo').RepoManager;

describe('Branch API', function() {
  let manager = new RepoManager(app.get('lunchBadger').repoPath);
  let testRepo = null;

  beforeEach(async function() {
    let repo = await manager.createRepo('test-config');
    testRepo = repo;
  });

  afterEach(async function() {
    testRepo = null;
    await manager.removeAllRepos();
  });

  async function createNewBranch(branchName) {
    let data = {
      fileA: 'A bunch of configuration',
      fileB: 'Some more configuration'
    };
    return await supertest(app)
      .patch(`/api/repos/test-config/branches/${branchName}/files`)
      .send(data)
      .expect(204);
  }

  it('should be able to create a new branch', async function() {
    let res = await createNewBranch('new-branch');
    assert.isString(res.headers['etag']);
    assert.notEqual(res.headers['etag'], 'undefined');
  });

  describe('with an existing branch', function() {
    let revision = null;

    beforeEach(async function() {
      let res = await createNewBranch('my-branch');
      revision = res.get('ETag');
    });

    describe('uploading and downloading files', function() {
      it('should work from the branch', async function() {
        let res = await supertest(app)
          .get('/api/repos/test-config/branches/my-branch/files/fileA')
          .expect(200)
          .expect('A bunch of configuration');
        assert.deepProperty(res, 'headers.content-type');
        assert(res.headers['content-type'].startsWith(
            'application/octet-stream'));
      });

      it('should return error when trying to download a non-existent file',
        async function() {
          await supertest(app)
            .get('/api/repos/test-config/branches/my-branch/files/fakeFile')
            .expect(404);
        });

      it('should be able to add a new file and read it back', async function() {
        let addRes = await supertest(app)
          .patch('/api/repos/test-config/branches/my-branch/files')
          .send({fileC: 'This is my new file'})
          .set('If-Match', revision)
          .expect(204);

        let checkRes = await supertest(app)
            .get('/api/repos/test-config/branches/my-branch/files/fileC')
            .expect(200)
            .expect('This is my new file');

        assert.equal(checkRes.header['etag'], addRes.headers.etag);
      });

      it('should reject an update of a bad revision', async function() {
        await supertest(app)
          .patch('/api/repos/test-config/branches/my-branch/files')
          .send({fileC: 'This is my new file'})
          .set('If-Match', 'incorrect-revision')
          .expect(412);
      });

      it('should reject an update if revision is not passed in',
        async function() {
          await supertest(app)
            .patch('/api/repos/test-config/branches/my-branch/files')
            .send({fileC: 'This is my new file'})
            .expect(412);
        }
      );

      it('should be able to modify a file', async function() {
        await supertest(app)
          .patch('/api/repos/test-config/branches/my-branch/files')
          .send({fileA: 'Updated file'})
          .set('If-Match', revision)
          .expect(204);

        await supertest(app)
          .get('/api/repos/test-config/branches/my-branch/files/fileA')
          .expect(200)
          .expect('Updated file');
      });

      it('should error when supplying no data', async function() {
        await supertest(app)
          .patch('/api/repos/test-config/branches/my-branch/files')
          .set('If-Match', revision)
          .expect(400);
      });
    });

    it('should be able to copy the branch', async function() {
      let newBranch = await supertest(app)
        .put('/api/repos/test-config/branches/second-branch')
        .send({
          revision: 'my-branch'
        })
        .expect(200);

      await supertest(app)
        .get('/api/repos/test-config/branches/second-branch/files/fileA')
        .expect(200, 'A bunch of configuration');

      await supertest(app)
        .get('/api/repos/test-config/branches/my-branch')
        .expect(200)
        .then((oldBranch) => {
          assert.equal(newBranch.revision, oldBranch.revision);
        });
    });

    it('should return an error when trying to copy a non-existent branch',
      async function() {
        await supertest(app)
          .put('/api/repos/test-config/branches/second-branch')
          .send({
            revision: 'does-not-exist'
          })
          .expect(400);
      }
    );

    it('should be able to get the current revision of the branch',
      async function() {
        let res = await supertest(app)
          .get('/api/repos/test-config/branches/my-branch')
          .expect(200);

        assert.propertyVal(res.body, 'id', 'my-branch');
        assert.property(res.body, 'revision');
      }
    );

    it('should return an error when getting a bad branch', async function() {
      await supertest(app)
        .get('/api/repos/test-config/branches/does-not-exist')
        .expect(404);
    });

    it('should be able to delete the branch', async function() {
      await supertest(app)
        .del('/api/repos/test-config/branches/my-branch')
        .expect(200);

      await supertest(app)
        .get('/api/repos/test-config/branches/my-branch')
        .expect(404);
    });

    it('should return an error when deleting a bad branch', async function() {
      await supertest(app)
        .del('/api/repos/test-config/branches/does-not-exist')
        .expect(404);
    });

    it('should be able to get all branches in the repo', async function() {
      let res = await supertest(app)
        .get('/api/repos/test-config');
      assert.property(res.body, 'branches');
      assert.deepEqual(res.body.branches, ['my-branch']);
    });
  });
});
