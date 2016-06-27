'use strict';

let Promise = require('bluebird');
let gitrepo = require('../lib/gitrepo');
let error = require('../lib/error');

module.exports = function(Repo) {

  Repo.create = function(data) {
    let repo = new Repo(data);
    if (!repo.isValid()) {
      return Promise.reject(error.badRequestError('Invalid Repo format'));
    }
    return this.manager.createRepo(repo.id).then(_ => repo);
  };

  Repo.exists = function(id) {
    return this.manager.repoExists(id);
  };

  Repo.getOne = function(id) {
    return this.manager.getRepo(id)
      .then(repo => { return {id: repo.name} })
      .catch(gitrepo.RepoDoesNotExistError, (err) => {
        return Promise.reject(error.notFoundError(err.message));
      });
  };

  Repo.getAll = function() {
    return this.manager.getAllRepos().then((repos) => {
      return repos.map((repo) => { return {id: repo.name}; });
    });
  };

  Repo.destroyById = Repo.removeById = Repo.deleteById = function(id) {
    return this.manager.removeRepo(id).then((deleted) => {
      return {count: deleted ? 1 : 0}
    });
  };

  Repo.remoteMethod('create', {
    description: 'Create a new repository.',
    accepts: [{arg: 'repo', type: Repo, http: {source: 'body'}}],
    returns: [{arg: 'repo', type: Repo, root: true}],
    http: {verb: 'post', path: '/'}
  });

  Repo.remoteMethod('exists', {
    description: 'Check whether a repository exists.',
    accepts: [
      {arg: 'name', type: 'string', description: 'Repo name', required: true}
    ],
    returns: {arg: 'exists', type: 'boolean'},
    http: {verb: 'get', path: '/:id/exists'}
  });

  Repo.remoteMethod('getOne', {
    description: 'Retrieve the information for the given repo.',
    accepts: [
      {arg: 'id', type: 'string', description: 'Repo id', required: true}
    ],
    returns: {arg: 'data', type: Repo, root: true},
    http: {verb: 'get', path: '/:id'}
  });

  Repo.remoteMethod('getAll', {
    description: 'Retrieve information on all existing repos.',
    returns: {arg: 'data', type: [Repo], root: true},
    http: {verb: 'get', path: '/'}
  });

  Repo.remoteMethod('delete', {
    description: 'Delete a repo.',
    accepts: {arg: 'id', type: 'any', description: 'Repo id', required: true},
    http: {verb: 'del', path: '/:id'},
    returns: {arg: 'count', type: 'object', root: true}
  });

};
