'use strict';

let Promise = require('bluebird');
let gitrepo = require('../lib/gitrepo');
let error = require('../lib/error');

module.exports = function(Api) {
  Api.create = function(data) {
    let repo = new Api.app.models.Repo(data);
    if (!repo.isValid()) {
      return Promise.reject(error.badRequestError('Invalid Repo format'));
    }
    return this.manager.createRepo(repo.id).then(_ => repo);
  };

  Api.exists = function(id) {
    return this.manager.repoExists(id);
  };

  Api._getRepo = function(id) {
    return this.manager.getRepo(id)
      .catch(gitrepo.RepoDoesNotExistError, (err) => {
        return Promise.reject(error.notFoundError(err.message));
      });
  };

  Api.getOne = function(id) {
    return this._getRepo(id).then(repo => { return {id: repo.name}; });
  };

  Api.getAll = function() {
    return this.manager.getAllRepos().then((repos) => {
      return repos.map((repo) => { return {id: repo.name}; });
    });
  };

  Api.delete = function(id) {
    return this.manager.removeRepo(id).then((deleted) => {
      return {count: deleted ? 1 : 0};
    });
  };

  Api.updateBranchFiles = function(repoId, branchId, data, parentRevision, cb) {
    // Note that this method does not return a Promise, since its return value
    // ends up as the value of the ETag header. Setting a header based on the
    // response value only seems to work when calling the cb, not through the
    // Promise.
    this._getRepo(repoId)
      .then((repo) => {
        return repo.updateBranchFiles(branchId, parentRevision, data);
      })
      .then(res => {
        cb(null, res, undefined);
      })
      .catch(gitrepo.OptimisticConcurrencyError, (err) => {
        cb(error.preconditionFailedError('Please refresh'));
      });
  };

  Api.testMethod = function(obj) {
    return this._getRepo('new-repo')
      .then((repo) => {
        return repo.testMethod(obj);
      });
  };

  Api.remoteMethod('testMethod', {
    accepts: [{arg: 'data', type: 'object', http: {source: 'body'}}],
    returns: [{arg: 'data', type: 'object', root: true}]
  });

  Api.remoteMethod('create', {
    description: 'Create a new repository.',
    accepts: [{arg: 'repo', type: 'Repo', http: {source: 'body'}}],
    returns: [{arg: 'repo', type: 'Repo', root: true}],
    http: {verb: 'post', path: '/repos'}
  });

  Api.remoteMethod('exists', {
    description: 'Check whether a repository exists.',
    accepts: [
      {arg: 'id', type: 'string', description: 'Repo name', required: true}
    ],
    returns: {arg: 'exists', type: 'boolean'},
    http: {verb: 'get', path: '/repos/:id/exists'}
  });

  Api.remoteMethod('getOne', {
    description: 'Retrieve the information for the given repo.',
    accepts: [
      {arg: 'id', type: 'string', description: 'Repo id', required: true}
    ],
    returns: {arg: 'data', type: 'Repo', root: true},
    http: {verb: 'get', path: '/repos/:id'}
  });

  Api.remoteMethod('getAll', {
    description: 'Retrieve information on all existing repos.',
    returns: {arg: 'data', type: ['Repo'], root: true},
    http: {verb: 'get', path: '/repos/'}
  });

  Api.remoteMethod('delete', {
    description: 'Delete a repo.',
    accepts: [{arg: 'id', type: 'any', description: 'Repo id', required: true}],
    http: {verb: 'del', path: '/repos/:id'},
    returns: {arg: 'count', type: 'object', root: true}
  });

  Api.remoteMethod('updateBranchFiles', {
    description: 'Add a new commit / revision.',
    accepts: [
      {
        arg: 'repoId',
        type: 'string',
        description: 'Repo id',
        required: true
      },
      {
        arg: 'branchId',
        type: 'string',
        description: 'Branch id',
        required: true
      },
      {
        arg: 'data',
        type: 'object',
        http: {source: 'body'},
        description: 'Object mapping file name to its content'
      },
      {
        arg: 'parentRevision',
        type: 'string',
        http: ctx => ctx.req.get('If-Match')
      }
    ],
    returns: [
      {
        arg: 'ETag',
        type: 'string',
        http: {target: 'header'}
      },
      {
        arg: 'data',
        type: 'object',
        root: true
      }
    ],
    http: {verb: 'post', path: '/repos/:repoId/branches/:branchId/files'}
  });
};
