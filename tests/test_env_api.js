let supertest = require('supertest-as-promised');
let assert = require('chai').assert;

let app = require('../server/server');
let RepoManager = require('../server/lib/gitrepo').RepoManager;

describe('Environment API', function () {
  let manager = new RepoManager(app.get('lunchBadger').repoPath);

  beforeEach(async function () {
    await manager.createRepo('test-config');
  });

  afterEach(async function () {
    await manager.removeAllRepos();
  });

  async function createNewEnv (envName) {
    let data = {
      fileA: 'A bunch of configuration',
      fileB: 'Some more configuration'
    };

    return supertest(app)
      .patch(`/api/producers/test-config/envs/${envName}/files`)
      .send(data)
      .expect(204);
  }

  it('should be able to create a new env', async function () {
    let res = await createNewEnv('new-env');
    assert.isString(res.headers['etag']);
    assert.notEqual(res.headers['etag'], 'undefined');
  });

  describe('with an existing env', function () {
    let revision = null;

    beforeEach(async function () {
      let res = await createNewEnv('my-env');
      revision = res.get('ETag');
    });

    describe('uploading and downloading files', function () {
      it('should work from the env', async function () {
        let res = await supertest(app)
          .get('/api/producers/test-config/envs/my-env/files/fileA')
          .expect(200)
          .expect('A bunch of configuration');
        assert.deepProperty(res, 'headers.content-type');
        assert(res.headers['content-type'].startsWith(
          'application/octet-stream'));
      });

      it('should return error when trying to download a non-existent file',
        async function () {
          await supertest(app)
            .get('/api/producers/test-config/envs/my-env/files/fakeFile')
            .expect(404);
        });

      it('should be able to add a new file and read it back', async function () {
        let addRes = await supertest(app)
          .patch('/api/producers/test-config/envs/my-env/files')
          .send({ fileC: 'This is my new file' })
          .set('If-Match', revision)
          .expect(204);

        let checkRes = await supertest(app)
          .get('/api/producers/test-config/envs/my-env/files/fileC')
          .expect(200)
          .expect('This is my new file');

        assert.equal(checkRes.header['etag'], addRes.headers.etag);
      });

      it('should reject an update of a bad revision', async function () {
        await supertest(app)
          .patch('/api/producers/test-config/envs/my-env/files')
          .send({ fileC: 'This is my new file' })
          .set('If-Match', 'incorrect-revision')
          .expect(412);
      });

      it('should reject an update if revision is not passed in',
        async function () {
          await supertest(app)
            .patch('/api/producers/test-config/envs/my-env/files')
            .send({ fileC: 'This is my new file' })
            .expect(412);
        }
      );

      it('should be able to modify a file', async function () {
        await supertest(app)
          .patch('/api/producers/test-config/envs/my-env/files')
          .send({ fileA: 'Updated file' })
          .set('If-Match', revision)
          .expect(204);

        await supertest(app)
          .get('/api/producers/test-config/envs/my-env/files/fileA')
          .expect(200)
          .expect('Updated file');
      });

      it('should error when supplying no data', async function () {
        await supertest(app)
          .patch('/api/producers/test-config/envs/my-env/files')
          .set('If-Match', revision)
          .expect(400);
      });
    });

    it('should be able to copy the env', async function () {
      let newEnv = await supertest(app)
        .put('/api/producers/test-config/envs/second-env')
        .send({
          revision: 'env/my-env'
        })
        .expect(200);

      await supertest(app)
        .get('/api/producers/test-config/envs/second-env/files/fileA')
        .expect(200, 'A bunch of configuration');

      await supertest(app)
        .get('/api/producers/test-config/envs/my-env')
        .expect(200)
        .then((oldEnv) => {
          assert.equal(newEnv.revision, oldEnv.revision);
        });
    });

    it('should return an error when trying to copy a non-existent env',
      async function () {
        await supertest(app)
          .put('/api/producers/test-config/envs/second-env')
          .send({
            revision: 'does-not-exist'
          })
          .expect(400);
      }
    );

    it('should be able to get the current revision of the env',
      async function () {
        let res = await supertest(app)
          .get('/api/producers/test-config/envs/my-env')
          .expect(200);

        assert.propertyVal(res.body, 'id', 'my-env');
        assert.property(res.body, 'revision');
      }
    );

    it('should return an error when getting a bad env', async function () {
      await supertest(app)
        .get('/api/producers/test-config/envs/does-not-exist')
        .expect(404);
    });

    it('should be able to delete the env', async function () {
      await supertest(app)
        .del('/api/producers/test-config/envs/my-env')
        .expect(200);

      await supertest(app)
        .get('/api/producers/test-config/envs/my-env')
        .expect(404);
    });

    it('should return an error when deleting a bad env', async function () {
      await supertest(app)
        .del('/api/producers/test-config/envs/does-not-exist')
        .expect(404);
    });

    // This endpoint seems to not exist at all.
    it.skip('should be able to get all envs in the repo', async function () {
      let res = await supertest(app)
        .get('/api/producers/test-config');
      assert.property(res.body, 'envs');
      assert.isObject(res.body.envs);
      assert.property(res.body.envs, 'my-env');
    });
  });
});
