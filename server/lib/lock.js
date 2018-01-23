'use strict';

let Promise = require('bluebird');
let fs = require('fs-ext');
Promise.promisifyAll(fs);
let CustomError = require('./error').CustomError;

class LockedError extends CustomError {
  constructor (fileName) {
    super('File "' + fileName + '" is locked.');
  }
}

/**
 * Locks the given file, calls the function, and unlocks the file.
 * This effectively makes the function a cross-process critical section.
 * @param {String} lockPath - filesystem path to a lock file, which will be
 *   created if it doesn't already exist.
 * @param {Function} fn - the function to be executed. Should return a Promise.
 * @returns {Promise} The return value (or error) will be passed through from
 *   the function.
 */
module.exports = async function lock (lockPath, fn) {
  let fd = null;

  try {
    fd = await fs.openAsync(lockPath, 'w');
    await fs.flockAsync(fd, 'exnb');
  } catch (err) {
    if (err.code && err.code === 'EAGAIN') {
      throw new LockedError(lockPath);
    } else {
      throw err;
    }
  }

  try {
    return await fn();
  } finally {
    await fs.closeAsync(fd);
  }
};

module.exports.LockedError = LockedError;
