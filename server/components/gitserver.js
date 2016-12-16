'use strict';

const githttp = require('../lib/githttp');

module.exports = function gitComponent(app, options) {
  const {repoPath, gitAuthOnPrivateNetworks} = app.get('lunchBadger');
  const router = githttp(repoPath, gitAuthOnPrivateNetworks);
  app.set('trust proxy', true);
  app.use(options.mountPath, router);
};
