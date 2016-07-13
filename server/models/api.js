'use strict';

let Promise = require('bluebird');
let gitrepo = require('../lib/gitrepo');
let error = require('../lib/error');

module.exports = function(Api) {
  Api.create = async function(data) {
    let repo = new this.app.models.Repo(data);
    if (!repo.isValid()) {
      throw error.badRequestError('Invalid Repo format');
    }
    await this.manager.createRepo(repo.id);
    return repo;
  };

  Api.exists = async function(id) {
    return await this.manager.repoExists(id);
  };

  Api._getRepo = async function(id) {
    try {
      return await this.manager.getRepo(id);
    } catch (err) {
      if (err instanceof gitrepo.RepoDoesNotExistError) {
        throw error.notFoundError(err.message);
      }
      throw err;
    }
  };

  Api._getRepoInfo = async function(repo) {
    let branches = await repo.getBranches();
    let branchRevs = await Promise.all(branches.map(async branch => {
      return [branch, await repo.getBranchRevision(branch)];
    }));
    let branchInfo = {};
    branchRevs.forEach(([branch, revision]) => {
      branchInfo[branch] = revision;
    });
    return {
      id: repo.name,
      branches: branchInfo
    };
  };

  Api.getOne = async function(id) {
    let repo = await this._getRepo(id);
    return await this._getRepoInfo(repo);
  };

  Api.getAll = async function() {
    let repos = await this.manager.getAllRepos();
    return await Promise.all(repos.map(repo => this._getRepoInfo(repo)));
  };

  Api.delete = async function(id) {
    let deleted = await this.manager.removeRepo(id);
    return {count: deleted ? 1 : 0};
  };

  Api.updateBranchFiles = function(repoId, branchId, data, parentRevision, cb) {
    // Note that this method does not return a Promise, since its return value
    // ends up as the value of the ETag header. Setting a header based on the
    // response value only seems to work when calling the cb, not through the
    // Promise.
    (async () => {
      if (Object.keys(data).length < 1) {
        cb(error.badRequestError('Must specify some data'));
        return;
      }

      let repo = await this._getRepo(repoId);
      try {
        let res = await repo.updateBranchFiles(branchId, parentRevision, data);
        cb(null, res, undefined);
      } catch (err) {
        if (err instanceof gitrepo.OptimisticConcurrencyError) {
          cb(error.preconditionFailedError('Please refresh'));
        } else {
          cb(err);
        }
      }
    })();
  };

  Api.downloadFile = function(repoId, branchId, fileName, cb) {
    (async () => {
      let repo = await this._getRepo(repoId);

      try {
        let [content, chksum] = await repo.getFile(branchId, fileName);
        cb(null, content, chksum, 'application/octet-stream');
      } catch (err) {
        if (err instanceof gitrepo.FileNotFound) {
          cb(error.notFoundError(`File ${fileName} does not exist`));
        } else {
          cb(err);
        }
      }
    })();
  };

  Api.upsertBranch = async function(repoId, branchId, data) {
    if (data.id && data.id != branchId) {
      throw error.badRequestError('Invalid Branch format');
    }
    data.id = branchId;
    let branch = new this.app.models.Branch(data);
    if (!branch.isValid()) {
      throw error.badRequestError('Invalid Branch format');
    }

    let repo = await this._getRepo(repoId);

    try {
      let newRevision = await repo.upsertBranch(branchId, branch.revision);
      return {'id': branchId, 'revision': newRevision};
    } catch (err) {
      if (err instanceof gitrepo.RevisionNotFound) {
        throw error.badRequestError(err.message);
      }
      throw err;
    }
  };

  Api.getBranch = async function(repoId, branchId) {
    let repo = await this._getRepo(repoId);
    let revision = undefined;
    try {
      revision = await repo.getBranchRevision(branchId);
    } catch (err) {
      if (err instanceof gitrepo.InvalidBranchError) {
        throw error.notFoundError(err.message);
      }
      throw err;
    }

    return {
      id: branchId,
      revision: revision
    };
  };

  Api.deleteBranch = async function(repoId, branchId) {
    let repo = await this._getRepo(repoId);
    let deleted = undefined;
    try {
      deleted = await repo.deleteBranch(branchId);
    } catch (err) {
      if (err instanceof gitrepo.InvalidBranchError) {
        throw error.notFoundError(err.message);
      }
      throw err;
    }
    return {count: deleted ? 1 : 0};
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
      path: '/repos/:repoId/branches/:branchId(*)/files/:fileName(*)'
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
