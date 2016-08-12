'use strict';

const supertest = require('supertest-as-promised');

const app = require('../server/server');
const RepoManager = require('../server/lib/gitrepo').RepoManager;

describe('Producer API', function() {
  let client = supertest(app);
  let manager = new RepoManager(app.get('lunchBadger').repoPath);

  afterEach(async function() {
    await manager.removeAllRepos();
  });

  it('should be able to to create a producer', async function() {
    await client
      .post('/api/producers/')
      .send({id: 'another-item'})
      .expect(200, {id: 'another-item'});

    await client
      .get('/api/producers/another-item')
      .expect(200, {id: 'another-item', envs: []});
  });

  it('should be able to tell you when a producer doesn\'t exist',
    async function() {
      await client
        .get('/api/producers/test-config/exists')
        .expect(200, {exists: false});
    }
  );

  describe('with existing empty repo', function() {
    beforeEach(async function() {
      await client
        .post('/api/producers/')
        .send({id: 'test-config'})
        .expect(200);
    });

    it('should be able to tell that the prodyucer exists', async function() {
      await client
        .get('/api/producers/test-config/exists')
        .expect(200, {exists: true});
    });

    it('should be able to delete the repo', async function() {
      await client
        .del('/api/producers/test-config')
        .expect(200, {count: 1});

      await client
        .get('/api/producers/test-config')
        .expect(404);
    });
  });
});