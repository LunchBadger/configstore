'use strict';

let RepoManager = require('../lib/gitrepo').RepoManager;

module.exports = function(app) {
  const repoPath = app.get('lunchBadger').repoPath;
  app.models.ConfigStoreApi.manager = new RepoManager(repoPath);
  console.log(`Serving repos from ${app.models.ConfigStoreApi.manager.root}`);
};
