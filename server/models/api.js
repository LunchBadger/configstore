'use strict';

const gitrepo = require('../lib/gitrepo');
const error = require('../lib/error');

module.exports = function(Api) {
  Api.create = async function(data) {
    let repo = new this.app.models.Producer(data);
    if (!repo.isValid()) {
      throw error.badRequestError('Invalid Producer format');
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
      if (branch.startsWith('env/')) {
        branchInfo[branch.substr(4)] = revision;
      }
    });
    return {
      id: repo.name,
      envs: branchInfo
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

  Api.updateEnvFiles = function(producerId, envId, data, parentRevision, cb) {
    // Note that this method does not return a Promise, since its return value
    // ends up as the value of the ETag header. Setting a header based on the
    // response value only seems to work when calling the cb, not through the
    // Promise.
    (async () => {
      if (Object.keys(data).length < 1) {
        cb(error.badRequestError('Must specify some data'));
        return;
      }

      let repo = await this._getRepo(producerId);
      try {
        let rev = await repo.updateBranchFiles('env/' + envId, parentRevision,
                                               data);
        cb(null, rev, undefined);
      } catch (err) {
        if (err instanceof gitrepo.OptimisticConcurrencyError) {
          cb(error.preconditionFailedError('Please refresh'));
        } else {
          cb(err);
        }
      }
    })();
  };

  Api.downloadFile = function(producerId, envId, fileName, cb) {
    (async () => {
      let repo = await this._getRepo(producerId);

      try {
        let [content, chksum] = await repo.getFile('env/' + envId, fileName);
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

  Api.upsertEnv = async function(producerId, envId, data) {
    if (data.id && data.id != envId) {
      throw error.badRequestError('Invalid Environment format');
    }
    data.id = envId;
    let env = new this.app.models.Environment(data);
    if (!env.isValid()) {
      throw error.badRequestError('Invalid Environment format');
    }

    let repo = await this._getRepo(producerId);

    try {
      let newRevision = await repo.upsertBranch('env/' + envId, env.revision);
      return {'id': envId, 'revision': newRevision};
    } catch (err) {
      if (err instanceof gitrepo.RevisionNotFound) {
        throw error.badRequestError(err.message);
      }
      throw err;
    }
  };

  Api.getEnv = async function(producerId, envId) {
    let repo = await this._getRepo(producerId);
    let revision = undefined;
    try {
      revision = await repo.getBranchRevision('env/' + envId);
    } catch (err) {
      if (err instanceof gitrepo.InvalidBranchError) {
        throw error.notFoundError(err.message);
      }
      throw err;
    }

    return {
      id: envId,
      revision: revision
    };
  };

  Api.deleteEnv = async function(producerId, envId) {
    let repo = await this._getRepo(producerId);
    let deleted = undefined;
    try {
      deleted = await repo.deleteBranch('env/' + envId);
    } catch (err) {
      if (err instanceof gitrepo.InvalidBranchError) {
        throw error.notFoundError(err.message);
      }
      throw err;
    }
    return {count: deleted ? 1 : 0};
  };

  Api.remoteMethod('create', {
    description: 'Create a new producer.',
    http: {
      verb: 'post',
      path: '/producers'
    },
    accepts: [
      {
        arg: 'producer',
        type: 'Producer',
        http: {
          source: 'body'
        }
      }
    ],
    returns: [
      {
        arg: 'producer',
        type: 'Producer',
        root: true
      }
    ]
  });

  Api.remoteMethod('exists', {
    description: 'Check whether a producer exists.',
    http: {
      verb: 'get',
      path: '/producers/:id/exists'
    },
    accepts: [
      {
        arg: 'id',
        type: 'string',
        description: 'Producer name',
        required: true
      }
    ],
    returns: {
      arg: 'exists',
      type: 'boolean'
    }
  });

  Api.remoteMethod('getOne', {
    description: 'Retrieve the information for the given producer.',
    http: {
      verb: 'get',
      path: '/producers/:id'
    },
    accepts: [
      {
        arg: 'id',
        type: 'string',
        description: 'Producer id',
        required: true
      }
    ],
    returns: {
      arg: 'data',
      type: 'Producer',
      root: true
    },
  });

  Api.remoteMethod('getAll', {
    description: 'Retrieve information on all existing producers.',
    http: {
      verb: 'get',
      path: '/producers/'
    },
    returns: {
      arg: 'data',
      type: ['Producer'],
      root: true
    }
  });

  Api.remoteMethod('delete', {
    description: 'Delete a producer.',
    http: {
      verb: 'del',
      path: '/producers/:id'
    },
    accepts: [
      {
        arg: 'id',
        type: 'any',
        description: 'Producer id',
        required: true
      }
    ],
    returns: {
      arg: 'count',
      type: 'object',
      root: true
    }
  });

  Api.remoteMethod('updateEnvFiles', {
    description: 'Add a new revision, updating the given files.',
    http: {
      verb: 'patch',
      path: '/producers/:producerId/envs/:envId/files'
    },
    accepts: [
      {
        arg: 'producerId',
        type: 'string',
        required: true,
        description: 'Producer id'
      },
      {
        arg: 'envId',
        type: 'string',
        required: true,
        description: 'Environment id'
      },
      {
        arg: 'data',
        type: 'object',
        http: {
          source: 'body'
        },
        description: 'Object mapping file names to their content'},
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
        http: {
          target: 'header'
        }
      },
      {
        arg: 'data',
        type: 'object',
        root: true
      }
    ]
  });

  Api.remoteMethod('downloadFile', {
    description: 'Retrieve a file from the given environment',
    http: {
      verb: 'get',
      path: '/producers/:producerId/envs/:envId/files/:fileName(*)'
    },
    accepts: [
      {
        arg: 'producerId',
        type: 'string',
        required: true,
        description: 'Producer id'
      },
      {
        arg: 'envId',
        type: 'string', required: true,
        description: 'Environment id'
      },
      {
        arg: 'fileName',
        type: 'string',
        required: true,
        description: 'File name'
      }
    ],
    returns: [
      {
        arg: 'data',
        type: 'file',
        root: true
      },
      {
        arg: 'ETag',
        type: 'string',
        http: {
          target: 'header'
        }
      },
      {
        arg: 'Content-type',
        type: 'string',
        http: {
          target: 'header'
        }
      }
    ]
  });

  Api.remoteMethod('upsertEnv', {
    description: 'Create or update an environment',
    http: {
      verb: 'put',
      path: '/producers/:producerId/envs/:envId'
    },
    accepts: [
      {
        arg: 'producerId',
        type: 'string',
        required: true,
        description: 'Producer id'
      },
      {
        arg: 'envId',
        type: 'string',
        required: true,
        description: 'Environment id'
      },
      {
        arg: 'env',
        type: 'Environment',
        required: true,
        http: {
          source: 'body'
        },
        description: 'The environment object'
      }
    ],
    returns: [
      {
        arg: 'env',
        type: 'Environment',
        required: true,
        root: true,
        description: 'The environment object'
      }
    ]
  });

  Api.remoteMethod('getEnv', {
    description: 'Get environment information',
    http: {
      verb: 'get',
      path: '/producers/:producerId/envs/:envId'
    },
    accepts: [
      {
        arg: 'producerId',
        type: 'string',
        required: true,
        description: 'Producer id'
      },
      {
        arg: 'envId',
        type: 'string',
        required: true,
        description: 'Environment id'
      },
    ],
    returns: [
      {
        arg: 'env',
        type: 'Environment',
        required: true,
        root: true,
        description: 'The environment object'
      }
    ]
  });

  Api.remoteMethod('deleteEnv', {
    description: 'Delete environment',
    http: {
      verb: 'del',
      path: '/producers/:producerId/envs/:envId'
    },
    accepts: [
      {
        arg: 'producerId',
        type: 'string',
        required: true,
        description: 'Producer id'
      },
      {
        arg: 'envId',
        type: 'string',
        required: true,
        description: 'Environment id'
      },
    ],
    returns: {
      arg: 'count',
      type: 'object',
      root: true
    }
  });
};
