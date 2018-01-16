'use strict';

const githttp = require('../lib/githttp');

module.exports = function gitComponent (app, options) {
  const {repoPath, gitAuthOnPrivateNetworks} = app.get('lunchBadger');
  const {router, server} = githttp(repoPath, gitAuthOnPrivateNetworks);
  app.models.ConfigStoreApi.gitServer = server;
  app.set('trust proxy', true);
  app.use(options.mountPath, router);
};
