'use strict';

const morgan = require('morgan');
module.exports = function(_options) {
  return morgan('dev');
};
