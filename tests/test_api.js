'use strict';

let supertest = require('supertest-as-promised');
let app = require('../server/server');
let assert = require('chai').assert;
let GitStore = require('../server/lib/gitstore');

describe('Repository API', function() {
  let client = supertest(app);
  let gs = new GitStore();

  afterEach(function() {
    return gs.removeAllRepos();
  });

  it('should be able to to create an empty repo', function() {
    return client
      .post('/api/repos/')
      .send({name: 'another-item'})
      .expect(200)
      .then((res) => {
        assert.property(res.body, 'id');
        assert.propertyVal(res.body, 'name', 'another-item');
      });
  });

  describe('with existing empty repo', function() {
    let repoId = null;

    beforeEach(function() {
      return client
        .post('/api/repos/')
        .send({name: 'test-config'})
        .expect(200)
        .then((res) => {
          repoId = res.body.id;
          return res;
        });
    });

    it('should be able to rename a repo', function() {
      function rename() {
        return client
          .post(`/api/repos/${repoId}`)
          .send({name: 'new-name'})
          .expect(200)
      }

      function check() {
        return client
          .get(`/api/repos/${repoId}`)
          .expect(200)
          .then(() => {
            assert.propertyVal(repo.body, 'name', 'new-name');
          });
      }

      return rename().then(check);
    });

    it('should be able to delete a repo', function() {
      function del() {
        return client
          .del(`/api/repos/${repoId}`)
          .expect(200)
      }

      function check() {
        return client
          .get(`/api/repos/${repoId}`)
          .expect(404);
      }

      return del().then(check);
    });
  });

});

xdescribe('Environment API', function() {
  before(function() {
    // Create a repository
  });

  xit('should be able to create an environment', function() {

  });
  xit('should be able to delete an environment', function() {

  });
  xit('should be able to download a file', function() {

  });
  xit('should be able to update a file', function() {

  });
  xit('should be able to get the current environment revision',
    function() {

    });
  xit('should change the environment revision when a file is updated',
    function() {

    });
});
