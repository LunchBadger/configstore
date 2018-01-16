'use strict';

let Promise = require('bluebird');
let debug = require('debug')('configstore:git');
let fs = require('fs-ext');
Promise.promisifyAll(fs);
let git = require('nodegit');
let path = require('path');
let mkdirp = Promise.promisify(require('mkdirp'));
let rimraf = Promise.promisify(require('rimraf'));

let CustomError = require('./error').CustomError;
let lock = require('./lock');

class GitRepoError extends CustomError {}
class RepoDoesNotExistError extends GitRepoError {
  constructor (repoName) {
    super(`Repo "${repoName}" does not exist`);
    this.repoName = repoName;
  }
}

class OperationInProgress extends GitRepoError {
  constructor (repoName) {
    super(`Repo "${repoName}" already has an operation in progress`);
    this.repoName = repoName;
  }
}

class OptimisticConcurrencyError extends GitRepoError {
  constructor (repoName, branchName) {
    super(`Branch "${branchName}" in repo "${repoName}" has changed.` +
          'Please refresh and try again');
    this.repoName = repoName;
    this.branchName = branchName;
  }
}

class InvalidBranchError extends GitRepoError {
  constructor (repoName, branchName) {
    super(`Branch "${branchName}" in repo "${repoName}" does not exist`);
    this.repoName = repoName;
    this.branchName = branchName;
  }
}

class FileNotFound extends GitRepoError {
  constructor (repoName, branchName, fileName) {
    super(`File "${fileName}" on branch "${branchName}" ` +
          `in repo "${repoName}" does not exist`);
    this.repoName = repoName;
    this.branchName = branchName;
    this.fileName = fileName;
  }
}

class RevisionNotFound extends GitRepoError {
  constructor (repoName, revision) {
    super(`Revision "${revision}"" in repo "${repoName}" not found`);
    this.repoName = repoName;
    this.revision = revision;
  }
}

class RepoManager {
  constructor (root) {
    this.root = path.resolve(root);
  }

  /**
   * Lists all existing repositories.
   * @returns {Promise.<Array.<GitRepo>>}
   */
  async getAllRepos () {
    return fs.readdirAsync(this.root)
      .map(potentialFile => path.join(this.root, potentialFile))
      .filter(async (potentialPath) => {
        let stat = await fs.statAsync(potentialPath);
        return (stat.isDirectory() && potentialPath.endsWith('.git'));
      })
      .map(path => new GitRepo(path));
  }

  /**
   * Removes all existing repositories.
  */
  async removeAllRepos () {
    let repos = await this.getAllRepos();
    return repos.forEach(repo => rimraf(repo.path));
  }

  /**
   * Get the path to the repo with the given name.
   * @param {String} repoName - the name of the repository.
   * @returns {String} Absolute path to the repo.
   */
  repoPath (repoName) {
    return path.join(this.root, repoName + '.git');
  }

