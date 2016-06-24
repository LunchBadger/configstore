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

  Repo.findById = function(id) {
    return this.manager.getRepo(id)
      .then(repo => { return {id: repo.name} })
      .catch(gitrepo.RepoDoesNotExistError, (err) => {
        return Promise.reject(error.notFoundError(err.message));
      });
  };

  Repo.find = function() {
    return this.manager.getAllRepos().then((repos) => {
      return repos.map((repo) => { return {id: repo.name}; });
    });
  };

  Repo.destroyById = Repo.removeById = Repo.deleteById = function(id) {
    return this.manager.removeRepo(id).then((deleted) => {
      return {count: deleted ? 1 : 0}
    });
  };

  Repo.disableRemoteMethod('upsert', true);
  Repo.disableRemoteMethod('updateAll', true);
  Repo.disableRemoteMethod('findOne', true);
  Repo.disableRemoteMethod('createChangeStream', true);
  Repo.disableRemoteMethod('count', true);
  Repo.disableRemoteMethod('updateAttributes', false);
};
