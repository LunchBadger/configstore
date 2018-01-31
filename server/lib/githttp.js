'use strict';

/*
Inspired by:
- https://github.com/git/git/blob/master/http-backend.c
- http://www.michaelfcollins3.me/blog/2012/05/18/implementing-a-git-http-server.html

Does not implement "dumb" server protocol, so will likely not work for old
clients.
*/

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const express = require('express');
const passport = require('passport');
const { BasicStrategy } = require('passport-http');
const IpStrategy = require('passport-ip').Strategy;
const Transform = require('stream').Transform;
const Git = require('nodegit');

const POST_UPDATE_HOOK = '#!/bin/bash\nexec cat\n';
const SERVICES = ['git-upload-pack', 'git-receive-pack'];

module.exports = function getRouter (repoPath, authOnPrivateNetworks) {
  const gitServer = new GitServer(repoPath);

  const router = express.Router();
  let strategies = ['basic'];

  if (!authOnPrivateNetworks) {
    strategies.unshift('ip');
    passport.use(new IpStrategy({
      range: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8']
    }, (_profile, done) => {
      done(null, 'git-user');
    }));
  }
  passport.use(new BasicStrategy({ passReqToCallback: true },
    gitServer.checkGitAccessKey.bind(gitServer)));

  router.use('/:repo', passport.authenticate(strategies, {
    session: false
  }));
  router.get('/:repo/info/refs', gitServer.getInfoRefs.bind(gitServer));
  router.post('/:repo/:service', gitServer.serviceRpc.bind(gitServer));

  return {
    router: router,
    server: gitServer
  };
};

module.exports.configureRepo = async function (repoPath, password) {
  const repo = await Git.Repository.open(repoPath);
  const repoConfig = await repo.config();

  await repoConfig.setString('lunchbadger.accesskey', password);
  await repoConfig.setString('receive.denycurrentbranch', 'updateInstead');

  const hookPath = path.join(repoPath, '.git', 'hooks', 'post-receive');
  if (!fs.existsSync(hookPath)) {
    fs.writeFileSync(hookPath, POST_UPDATE_HOOK, { mode: 0o775 });
  }
};

class GitServer extends EventEmitter {
  constructor (repoPath) {
    super();
    this.repoPath = repoPath;
    this.repoPromise = Git.Repository.open(repoPath);
  }

  getInfoRefs (req, res) {
    const service = req.query.service;

    if (!checkService(service, res)) {
      return;
    }

    sendHeaders(res, `application/x-${service}-advertisement`);
    res.write(makePacket(`# service=${service}\n`));

    const args = ['--stateless-rpc', '--advertise-refs'];
    runService({ allRepoPath: this.repoPath, service, args, req, res });
  }

  serviceRpc (req, res) {
    const service = req.params.service;

    if (!checkService(service, res)) {
      return;
    }

    if (req.headers['content-type'] !== `application/x-${service}-request`) {
      res.status(415);
      res.send(`Unsupported media type "${req.headers['content-type']}"`);
      return;
    }

    sendHeaders(res, `application/x-${service}-result`);

    const args = ['--stateless-rpc'];
    const runOpts = { allRepoPath: this.repoPath, service, args, req, res };

    if (service === 'git-receive-pack') {
      args.push('-q');

      runOpts.saveOutput = true;
      runOpts.callback = out => {
        if (out[0] === '\u0002') {
          out = out.slice(1);
        }
        let changes = out
          .trim()
          .split('\n')
          .map(line => {
            line = line.trim();
            if (!line.length) {
              return null;
            }
            const [before, after, ref] = line.split(' ');
            const match = ref.match(/refs\/(head|tag)s\/(.*)/);
            if (!match) {
              return null;
            }

            return {
              type: match[1],
              ref: match[2],
              before,
              after
            };
          })
          .filter(item => item !== null);

        this.emit('push', req.params.repo, changes);
      };
    }

    runService(runOpts);
  }

  checkGitAccessKey (req, username, password, done) {
    if (username !== 'git') {
      return done(null, false);
    }

    const repoPath = path.join(this.repoPath, req.params.repo);

    Git.Repository.open(repoPath)
      .then((repo) => repo.config())
      .then((repoConfig) => repoConfig.getStringBuf('lunchbadger.accesskey'))
      .then((accessKey) => {
        if (accessKey !== password) {
          return done(null, false);
        }
        return done(null, true);
      })
      .catch(done);
  }
}

function checkService (service, res) {
  if (!service) {
    res.status(400);
    res.send('Dumb protocol not supported');
    return false;
  }

  if (!SERVICES.includes(service)) {
    res.status(400);
    res.send(`Unknown service "${service}"`);
    return false;
  }

  return true;
}

function sendHeaders (res, contentType) {
  res.setHeader('Expires', 'Fri, 01 Jan 1980 00:00:00 GMT');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  res.setHeader('Content-Type', contentType);
}

function makePacket (message) {
  const unpadded = (message.length + 4).toString(16);
  const pad = '0000';
  const prefix = pad.substring(0, pad.length - unpadded.length) + unpadded;

  return `${prefix}${message}0000`;
}

function runService (opts) {
  let {
    allRepoPath,
    service,
    args,
    req,
    res,
    callback,
    saveOutput = false
  } = opts;

  const repoPath = path.join(allRepoPath, opts.req.params.repo);
  const git = spawn('/usr/bin/' + service, args.concat([repoPath]));

  let tee;
  if (saveOutput) {
    tee = new GitServiceTee();

    req.pipe(git.stdin);
    git.stdout.pipe(tee);
    tee.pipe(res);
  } else {
    req.pipe(git.stdin);
    git.stdout.pipe(res);
  }

  git.stderr.on('data', data => {
    console.log(`error from git: ${data.toString('utf-8').trim()}`);
  });

  git.on('exit', () => {
    let result = null;

    if (saveOutput) {
      tee.end();
      result = tee.output;
    }

    if (callback) {
      callback(result);
    }
  });
}

class PacketParser extends EventEmitter {
  constructor () {
    super();
    this.buffer = '';
    this.ok = true;
  }

  feed (chunk) {
    if (!this.ok) {
      return;
    }

    this.buffer += chunk.toString('ascii');

    let pos = 0;

    while (this.buffer.length > pos) {
      const strLen = this.buffer.substr(pos, 4);

      if (strLen === '0000') {
        this.emit('end');
        pos += 5; // account for new line
        continue;
      }

      if (!strLen.match(/^[0-9a-fA-F]{4}$/)) {
        this.emit('error', new Error('bad length format'));
        this.ok = false;
        break;
      }

      const len = parseInt(strLen, 16);
      if (len <= 4) {
        this.emit('error', new Error('length too short'));
        this.ok = false;
        break;
      }

      if (len > pos + this.buffer.length) {
        break;
      }

      this.emit('packet', this.buffer.substr(pos + 4, len - 4));
      pos += len;
    }

    this.buffer = this.buffer.substr(pos);
  }
}

class GitServiceTee extends Transform {
  constructor (options) {
    super(options);

    this.parser = new PacketParser();
    this.parser.on('error', err => {
      console.log('error', err.message);
    });

    let firstPacket = true;
    this.output = '';

    this.parser.on('packet', data => {
      if (firstPacket) {
        firstPacket = false;
      } else {
        this.output += data;
      }
    });
  }

  _transform (chunk, _encoding, callback) {
    this.parser.feed(chunk.toString('ascii'));
    callback(null, chunk);
  }
}
