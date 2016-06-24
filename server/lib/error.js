'use strict';

let util = require('util');

function CustomError(message) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
}
util.inherits(CustomError, Error);

// HTTP errors
function badRequestError(msg) {
  let err = Error(msg);
  err.statusCode = 400;
  return err
}

function notFoundError(msg) {
  let err = Error(msg);
  err.statusCode = 404;
  return err;
}

module.exports = {
  CustomError,
  badRequestError,
  notFoundError
};

