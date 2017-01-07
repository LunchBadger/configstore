'use strict';

const chai = require('chai');
chai.use(require('chai-as-promised'));
const {assert} = chai;
const bluebird = require('bluebird');
const exec = bluebird.promisify(require('child_process').exec);
const express = require('express');
const fs = require('fs');
const path = require('path');
const rimraf = bluebird.promisify(require('rimraf'));

const githttp = require('../server/lib/githttp');
const gitrepo = require('../server/lib/gitrepo');

const TESTPORT = 12445;
const TESTPASS = 'foofoofoo';

describe('Git HTTP server', function() {
  let testPath = null;
  let repoRoot = null;
  let clonePath = null;
  let repoManager = null;
  let repo = null;
  let listener = null;
  let server = null;

  /* some utility functions for manipulating the Git repos */
  function startServer(...args) {
    return new Promise(resolve => {
      let httpStuff = githttp(...args);
      server = httpStuff.server;
      let app = express();
      app.enable('trust proxy');
      app.use('/git', httpStuff.router);
      listener = app.listen(TESTPORT, '0.0.0.0', resolve);
    });
  }

  function stopServer() {
    if (listener) {
      listener.close();
      listener = null;
    }
  }

  async function clone() {
    clonePath = path.join(testPath, 'clone');
    let url = `http://git:${TESTPASS}@localhost:${TESTPORT}/git/test-repo.git`;
    await exec(`git clone "${url}" ${clonePath}`);
  }

  function execClone(cmd) {
    return exec(cmd, {cwd: clonePath});
  }
  /* end of utility functions */

  beforeEach(async function() {
    // Create temporary dir
    testPath = fs.mkdtempSync('/tmp/configstore');

    // Create subdirectory for the repo manager root
    repoRoot = path.join(testPath, 'repos');
    fs.mkdirSync(repoRoot);

    // Set up a new repo
    repoManager = new gitrepo.RepoManager(repoRoot);
    repo = await repoManager.createRepo('test-repo');
    await githttp.configureRepo(repo.path, TESTPASS);

    // Seed the repo with an initial commit
    await repo.updateBranchFiles('master', null, {
      'test.txt': 'This is a test'
    });
  });

  afterEach(function() {
    // Clean up the created directories
    stopServer();
    return rimraf(testPath);
  });

  describe('when running a server', function() {
    beforeEach(async function() {
      await startServer(repoManager.root, true);
      await clone();
    });

    it('should succeed when fetching', async function() {
      const testFile = path.join(clonePath, 'test.txt');

      await execClone('git fetch');
      assert(fs.existsSync(testFile));
      assert.equal(fs.readFileSync(testFile, 'utf-8'), 'This is a test');
    });

    it('should succeed and emit "push" event when pushing', async function() {
      let numNotifications = 0;
      server.on('push', () => {
        numNotifications++;
      });

      const testFile = path.join(clonePath, 'test.txt');
      fs.writeFileSync(testFile, 'Blah blah');
      await execClone('git commit -a -m "test"');
      await execClone('git push origin master');

      assert.equal(numNotifications, 1);
    });

    it('should not emit a "push" event if a push fails', async function() {
      let numNotifications = 0;
      server.on('push', () => {
        numNotifications++;
      });

      const testFile = path.join(clonePath, 'test.txt');

      // Create one version of the branch
      fs.writeFileSync(testFile, 'First version');
      await execClone('git commit -a -m "test"');
      await execClone('git push origin master');

      assert.equal(numNotifications, 1);

      // Manufacture a conflicting version of the branch
      await execClone('git reset --hard HEAD^');
      fs.writeFileSync(testFile, 'Second version');
      await execClone('git commit -a -m "test"');
      await assert.isRejected(execClone('git push origin master'),
        'non-fast-forward');

      assert.equal(numNotifications, 1);
    });
  });

  describe('authentication', function() {
    it('should fail if bad password is used', async function() {
      await startServer(repoManager.root, true);

      clonePath = path.join(testPath, 'clone');
      let url = `http://bad:bad@localhost:${TESTPORT}/git/test-repo.git`;
      await assert.isRejected(exec(`git clone "${url}" ${clonePath}`));
    });

    it('should succeed if using private IP, when set', async function() {
      await startServer(repoManager.root, false);

      clonePath = path.join(testPath, 'clone');
      let url = `http://localhost:${TESTPORT}/git/test-repo.git`;
      await exec(`git clone "${url}" ${clonePath}`);
    });
  });
});
