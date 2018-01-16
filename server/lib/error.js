'use strict';

let util = require('util');

function CustomError (message) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
}
util.inherits(CustomError, Error);

// HTTP errors
function httpError (code, msg) {
  let err = Error(msg);
  err.statusCode = code;
  return err;
}

let badRequestError = httpError.bind(undefined, 400);
let notFoundError = httpError.bind(undefined, 404);
let preconditionFailedError = httpError.bind(undefined, 412);

module.exports = {
  CustomError,
  badRequestError,
  notFoundError,
  preconditionFailedError
};
