'use strict';

let Promise = require('bluebird');
let gitrepo = require('../lib/gitrepo');
let error = require('../lib/error');

module.exports = function(Api) {
  Api.create = function(data) {
    let repo = new this.app.models.Repo(data);
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
    let repo = null;

    return this
      ._getRepo(id)
      .then(repo_ => {
        repo = repo_;
        return repo.getBranches();
      })
      .then(branches => {
        return {
          id: repo.name,
          branches: branches
        };
      });
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
    if (Object.keys(data).length < 1) {
      cb(error.badRequestError('Must specify some data'));
      return;
    }

    this._getRepo(repoId)
      .then(repo => {
        return repo.updateBranchFiles(branchId, parentRevision, data);
      })
      .then(res => {
        cb(null, res, undefined);
      })
      .catch(gitrepo.OptimisticConcurrencyError, (err) => {
        cb(error.preconditionFailedError('Please refresh'));
      })
      .catch(err => {
        cb(err);
      });
  };

  Api.downloadFile = function(repoId, branchId, fileName, cb) {
    this
      ._getRepo(repoId)
      .then(repo => {
        return repo.getFile(branchId, fileName);
      })
      .then(([content, chksum]) => {
        cb(null, content, chksum, 'application/octet-stream');
      })
      .catch(gitrepo.FileNotFound, err => {
        cb(error.notFoundError(`File ${fileName} does not exist`));
      })
      .catch(err => {
        cb(err);
      });
  };

  Api.upsertBranch = function(repoId, branchId, data) {
    if (data.id && data.id != branchId) {
      return Promise.reject(error.badRequestError('Invalid Branch format'));
    }
    data.id = branchId;
    let branch = new this.app.models.Branch(data);
    if (!branch.isValid()) {
      return Promise.reject(error.badRequestError('Invalid Branch format'));
    }

    return this
      ._getRepo(repoId)
      .then(repo => repo.upsertBranch(branchId, branch.revision))
      .then(newRevision => {
        return {'id': branchId, 'revision': newRevision};
      })
      .catch(gitrepo.RevisionNotFound, err => {
        return Promise.reject(error.badRequestError(err.message));
      });
  };

  Api.getBranch = function(repoId, branchId) {
    return this
      ._getRepo(repoId)
      .then(repo => repo.getBranchRevision(branchId))
      .then(revision => {
        return {
          id: branchId,
          revision: revision
        };
      })
      .catch(gitrepo.InvalidBranchError, err => {
        return Promise.reject(error.notFoundError(err.message));
      });
  };

  Api.deleteBranch = function(repoId, branchId) {
    return this
      ._getRepo(repoId)
      .then(repo => repo.deleteBranch(branchId))
      .then(deleted => {
        return {count: deleted ? 1 : 0};
      })
      .catch(gitrepo.InvalidBranchError, err => {
        return Promise.reject(error.notFoundError(err.message));
      });
  };

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
      {arg: 'repoId', type: 'string', required: true, description: 'Repo id'},
      {arg: 'branchId', type: 'string', required: true,
        description: 'Branch id'},
      {arg: 'data', type: 'object', http: {source: 'body'},
        description: 'Object mapping file name to its content'},
      {arg: 'parentRevision', type: 'string',
        http: ctx => ctx.req.get('If-Match')}
    ],
    returns: [
      {arg: 'ETag', type: 'string', http: {target: 'header'}},
      {arg: 'data', type: 'object', root: true}
    ],
    http: {verb: 'patch', path: '/repos/:repoId/branches/:branchId/files'}
  });

  Api.remoteMethod('downloadFile', {
    description: 'Retrieve a file from the given branch',
    accepts: [
      {arg: 'repoId', type: 'string', required: true, description: 'Repo id'},
      {arg: 'branchId', type: 'string', required: true,
        description: 'Branch id'},
      {arg: 'fileName', type: 'string', required: true,
        description: 'File name'}
    ],
    returns: [
      {arg: 'data', type: 'file', root: true},
      {arg: 'ETag', type: 'string', http: {target: 'header'}},
      {arg: 'Content-type', type: 'string', http: {target: 'header'}}
    ],
    http: {
      verb: 'get',
      path: '/repos/:repoId/branches/:branchId/files/:fileName(*)'
    }
  });

  Api.remoteMethod('upsertBranch', {
    description: 'Create or update a branch',
    accepts: [
      {arg: 'repoId', type: 'string', required: true, description: 'Repo id'},
      {arg: 'branchId', type: 'string', required: true,
        description: 'Branch id'},
      {arg: 'branch', type: 'Branch', required: true, http: {source: 'body'},
        description: 'The branch object'}
    ],
    returns: [
      {arg: 'branch', type: 'Branch', required: true, root: true,
        description: 'The branch object'}
    ],
    http: {verb: 'put', path: '/repos/:repoId/branches/:branchId'}
  });

  Api.remoteMethod('getBranch', {
    description: 'Get branch information',
    accepts: [
      {arg: 'repoId', type: 'string', required: true, description: 'Repo id'},
      {arg: 'branchId', type: 'string', required: true,
        description: 'Branch id'},
    ],
    returns: [
      {arg: 'branch', type: 'Branch', required: true, root: true,
        description: 'The branch object'}
    ],
    http: {verb: 'get', path: '/repos/:repoId/branches/:branchId'}
  });

  Api.remoteMethod('deleteBranch', {
    description: 'Delete branch',
    accepts: [
      {arg: 'repoId', type: 'string', required: true, description: 'Repo id'},
      {arg: 'branchId', type: 'string', required: true,
        description: 'Branch id'},
    ],
    returns: {arg: 'count', type: 'object', root: true},
    http: {verb: 'del', path: '/repos/:repoId/branches/:branchId'}
  });
};
