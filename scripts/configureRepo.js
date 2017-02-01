'use strict';

const crypto = require('crypto');
const configureRepoForHttp = require('../server/lib/githttp').configureRepo;

configureRepoForHttp(process.argv[2], crypto.randomBytes(16).toString('hex'));
