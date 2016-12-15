'use strict';

/*
Inspired by:
- https://github.com/git/git/blob/master/http-backend.c
- http://www.michaelfcollins3.me/blog/2012/05/18/implementing-a-git-http-server.html

Does not implement "dumb" server protocol, so will likely not work for old
clients.
*/

const path = require('path');
const {spawn, exec} = require('child_process');
const express = require('express');
const passport = require('passport');
const {BasicStrategy} = require('passport-http');

const SERVICES = ['git-upload-pack', 'git-receive-pack'];

module.exports = function getRouter(repoPath) {
  const gitServer = new GitServer(repoPath);

  const router = express.Router();

  passport.use(new BasicStrategy({passReqToCallback: true},
                                 gitServer.checkGitAccessKey.bind(gitServer)));

  router.use('/:repo', passport.authenticate('basic', {session: false}));
  router.get('/:repo/info/refs', gitServer.getInfoRefs.bind(gitServer));
  router.post('/:repo/:service', gitServer.serviceRpc.bind(gitServer));

  return router;
};

class GitServer {
  constructor(repoPath) {
    this.repoPath = repoPath;
  }

  getInfoRefs(req, res) {
    const service = req.query.service;

    if (!checkService(service, res)) {
      return;
    }

    sendHeaders(res, `application/x-${service}-advertisement`);
    res.write(makePacket(`# service=${service}\n`));

    const args = ['--stateless-rpc', '--advertise-refs'];
    runService(this.repoPath, service, args, req, res);
  }

  serviceRpc(req, res) {
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
    runService(this.repoPath, service, ['--stateless-rpc'], req, res);
  }

  checkGitAccessKey(req, username, password, done) {
    if (username !== 'git') {
      return done(null, false);
    }

    const repoPath = path.join(this.repoPath, req.params.repo);
    exec('git config --get lunchbadger.accesskey', {cwd: repoPath},
      (error, stdout) => {
        if (error) {
          console.log(error);
          return done(new Error('failed to validate credentials'));
        }

        if (stdout.trim() !== password) {
          return done(null, false);
        }

        return done(null, true);
      });
  }
}

function checkService(service, res) {
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

function sendHeaders(res, contentType) {
  res.setHeader('Expires', 'Fri, 01 Jan 1980 00:00:00 GMT');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  res.setHeader('Content-Type', contentType);
}

function makePacket(message) {
  const unpadded = (message.length + 4).toString(16);
  const pad = '0000';
  const prefix = pad.substring(0, pad.length - unpadded.length) + unpadded;

  return `${prefix}${message}0000`;
}

function runService(allRepoPath, service, args, req, res) {
  const repoPath = path.join(allRepoPath, req.params.repo);
  const git = spawn('/usr/bin/' + service, args.concat([repoPath]));

  req.pipe(git.stdin);
  git.stdout.pipe(res);

  git.stderr.on('data', data => {
    console.log(`error from git: ${data.toString('utf-8').trim()}`);
  });

  git.on('exit', () => {
    res.end();
  });
}
