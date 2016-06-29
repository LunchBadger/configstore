'use strict';

let RepoManager = require('../lib/gitrepo').RepoManager;

module.exports = function(app) {
  app.models.Api.manager = new RepoManager(app.get('lunchBadger').repoPath);
};
