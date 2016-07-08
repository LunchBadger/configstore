'use strict';

let supertest = require('supertest-as-promised');
let app = require('../server/server');
let RepoManager = require('../server/lib/gitrepo').RepoManager;

describe('Repository API', function() {
  let client = supertest(app);
  let manager = new RepoManager(app.get('lunchBadger').repoPath);

  afterEach(async function() {
    await manager.removeAllRepos();
  });

  it('should be able to to create a repo', async function() {
    await client
      .post('/api/repos/')
      .send({id: 'another-item'})
      .expect(200, {id: 'another-item'});

    await client
      .get('/api/repos/another-item')
      .expect(200, {id: 'another-item', branches: []});
  });

  it('should be able to tell you when a repository doesn\'t exist',
    async function() {
      await client
        .get('/api/repos/test-config/exists')
        .expect(200, {exists: false});
    }
  );

  describe('with existing empty repo', function() {
    beforeEach(async function() {
      await client
        .post('/api/repos/')
        .send({id: 'test-config'})
        .expect(200);
    });

    it('should be able to tell that the repository exists', async function() {
      await client
        .get('/api/repos/test-config/exists')
        .expect(200, {exists: true});
    });

    it('should be able to delete the repo', async function() {
      await client
        .del('/api/repos/test-config')
        .expect(200, {count: 1});

      await client
        .get('/api/repos/test-config')
        .expect(404);
    });
  });
});
