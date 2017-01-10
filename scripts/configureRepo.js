'use strict';

const path = require('path');
const crypto = require('crypto');
const configureRepoForHttp = require('../server/lib/githttp').configureRepo;

configureRepoForHttp(path.join(__dirname, '../example/repos/demo.git'),
                     crypto.randomBytes(16).toString('hex'));
