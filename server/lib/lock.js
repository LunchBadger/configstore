'use strict';

let Promise = require('bluebird');
let fs = require('fs-ext');
Promise.promisifyAll(fs);
let CustomError = require('./error').CustomError;

class LockedError extends CustomError {
  constructor(fileName) {
    super('File "' + fileName + '" is locked.');
  }
}

/**
 * Locks the given file, calls the given function, and unlocks the file.
 * This effectively makes the function a cross-process critical section.
 * @param {String} lockPath - filesystem path to a lock file, which will be
 *   created if it doesn't already exist.
 * @param {Function} fn - the function to be executed. Should return a Promise.
 * @returns {Promise}
 */
module.exports = function lock(lockPath, fn) {
  let lockFd = null;

  function unlock() {
    if (lockFd) {
      let fd = lockFd;
      lockFd = null;
      return fs.closeAsync(fd);
    }
  }

  return fs.openAsync(lockPath, 'w')
    .then(fd => {
      lockFd = fd;
      return fs.flockAsync(lockFd, 'exnb');
    })
    .catch(err => {
      if (err.code && err.code === 'EAGAIN') {
        throw new LockedError(lockPath);
      } else {
        throw err;
      }
    })
    .then(fn)
    .then(unlock)
    .catch((err) => unlock().then(() => { throw err; }));
};

module.exports.LockedError = LockedError;
