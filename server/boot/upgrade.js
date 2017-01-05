'use strict';

const fs = require('fs');
const path = require('path');
const POST_UPDATE_HOOK = require('../lib/constants').POST_UPDATE_HOOK;

module.exports = function(app) {
  console.log('Upgrading data');
  const {repoPath} = app.get('lunchBadger');

  for (let repo of fs.readdirSync(repoPath)) {
    const thisPath = path.join(repoPath, repo);
    const stats = fs.statSync(thisPath);
    if (stats.isDirectory()) {
      console.log('> ' + thisPath);
      upgradeRepo(thisPath);
    }
  }
};

function upgradeRepo(repoPath) {
  ensurePostUpdateHook(repoPath);
}

function ensurePostUpdateHook(repoPath) {
  const hookPath = path.join(repoPath, '.git', 'hooks', 'post-receive');
  if (!fs.existsSync(hookPath)) {
    fs.writeFileSync(hookPath, POST_UPDATE_HOOK, {mode: 0o775});
  }
}
