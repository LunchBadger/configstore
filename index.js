const express = require('express');
const request = require('superagent');
const debug = require('debug')('configstore:');
const SseChannel = require('sse-channel');
const cors = require('cors');
const channels = {};
const app = express();
// those emails are set in Dockerfile as RUN git config --global user.email "sls-bot@lunchbadger.com"
const lbCommitterNames = ['sls-bot@lunchbadger.com', 'support@lunchbadger.com'];

process.on('unhandledRejection', (reason, p) => {
  debug('Unhandled Rejection at: Promise', p, 'reason:', reason);
  // application specific logging, throwing an error, or other logic here
});

let baseUrl = require('superagent-prefix')(process.env.GIT_API_URL || 'http://localhost:8080');
app.use(express.json());
app.use('/producers', cors({
  origin: true,
  methods: ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Cache-Control', 'Content-Type', 'Accept', 'Authorization', 'Accept-Encoding', 'Access-Control-Request-Headers', 'User-Agent', 'Access-Control-Request-Method', 'Pragma', 'Connection', 'Host'],
  credentials: true
}));
app.use('/api/producers', cors({ // BKW compatibility
  origin: true,
  methods: ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Cache-Control', 'Content-Type', 'Accept', 'Authorization', 'Accept-Encoding', 'Access-Control-Request-Headers', 'User-Agent', 'Access-Control-Request-Method', 'Pragma', 'Connection', 'Host'],
  credentials: true
}));
const prefix = process.env.REPO_PREFIX || 'customer';

const ensureChannel = (user) => {
  // TODO double cors
  channels[user] = channels[user] || new SseChannel({});
  return channels[user];
};

app.post('/hook', (req, res) => {
  res.json({ ok: true }); // no need to hold hook connection

  let { ref, before, after } = req.body;
  let [namespace, username] = req.body.repository.owner.username.split('-');
  let payload = { ref, before, after, namespace, username, type: 'push' };
  payload.repoName = req.body.repository.name;
  debug('Commits:', req.body.commits);
  payload.isExternal = !(req.body.commits.every(x => lbCommitterNames.includes(x.committer.email)));

  let ch = ensureChannel(username);
  debug('sending data to ', username, payload);
  ch.send({ data: JSON.stringify(payload), event: 'data' });
});

app.get('/change-stream/:user', (req, res) => {
  debug(req.params.user, 'subscribed');
  ensureChannel(req.params.user).addClient(req, res);
});
app.post('/producers', createProducer);
app.post('/api/producers', createProducer); // BKW compatibility only

app.get('/producers/:username', getProducer);
app.get('/api/producers/:username', getProducer); // BKW compatibility only

app.get('/producers/', getProducers);
app.get('/api/producers/', getProducers); // BKW compatibility only

async function createProducer (req, res) {
  // 1) Ensure user exists
  // 2) ensure repo `dev` exists
  // 3) ensure repo `functions` exists
  // 4) ensure Web hook exists TODO

  // Step 1
  const username = req.body.id;
  let user = await findUser(username);
  if (!user) {
    debug(`user not found, creating ${prefix}-${username}`);
    user = await request
      .post('/users')
      .use(baseUrl)
      .send({ name: username, prefix })
      .then(r => r.body)
      .catch(err => {
        debug(err);
        return null;
      });
  }
  if (!user) {
    return res.status(500).json({ 'message': 'user creation failed' });
  }

  let repos = await getRepos({ prefix, name: username });
  // Step 2
  if (repos.every(x => x.name !== 'dev')) {
    await ensureRepo({ repoName: 'dev', prefix, name: username });
  }

  // Step 3
  if (repos.every(x => x.name !== 'functions')) {
    await ensureRepo({ repoName: 'functions', prefix, name: username });
  }
  repos = await getRepos({ prefix, name: username });

  // step 4
  registerWebHook({ prefix, producerName: username, repoName: 'dev' });
  registerWebHook({ prefix, producerName: username, repoName: 'functions' });
  res.json({ id: username, user, repos });
}

async function getProducer (req, res) {
  let user = await findUser(req.params.username);
  if (!user) {
    return res.status(404).end();
  }
  let repos = await getRepos({ name: req.params.username, prefix });

  res.json({ id: req.params.username, envs: {}, user: user.user, repos });
}

async function getProducers (req, res) {
  let users = await findUsers(prefix);
  if (!users) {
    return res.json({ users: [] });
  }
  users = users.filter(u => u.login.indexOf(prefix + '-') >= 0).map(async u => {
    u.name = u.login.replace(prefix + '-', '');
    u.namespace = prefix;
    u.repos = await getRepos({ name: u.name, prefix });
    return u;
  });
  users = await Promise.all(users);

  res.json(users);
}
async function findUser (name) {
  return request
    .get('/users/' + prefix + '/' + name)
    .use(baseUrl)
    .then(r => r.body)
    .catch(err => {
      debug(err);
      return null;
    });
}

async function findUsers (prefix) {
  return request
    .get(`/search/users?q=${prefix}&limit=1000`)
    .use(baseUrl)
    .then(r => r.body.users)
    .catch(err => {
      debug(err);
      return null;
    });
}

async function registerWebHook ({ prefix, producerName, repoName }) {
  return request
    .put(`/users/${prefix}/${producerName}/repos/${repoName}/hook`)
    .use(baseUrl)
    .send({ callbackUrl: 'http://configstore.default/hook' });
}

async function ensureRepo ({ name, prefix, repoName }) {
  return request
    .put(`/users/${prefix}/${name}/repos/${repoName}`)
    .use(baseUrl)
    .then(r => r.body)
    .catch(err => {
      debug(err);
      return null;
    });
}

async function getRepos ({ name, prefix }) {
  return request
    .get(`/users/${prefix}/${name}/repos`)
    .use(baseUrl)
    .then(r => r.body.repos)
    .catch(err => {
      debug(err);
      return null;
    });
}

app.all('/api/producers/:username/accesskey', (req, res) => {
  res.json({ key: null, message: 'NOT REQUIRED, JUST FOR BACKWARD COMPATIBILITY' });
});

app.listen(3002, () => console.log('Configstore API is running port 3002'));
