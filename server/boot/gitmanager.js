'use strict';

let RepoManager = require('../lib/gitrepo').RepoManager;

module.exports = function(app) {
  app.models.Repo.manager = new RepoManager(app.get('lunchBadger').repoPath);
};
