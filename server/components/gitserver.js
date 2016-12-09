'use strict';

const githttp = require('../lib/githttp');

module.exports = function gitComponent(app, options) {
  const repoPath = app.get('lunchBadger').repoPath;
  const router = githttp(repoPath);
  app.use(options.mountPath, router);
};
