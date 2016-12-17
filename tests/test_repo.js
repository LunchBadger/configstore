'use strict';

const chai = require('chai');
chai.use(require('chai-as-promised'));
const {assert} = chai;

const bluebird = require('bluebird');
const exec = bluebird.promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');
const rimraf = bluebird.promisify(require('rimraf'));

const gitrepo = require('../server/lib/gitrepo');

describe('GitRepo', function() {
  let repoManager = null;
  let testPath = null;

  beforeEach(function() {
    const rootPath = fs.mkdtempSync('/tmp/configstore');
    repoManager = new gitrepo.RepoManager(rootPath);
    testPath = repoManager.repoPath('test-repo');
  });

  afterEach(function() {
    return rimraf(repoManager.root);
  });

  describe('RepoManager', function() {
    describe('createRepo()', function() {
      it('should create an empty repo', async function() {
        assert.isFalse(fs.existsSync(testPath));
        const repo = await repoManager.createRepo('test-repo');

        assert.isTrue(fs.existsSync(testPath));
        assert.instanceOf(repo, gitrepo.GitRepo);

        await exec('git status', {cwd: testPath});
      });

      it('should return the repo if it already exists', async function() {
        const repo1 = await repoManager.createRepo('test-repo');
        const repo2 = await repoManager.createRepo('test-repo');

        assert.instanceOf(repo2, gitrepo.GitRepo);
        assert.equal(repo1.name, repo2.name);
        assert.equal(repo1.path, repo2.path);
      });
    });

    describe('getAllRepos()', function() {
      it('should return a list of repos', async function() {
        await repoManager.createRepo('test-repo-1');
        await repoManager.createRepo('test-repo-2');
        await repoManager.createRepo('test-repo-3');

        let repos = await repoManager.getAllRepos();
        assert.deepEqual(repos.map(repo => repo.name),
                         ['test-repo-1', 'test-repo-2', 'test-repo-3']);
      });

      it('should return empty array if there are no repos', async function() {
        let repos = await repoManager.getAllRepos();
        assert.isArray(repos);
        assert.equal(repos.length, 0);
      });
    });

    describe('getRepo()', function() {
      it('should return the repo', async function() {
        let repo1 = await repoManager.createRepo('test-repo');
        let repo2 = await repoManager.getRepo('test-repo');

        assert.instanceOf(repo2, gitrepo.GitRepo);
        assert.equal(repo1.name, repo2.name);
        assert.equal(repo2.path, testPath);
      });

      it('should throw if the repo does not exist', async function() {
        await assert.isRejected(repoManager.getRepo('test-repo'),
          gitrepo.RepoDoesNotExistError);
      });
    });

    describe('repoExists()', function() {
      it('should return true if repo exists', async function() {
        await repoManager.createRepo('test-repo');
        assert.isTrue(await repoManager.repoExists('test-repo'));
      });

      it('should return false if repo does not exist', async function() {
        assert.isFalse(await repoManager.repoExists('test-repo'));
      });
    });

    describe('removeRepo()', function() {
      it('should remove a repo', async function() {
        await repoManager.createRepo('test-repo');
        await repoManager.removeRepo('test-repo');
        assert.isFalse(fs.existsSync(testPath));
      });

      it('should succeed even if the repo does not exist', async function() {
        await repoManager.removeRepo('test-repo');
      });
    });

    describe('removeAllRepos()', function() {
      it('should remove all repos', async function() {
        await repoManager.createRepo('test-repo-1');
        await repoManager.createRepo('test-repo-2');
        await repoManager.createRepo('test-repo-3');

        await repoManager.removeAllRepos();

        let repos = await repoManager.getAllRepos();
        assert.equal(repos.length, 0);
      });

      it('should succeed even if there are no repos', async function() {
        await repoManager.removeAllRepos();
        await repoManager.getAllRepos();
      });
    });
  });

  describe('GitRepo', function() {
    let repo, revInitial, revSecond, revMaster, revBranched;

    beforeEach(async function() {
      repo = await repoManager.createRepo('test-repo');

      async function execAndCommit(commands, message) {
        for (let cmd of commands) {
          await exec(cmd, {cwd: testPath});
        }

        await exec('git add -A', {cwd: testPath});
        const stdout = await exec(`git commit -m "${message}"`,
                                    {cwd: testPath});
        return stdout.match(/^\S+ (\(root-commit\) )?([a-z0-9]+)\]/)[2];
      }

      /*
        Create the following structure:

            * Third commit [master]
          * | Branched commit [branched]
          |/
          * Second commit [second]
          * Initial commit

      */

      revInitial = await execAndCommit([
        'echo "First file" > foo.txt',
        'echo "Second file" > bar.txt',
      ], 'Initial commit');

      revSecond = await execAndCommit([
        'echo "Third file" > baz.txt',
      ], 'Second commit');

      await exec('git br second', {cwd: testPath});

      revMaster = await execAndCommit([
        'echo "More in the second file" >> bar.txt',
      ], 'Third commit');

      await exec('git checkout -b branched second', {cwd: testPath});

      revBranched = await execAndCommit([
        'echo "Some other stuff in second file" >> bar.txt',
      ], 'Branched commit');
    });

    describe('getBranches()', function() {
      it('should return existing branches', async function() {
        let branches = (await repo.getBranches()).sort();
        assert.deepEqual(branches, ['second', 'branched', 'master'].sort());
      });
    });

    describe('getBranchRevision()', function() {
      it('should return correct revision', async function() {
        let rev = await repo.getBranchRevision('second');
        assert.isTrue(rev.startsWith(revSecond));

        rev = await repo.getBranchRevision('master');
        assert.isTrue(rev.startsWith(revMaster));

        rev = await repo.getBranchRevision('branched');
        assert.isTrue(rev.startsWith(revBranched));
      });

      it('should throw if branch does not exist', async function() {
        await assert.isRejected(repo.getBranchRevision('fake'),
          gitrepo.InvalidBranchError);
      });
    });

    describe('deleteBranch()', function() {
      it('should delete the branch', async function() {
        await repo.deleteBranch('second');
        await assert.isRejected(repo.getBranchRevision('second'),
          gitrepo.InvalidBranchError);
      });

      it('should succeed even if the branch is checked out', async function() {
        await exec('git checkout branched', {cwd: testPath});
        await repo.deleteBranch('branched');
      });

      it('should throw if the branch does not exist', async function() {
        await assert.isRejected(repo.deleteBranch('fake'),
          gitrepo.InvalidBranchError);
      });
    });

    describe('upsertBranch()', function() {
      it('should create a new branch at existing revision', async function() {
        await repo.upsertBranch('four', revInitial);
        let revFour = await repo.getBranchRevision('four');
        assert.isTrue(revFour.startsWith(revInitial));
      });

      it('should create a new branch at existing branch', async function() {
        await repo.upsertBranch('four', 'branched');
        let revFour = await repo.getBranchRevision('four');
        assert.isTrue(revFour.startsWith(revBranched));
      });

      it('should throw if the revision does not exist', async function() {
        await assert.isRejected(repo.upsertBranch('four', 'fake'),
          gitrepo.RevisionNotFound);
      });
    });

    describe('getFile()', function() {
      it('should return an existing file', async function() {
        let result = await repo.getFile('master', 'foo.txt');
        assert.isArray(result);
        assert.equal(result.length, 2);
        let [content, chksum] = result;
        assert.equal(content, 'First file\n');
        assert.isTrue(chksum.startsWith(revMaster));
      });

      it('should throw if the branch does not exist', async function() {
        await assert.isRejected(repo.getFile('fake', 'foo.txt'),
          gitrepo.InvalidBranchError);
      });

      it('should throw if the file does not exist', async function() {
        await assert.isRejected(repo.getFile('master', 'fakefile'),
          gitrepo.FileNotFound);
      });
    });

    describe('updateBranchFiles()', async function() {
      let fullRevMaster, fullRevSecond;

      beforeEach(async function() {
        fullRevMaster = await repo.getBranchRevision('master');
        fullRevSecond = await repo.getBranchRevision('second');
      });

      it('should create a new commit with the given files', async function() {
        let revNew = await repo.updateBranchFiles('master', fullRevMaster, {
          'foo.txt': 'Second revision of first file!',
          'newfile.txt': 'This is a new file'
        });

        let [content, chksum] = await repo.getFile('master', 'foo.txt');
        assert.equal(content, 'Second revision of first file!');
        assert.isTrue(chksum.startsWith(revNew));

        [content, chksum] = await repo.getFile('master', 'newfile.txt');
        assert.equal(content, 'This is a new file');

        assert.isTrue(
          (await repo.getBranchRevision('master')).startsWith(revNew));
      });

      it('should not create a commit if nothing changed', async function() {
        let revNew = await repo.updateBranchFiles('master', fullRevMaster, {
          'foo.txt': 'First file\n'
        });

        assert.equal(revNew, fullRevMaster);
        assert.equal(await repo.getBranchRevision('master'), fullRevMaster);
      });

      it('should create directories when needed', async function() {
        await repo.updateBranchFiles('master', fullRevMaster, {
          'deeply/nested/file': 'Hello, world!'
        });

        let [content, _] = await repo.getFile('master', 'deeply/nested/file');
        assert.equal(content, 'Hello, world!');
      });

      it('should throw if the branch has moved on', async function() {
        await assert.isRejected(repo.updateBranchFiles('master',
          fullRevSecond, {
            'foo.txt': 'Second revision of first file!',
            'newfile.txt': 'This is a new file'
          }), gitrepo.OptimisticConcurrencyError);
      });

      it('should throw if the branch does not exist', async function() {
        await assert.isRejected(repo.updateBranchFiles('fake', fullRevSecond, {
          'foo.txt': 'Second revision of first file!',
          'newfile.txt': 'This is a new file'
        }), gitrepo.InvalidBranchError);
      });
    });

    describe('setConfigVariables()', function() {
      it('should set config variables', async function() {
        let cfgPath = path.join(repo.path, '.git/config');

        let config = fs.readFileSync(cfgPath, 'utf-8');
        assert.isFalse(config.includes('denycurrentbranch'));
        assert.isFalse(config.includes('verbosity'));

        await repo.setConfigVariables({
          'receive.denycurrentbranch': 'ignore',
          'merge.verbosity': 1
        });

        config = fs.readFileSync(cfgPath, 'utf-8');
        assert.isTrue(config.includes('[receive]'));
        assert.isTrue(config.includes('denycurrentbranch = ignore'));
        assert.isTrue(config.includes('[merge]'));
        assert.isTrue(config.includes('verbosity = 1'));
      });
    });

    describe('getConfigVariables()', function() {
      it('should retrieve config variables', async function() {
        assert.equal(await repo.getConfigVariable('core.bare'), 'false');

        await repo.setConfigVariables({
          'receive.denycurrentbranch': 'ignore',
          'merge.verbosity': 1
        });

        assert.equal(await repo.getConfigVariable('receive.denycurrentbranch'),
                     'ignore');
        assert.equal(await repo.getConfigVariable('merge.verbosity'), '1');
      });

      it('should throw if the variable does not exist', async function() {
        await assert.isRejected(repo.getConfigVariable('fake.variable'),
          gitrepo.GitRepoError);
      });
    });
  });
});
