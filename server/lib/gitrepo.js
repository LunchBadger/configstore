'use strict';

let Promise = require('bluebird');
let fs = require('fs');
Promise.promisifyAll(fs);
var git = require("nodegit");
let path = require('path');
let rimraf = Promise.promisify(require('rimraf'));
let CustomError = require('./error').CustomError;

class GitRepoError extends CustomError {}
class RepoDoesNotExistError extends GitRepoError {
  constructor(repoName) {
    super('Repo "' + repoName + '" does not exist');
    this.repoName = repoName;
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
    var path = this.repoPath(repoName);
    return fs.statAsync(path).then((res) => true).catch(() => false)
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
              return git.Repository.init(path, 1);
            });
        }
      })
      .then(() => {
        return this.getRepo(repoName)
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
  }
}

module.exports = {
  RepoManager,
  GitRepoError,
  RepoDoesNotExistError
};