  /**
   * Determines whether the repo exists.
   * @param {String} repoName - the name of the repository.
   * @returns {Promise.<Boolean>}
   */
  async repoExists (repoName) {
    let path = this.repoPath(repoName);
    try {
      await fs.statAsync(path);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Deletes the repo, if it exists.
   * @param {String} repoName - the name of the repository.
   * @returns {Boolean} true if the repo existed and was deleted.
   */
  async removeRepo (repoName) {
    if (await this.repoExists(repoName)) {
      await rimraf(this.repoPath(repoName));
      return true;
    } else {
      return false;
    }
  }

  /**
   * Creates the repo, if it does not yet exist.
   * @param {String} repoName - the name of the repository.
   * @returns {Promise.<GitRepo>} the newly created repository.
   */
  async createRepo (repoName) {
    if (!await this.repoExists(repoName)) {
      let path = this.repoPath(repoName);
      await fs.mkdirAsync(this.repoPath(repoName));
      await git.Repository.init(path, 0);
    }
    return await this.getRepo(repoName);
  }

  /**
   *
   * @param repoName
   * @returns {Promise.<GitRepo>}
   */
  async getRepo (repoName) {
    if (await this.repoExists(repoName)) {
      return new GitRepo(this.repoPath(repoName));
    } else {
      throw new RepoDoesNotExistError(repoName);
    }
  }
}

class GitRepo {
  constructor (dirPath) {
    this.name = path.basename(dirPath, '.git');
    this.path = dirPath;
    this.lockPath = path.join(this.path, '.git', 'txn.lock');
    this._repo = undefined;
  }

  async repo () {
    if (!this._repo) {
      this._repo = await git.Repository.open(this.path);
    }
    return this._repo;
  }

  cleanup () {
    if (this._repo) {
      this._repo.free();
    }
  }

  sign () {
    let now = new Date();
    return git.Signature.create('LunchBadger', 'admin@lunchbadger.com',
      now.getTime() / 1000, now.getTimezoneOffset());
  }

  async updateBranchFiles (branchName, parentRevision, files) {
    let author = this.sign();
    let committer = author;
    let commitMessage = 'Changes';

    return await lock(this.lockPath, async () => {
      let repo = await this.repo();

      // Check out the given branch and return the latest commit or null
      let headCommit;

      if (repo.headUnborn()) {
        debug(`Initial commit, changing HEAD ref to ${branchName}`);
        let ref = await git.Reference.lookup(repo, 'HEAD');
        await ref.symbolicSetTarget(`refs/heads/${branchName}`,
          'Setting initial branch name');
      } else {
        debug(`Not initial commit, checking out branch ${branchName}`);
        try {
          await repo.checkoutBranch(branchName);
          headCommit = await repo.getHeadCommit();
        } catch (err) {
          if (err.toString().indexOf('no reference found') >= 0) {
            throw new InvalidBranchError(repo.name, branchName);
          }
          throw err;
        }
      }

      // Check that we're on the correct revision as per given parentRevision
      let parents = [];
      if (parentRevision && headCommit) {
        let parentCommit;
        try {
          parentCommit = await git.Commit.lookupPrefix(repo, parentRevision,
            parentRevision.length);
        } catch (err) {
          if (err.toString().indexOf('Unable to parse OID') > 0) {
            throw new OptimisticConcurrencyError(this.name, branchName);
          }
          throw err;
        }

        if (!headCommit.id().equal(parentCommit.id())) {
          throw new OptimisticConcurrencyError(this.name, branchName);
        }
        parents.push(parentCommit);
      } else if (parentRevision && !headCommit) {
        throw new GitRepoError(
          'Parent revision is given, but the environment is new');
      } else if (!parentRevision && headCommit) {
        throw new OptimisticConcurrencyError(this.name, branchName);
      }

      // Update the files to the desired content
      debug('Writing files to working dir');
      let allFiles = [];
      for (let fname in files) {
        let fullPath = path.join(this.path, fname);
        allFiles.push((async () => {
          await mkdirp(path.dirname(fullPath));
          await fs.writeFileAsync(fullPath, files[fname]);
        })());
      }
      await Promise.all(allFiles);

      // Update the index
      let changes = await repo.getStatus();
      if (changes.length > 0) {
        debug(`Changes detected (${changes.length} files), committing`);
        let index = await repo.refreshIndex();
        await index.addAll();
        await index.write();
        let indexOid = await index.writeTree();
        let commitOid = await repo.createCommit('HEAD', author, committer,
          commitMessage, indexOid,
          parents);
        await index.clear();
        debug('Done', commitOid);
        return commitOid.tostrS();
      } else {
        debug('No changes detected');
        return parentRevision;
      }
    });
  }

  async getFile (branchName, fileName) {
    let repo = await this.repo();

    let commit;
    try {
      commit = await repo.getBranchCommit(branchName);
    } catch (err) {
      if (err.toString().indexOf('no reference found') >= 0) {
        throw new InvalidBranchError(this.name, branchName);
      }
      throw err;
    }

    let chksum = commit.id().tostrS();
    let tree = await commit.getTree();

    let entry;
    try {
      entry = await tree.getEntry(fileName);
    } catch (err) {
      if (err.toString().indexOf('does not exist in the given tree') >= 0) {
        throw new FileNotFound(this.name, branchName, fileName);
      }
      throw err;
    }
    if (!entry.isBlob()) {
      throw GitRepoError(`Path ${fileName} is not a file`);
    }

    let blob = await entry.getBlob();
    if (blob.rawsize() > (1024 * 1024)) {
      // Hopefully prevent people crashing this service by uploading large
      // files and then downloading them through this interface.
      throw GitRepoError(`File ${fileName} is too big`);
    }
    return [blob.toString(), chksum];
  }

  async lookupCommit (revspec) {
    let repo = await this.repo();

    try {
      let annCommit = await git.AnnotatedCommit.fromRevspec(repo, revspec);
      return annCommit.id();
    } catch (err) {
      if (err.toString().indexOf('not found') >= 0) {
        throw new RevisionNotFound(this.name, revspec);
      }
      throw err;
    }
  }

  async upsertBranch (branchName, revision) {
    return await lock(this.lockPath, async () => {
      let oid = await this.lookupCommit(revision);
      let repo = await this.repo();
      await repo.createBranch(branchName, oid, 1, this.sign(), 'Upsert branch');
      return oid.tostrS();
    });
  }

  async getBranches () {
    let repo = await this.repo();
    let references = await repo.getReferences(git.Reference.TYPE.LISTALL);
    return references
      .filter(ref => ref.isBranch())
      .map(ref => ref.name().replace(/refs\/heads\//, ''));
  }

  async getBranchRevision (branchName) {
    let repo = await this.repo();

    try {
      let commit = await repo.getBranchCommit(branchName);
      return commit.id().tostrS();
    } catch (err) {
      if (err.toString().indexOf('no reference found') >= 0) {
        throw new InvalidBranchError(this.name, branchName);
      }
      throw err;
    }
  }

  async deleteBranch (branchName) {
    return await lock(this.lockPath, async () => {
      let repo = await this.repo();
      let ref;
      try {
        ref = await git.Branch.lookup(repo, branchName,
          git.Branch.BRANCH.LOCAL);
      } catch (err) {
        if (err.toString().indexOf('Cannot locate') >= 0) {
          throw new InvalidBranchError(this.name, branchName);
        }
      }
      if (ref.isHead()) {
        repo.detachHead();
      }
      let result = await git.Branch.delete(ref);
      return result === 0 ? 1 : 0;
    });
  }

  async setConfigVariables (data) {
    return await lock(this.lockPath, async () => {
      let repo = await this.repo();
      let config = await repo.config();

      for (let key in data) {
        let value = data[key];

        switch (typeof value) {
          case 'number':
            config.setInt64(key, value);
            break;
          case 'string':
            await config.setString(key, value);
            break;
          default:
            throw new GitRepoError(`Invalid config option value for "${key}"`);
        }
      }
    });
  }

  async getConfigVariable (name) {
    let repo = await this.repo();
    let config = await repo.config();
    let buf;

    try {
      buf = await config.getStringBuf(name);
    } catch (err) {
      if (err.toString().indexOf('was not found')) {
        throw new GitRepoError(err.message);
      }
      throw err;
    }

    return buf.toString('utf-8');
  }
}

module.exports = {
  RepoManager,
  GitRepoError,
  GitRepo,
  RepoDoesNotExistError,
  OperationInProgress,
  OptimisticConcurrencyError,
  InvalidBranchError,
  FileNotFound,
  RevisionNotFound
};
