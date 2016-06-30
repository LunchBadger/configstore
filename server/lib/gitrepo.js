'use strict';

let Promise = require('bluebird');
let fs = require('fs-ext');
Promise.promisifyAll(fs);
let git = require('nodegit');
let path = require('path');
let rimraf = Promise.promisify(require('rimraf'));
let CustomError = require('./error').CustomError;
let lock = require('./lock');
let debug = require('debug')('configstore:git');

class GitRepoError extends CustomError {}
class RepoDoesNotExistError extends GitRepoError {
  constructor(repoName) {
    super(`Repo "${repoName}" does not exist`);
    this.repoName = repoName;
  }
}

class OperationInProgress extends GitRepoError {
  constructor(repoName) {
    super(`Repo "${repoName}" already has an operation in progress`);
    this.repoName = repoName;
  }
}

class OptimisticConcurrencyError extends GitRepoError {
  constructor(repoName, branchName) {
    super(`Branch "${branchName}" in repo "${repoName}" has changed.` +
          'Please refresh and try again');
    this.repoName = repoName;
    this.branchName = branchName;
  }
}

class InvalidBranchError extends GitRepoError {
  constructor(repoName, branchName) {
    super(`Branch "${branchName}" in repo "${repoName}" does not exist`);
    this.repoName = repoName;
    this.branchName = branchName;
  }
}

class FileNotFound extends GitRepoError {
  constructor(repoName, branchName, fileName) {
    super(`File "${fileName}" on branch "${branchName}" ` +
          `in repo "${repoName}" does not exist`);
    this.repoName = repoName;
    this.branchName = branchName;
    this.fileName = fileName;
  }
}

class RevisionNotFound extends GitRepoError {
  constructor(repoName, revision) {
    super(`Revision "${revision} in repo "${repoName} not found`);
    this.repoName = repoName;
    this.revision = revision;
  }
}

class RepoManager {
  constructor(root) {
    this.root = path.resolve(root);
  }

  /**
   * Lists all existing repositories.
   * @returns {Promise.<Array.<GitRepo>>}
   */
  getAllRepos() {
    return fs
      .readdirAsync(this.root)
      .map(potentialFile => path.join(this.root, potentialFile))
      .filter((potentialPath) => {
        return fs
          .statAsync(potentialPath)
          .then(stat => stat.isDirectory() && potentialPath.endsWith('.git'));
      })
      .map(path => new GitRepo(path));
  }

  /**
   * Removes all existing repositories.
   */
  removeAllRepos() {
    return this.getAllRepos().each(repo => rimraf(repo.path));
  }

  /**
   * Get the path to the repo with the given name.
   * @param {String} repoName - the name of the repository.
   * @returns {String} Absolute path to the repo.
   */
  repoPath(repoName) {
    return path.join(this.root, repoName + '.git');
  }

  /**
   * Determines whether the repo exists.
   * @param {String} repoName - the name of the repository.
   * @returns {Promise.<Boolean>}
   */
  repoExists(repoName) {
    let path = this.repoPath(repoName);
    return fs.statAsync(path).then((res) => true).catch(() => false);
  }

  /**
   * Deletes the repo, if it exists.
   * @param {String} repoName - the name of the repository.
   * @returns {Boolean} true if the repo existed and was deleted.
   */
  removeRepo(repoName) {
    return this.repoExists(repoName).then((exists) => {
      if (exists) {
        return rimraf(this.repoPath(repoName)).then(_ => true);
      } else {
        return false;
      }
    });
  }

  /**
   * Creates the repo, if it does not yet exist.
   * @param {String} repoName - the name of the repository.
   * @returns {Promise.<GitRepo>} the newly created repository.
   */
  createRepo(repoName) {
    return this
      .repoExists(repoName)
      .then((exists) => {
        if (!exists) {
          let path = this.repoPath(repoName);
          return fs
            .mkdirAsync(this.repoPath(repoName))
            .then(() => {
              return git.Repository.init(path, 0);
            });
        }
      })
      .then(() => {
        return this.getRepo(repoName);
      });
  }

  /**
   *
   * @param repoName
   * @returns {Promise.<GitRepo>}
   */
  getRepo(repoName) {
    return this
      .repoExists(repoName)
      .then((exists) => {
        if (exists) {
          return new GitRepo(this.repoPath(repoName));
        } else {
          throw new RepoDoesNotExistError(repoName);
        }
      });
  }
}

class GitRepo {
  constructor(dirPath) {
    this.name = path.basename(dirPath, '.git');
    this.path = dirPath;
    this.lockPath = path.join(this.path, '.git', 'txn.lock');
    this._repo = null;
  }

  repo() {
    if (this._repo) {
      return Promise.resolve(this._repo);
    } else {
      return git.Repository.open(this.path).then(repo_ => {
        this._repo = repo_;
        return this._repo;
      });
    }
  }

  sign() {
    let now = new Date();
    return git.Signature.create('LunchBadger', 'admin@lunchbadger.com',
                                now.getTime() / 1000, now.getTimezoneOffset());
  }

