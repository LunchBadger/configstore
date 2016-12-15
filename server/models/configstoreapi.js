'use strict';

const crypto = require('crypto');
const path = require('path');

const ConfigValidator = require('../lib/configvalidator');
const error = require('../lib/error');
const gitrepo = require('../lib/gitrepo');

const CONFIG_SCHEMA_DIR = path.resolve(__dirname, '../schema');

module.exports = function(ConfigStoreApi) {
  const validator = new ConfigValidator(CONFIG_SCHEMA_DIR);
  validator.addSchema('definitions');
  validator.addSchema('project', /^project\.json$/);

  ConfigStoreApi.create = async function(data) {
    let repo = new this.app.models.Producer(data);
    if (!repo.isValid()) {
      throw error.badRequestError('Invalid Producer format');
    }
    let repoObj = await this._createRepo(repo.id);
    repoObj.cleanup();
    return repo;
  };

  ConfigStoreApi.exists = async function(id) {
    return await this.manager.repoExists(id);
  };

  ConfigStoreApi._getRepo = async function(id) {
    try {
      return await this.manager.getRepo(id);
    } catch (err) {
      if (err instanceof gitrepo.RepoDoesNotExistError) {
        throw error.notFoundError(err.message);
      }
      throw err;
    }
  };

  ConfigStoreApi._createRepo = async function(id) {
    let repo = await this.manager.createRepo(id);
    let key = crypto.randomBytes(16).toString('hex');
    repo.setConfigVariables({
      'receive.denycurrentbranch': 'ignore',
      'lunchbadger.accesskey': key
    });
    return repo;
  };

  ConfigStoreApi._getOrCreateRepo = async function(id) {
    if (await this.manager.repoExists(id)) {
      return await this.manager.getRepo(id);
    } else {
      return await this._createRepo(id);
    }
  };

  ConfigStoreApi._getRepoInfo = async function(repo) {
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

  ConfigStoreApi.getOne = async function(id) {
    let repo = await this._getRepo(id);
    try {
      return await this._getRepoInfo(repo);
    } finally {
      repo.cleanup();
    }
  };

  ConfigStoreApi.getAll = async function() {
    let repos = await this.manager.getAllRepos();
    try {
      return await Promise.all(repos.map(repo => this._getRepoInfo(repo)));
    } finally {
      repos.forEach(repo => repo.cleanup());
    }
    return result;
  };

  ConfigStoreApi.delete = async function(id) {
    let deleted = await this.manager.removeRepo(id);
    return {count: deleted ? 1 : 0};
  };

  ConfigStoreApi.updateEnvFiles = function(producerId, envId, data,
                                           parentRevision, cb) {
    // Note that this method does not return a Promise, since its return value
    // ends up as the value of the ETag header. Setting a header based on the
    // response value only seems to work when calling the cb, not through the
    // Promise.
    (async () => {
      if (Object.keys(data).length < 1) {
        cb(error.badRequestError('Must specify some data'));
        return;
      }

      // Validate
      for (const filePath in data) {
        const fileName = filePath.split('/').pop();
        if (!await validator.validate(fileName, data[filePath])) {
          const errors = validator.errors.join('\n');
          cb(error.badRequestError(`Validation of ${filePath} failed:\n` +
                                   errors));
          return;
        }
      }

      let repo = await this._getOrCreateRepo(producerId);
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
      } finally {
        repo.cleanup();
      }
    })();
  };

  ConfigStoreApi.downloadFile = function(producerId, envId, fileName, cb) {
    (async () => {
      let repo = null;
      try {
        repo = await this._getRepo(producerId);
        let [content, chksum] = await repo.getFile('env/' + envId, fileName);
        cb(null, content, chksum, 'application/octet-stream');
      } catch (err) {
        if (err instanceof gitrepo.FileNotFound) {
          cb(error.notFoundError(`File ${fileName} does not exist`));
        } else if (err instanceof gitrepo.InvalidBranchError) {
          cb(error.notFoundError(`Environment ${envId} does not exist`));
        } else if (err instanceof gitrepo.RepoDoesNotExistError) {
          cb(error.notFoundError(`Producer ${producerId} does not exist`));
        } else {
          cb(err);
        }
      } finally {
        if (repo) {
          repo.cleanup();
        }
      }
    })();
  };

  ConfigStoreApi.upsertEnv = async function(producerId, envId, data) {
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
    } finally {
      repo.cleanup();
    }
  };

  ConfigStoreApi.getEnv = async function(producerId, envId) {
    let repo = await this._getRepo(producerId);
    let revision = undefined;
    try {
      revision = await repo.getBranchRevision('env/' + envId);
    } catch (err) {
      if (err instanceof gitrepo.InvalidBranchError) {
        throw error.notFoundError(err.message);
      }
      throw err;
    } finally {
      repo.cleanup();
    }

    return {
      id: envId,
      revision: revision
    };
  };

  ConfigStoreApi.deleteEnv = async function(producerId, envId) {
    let repo = await this._getRepo(producerId);
    let deleted = undefined;
    try {
      deleted = await repo.deleteBranch('env/' + envId);
    } catch (err) {
      if (err instanceof gitrepo.InvalidBranchError) {
        throw error.notFoundError(err.message);
      }
      throw err;
    } finally {
      repo.cleanup();
    }
    return {count: deleted ? 1 : 0};
  };

  ConfigStoreApi.remoteMethod('create', {
    description: 'Create a new producer.',
    http: {
      verb: 'post',
      path: '/'
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

  ConfigStoreApi.remoteMethod('exists', {
    description: 'Check whether a producer exists.',
    http: {
      verb: 'get',
      path: '/:id/exists'
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

  ConfigStoreApi.remoteMethod('getOne', {
    description: 'Retrieve the information for the given producer.',
    http: {
      verb: 'get',
      path: '/:id'
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

  ConfigStoreApi.remoteMethod('getAll', {
    description: 'Retrieve information on all existing producers.',
    http: {
      verb: 'get',
      path: '/'
    },
    returns: {
      arg: 'data',
      type: ['Producer'],
      root: true
    }
  });

  ConfigStoreApi.remoteMethod('delete', {
    description: 'Delete a producer.',
    http: {
      verb: 'del',
      path: '/:id'
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

  ConfigStoreApi.remoteMethod('updateEnvFiles', {
    description: 'Add a new revision, updating the given files.',
    http: {
      verb: 'patch',
      path: '/:producerId/envs/:envId/files'
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

  ConfigStoreApi.remoteMethod('downloadFile', {
    description: 'Retrieve a file from the given environment',
    http: {
      verb: 'get',
      path: '/:producerId/envs/:envId/files/:fileName(*)'
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

  ConfigStoreApi.remoteMethod('upsertEnv', {
    description: 'Create or update an environment',
    http: {
      verb: 'put',
      path: '/:producerId/envs/:envId'
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

  ConfigStoreApi.remoteMethod('getEnv', {
    description: 'Get environment information',
    http: {
      verb: 'get',
      path: '/:producerId/envs/:envId'
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

  ConfigStoreApi.remoteMethod('deleteEnv', {
    description: 'Delete environment',
    http: {
      verb: 'del',
      path: '/:producerId/envs/:envId'
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