  updateBranchFiles(branchName, parentRevision, files) {
    let repo = null;
    let index = null;
    let parents = [];

    let author = this.sign();
    let committer = author;
    let commitMessage = 'Changes';

    return lock(this.lockPath, () => {
      return this
        .repo()
        .then(repo_ => {
          repo = repo_;
        })
        // Check out the given branch and return the latest commit or null
        .then(ref => {
          if (repo.headUnborn()) {
            debug(`Initial commit, changing HEAD ref to ${branchName}`);
            return git.Reference
              .lookup(repo, 'HEAD')
              .then(ref => {
                return ref.symbolicSetTarget(`refs/heads/${branchName}`,
                                             'Setting initial branch name');
              })
              .then(() => null);
          } else {
            debug(`Not initial commit, checking out branch ${branchName}`);
            return repo
              .checkoutBranch(branchName)
              .then(() => repo.getHeadCommit())
              .catch((err) => {
                if (err.toString().indexOf('no reference found') >= 0) {
                  throw new GitRepoError('Invalid branch');
                }
                throw err;
              });
          }
        })
        // Check that we're on the correct revision as per given parentRevision
        .then((headCommit) => {
          if (parentRevision && headCommit) {
            debug(repo, parentRevision, parentRevision.length);
            return git.Commit
              .lookupPrefix(repo, parentRevision, parentRevision.length)
              .catch(err => {
                if (err.toString().indexOf('Unable to parse OID') > 0) {
                  throw new OptimisticConcurrencyError(this.name, branchName);
                }
                throw err;
              })
              .then(parentCommit_ => {
                if (!headCommit.id().equal(parentCommit_.id())) {
                  throw new OptimisticConcurrencyError(this.name, branchName);
                }
                parents.push(parentCommit_);
              });
          } else if (parentRevision && !headCommit) {
            throw new GitRepoError('Given parent revision is invalid');
          } else if (!parentRevision && headCommit) {
            throw new OptimisticConcurrencyError(this.name, branchName);
          }
        })
        // Update the files to the desired content
        .then(() => {
          debug('Writing files to working dir');
          let allFiles = [];
          for (let fname in files) {
            let fullPath = path.join(this.path, fname);
            allFiles.push(fs.writeFileAsync(fullPath, files[fname]));
          }
          return Promise.all(allFiles);
        })
        // Update the index
        .then(() => repo.getStatus())
        .then(changes => {
          if (changes.length > 0) {
            debug(`Changes detected (${changes.length} files), committing`);
            return repo
              .refreshIndex()
              .then(index_ => {
                index = index_;
                return index.addAll();
              })
              .then(() => index.write())
              .then(() => index.writeTree())
              // Commit
              .then(oid => {
                return repo.createCommit('HEAD', author, committer,
                                         commitMessage, oid, parents);
              })
              .then(oid => {
                return index
                  .clear()
                  .then(() => oid.tostrS());
              });
          } else {
            debug('No changes detected');
            return parentRevision;
          }
        })
        .then(oid => {
          debug('Done', oid);
          return oid;
        });
    });
  }

  getFile(branchName, fileName) {
    let repo = null;
    let chksum = null;

    return this
      .repo()
      .then(repo_ => {
        repo = repo_;
        return repo.getBranchCommit(branchName);
      })
      .then(commit => {
        chksum = commit.id().tostrS();
        return commit.getTree();
      })
      .then(tree => tree.getEntry(fileName))
      .then(entry => {
        if (!entry.isBlob()) {
          throw GitRepoError(`Path ${fileName} is not a file`);
        }
        return entry.getBlob();
      })
      .then(blob => {
        if (blob.rawsize() > (1024 * 1024)) {
          // Hopefully prevent people crashing this service by uploading large
          // files and then downloading them through this interface.
          throw GitRepoError(`File ${fileName} is too big`);
        }
        return [blob.toString(), chksum];
      })
      .catch(err => {
        let msg = err.toString();
        if (msg.indexOf('does not exist in the given tree') >= 0) {
          throw new FileNotFound(this.name, branchName, fileName);
        } else {
          throw err;
        }
      });
  }

  lookupCommit(revspec) {
    let repo = null;
    return this
      .repo()
      .then(repo_ => {
        repo = repo_;
        return git.AnnotatedCommit.fromRevspec(repo, revspec);
      })
      .then(annotatedCommit => annotatedCommit.id())
      .catch(err => {
        if (err.toString().indexOf('not found') >= 0) {
          throw new RevisionNotFound(this.name, revspec);
        }
        throw err;
      });
  }

  upsertBranch(branchName, revision) {
    let repo = null;
    let oid = null;

    return this
      .lookupCommit(revision)
      .then(oid_ => {
        oid = oid_;
        return this.repo();
      })
      .then(repo_ => {
        repo = repo_;
        return repo.createBranch(branchName, oid, 1, this.sign(),
                                 'Upsert branch');
      })
      .then(() => oid.tostrS());
  }

  getBranches() {
    return this
      .repo()
      .then(repo => repo.getReferences(git.Reference.TYPE.LISTALL))
      .then(references => {
        return references
          .filter(ref => ref.isBranch())
          .map(ref => ref.name().replace(/refs\/heads\//, ''));
      });
  }

  getBranchRevision(branchName) {
    return this
      .repo()
      .then(repo => repo.getBranchCommit(branchName))
      .then(commit => commit.id().tostrS())
      .catch(err => {
        if (err.toString().indexOf('no reference found') >= 0) {
          throw new InvalidBranchError(this.name, branchName);
        }
        throw err;
      });
  }

  deleteBranch(branchName) {
    let repo = null;

    return this
      .repo()
      .then(repo_ => {
        repo = repo_;
        return git.Branch.lookup(repo, branchName, git.Branch.BRANCH.LOCAL);
      })
      .then(ref => {
        if (ref.isHead()) {
          repo.detachHead();
        }
        return git.Branch.delete(ref);
      })
      .then(result => result == 0 ? 1 : 0)
      .catch(err => {
        if (err.toString().indexOf('Cannot locate') >= 0) {
          throw new InvalidBranchError(this.name, branchName);
        }
      });
  }

  testMethod(obj) {
    return this.getBranches();
  }
}

module.exports = {
  RepoManager,
  GitRepoError,
  RepoDoesNotExistError,
  OperationInProgress,
  OptimisticConcurrencyError,
  InvalidBranchError,
  FileNotFound,
  RevisionNotFound
};

