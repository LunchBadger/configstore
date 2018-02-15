const express = require('express');
const request = require('superagent');
const debug = require('debug')("configstore:")
const app = express();
baseUrl = require('superagent-prefix')(process.env.GIT_API_URL || 'http://localhost:8080');
app.use(express.json());
const prefix = process.env.REPO_PREFIX || 'customer'
app.post('/producers', async (req, res) => {
    // 1) Ensure user exists
    // 2) ensure repo `dev` exists
    // 3) ensure repo `functions` exists

    // Step 1 
    let user = await findUser(req.body.id)
    if (!user) {
        debug(`user not found, creating ${prefix}-${req.body.id}` )
        user = await request
            .post('/users')
            .use(baseUrl)
            .send({ name: req.body.id, prefix })
            .then(r => r.body)
            .catch(err => {
                debug(err)
                return null
            })
    }
    if(!user){
        return res.status(500).json({"message": "user creation failed"})
    }

    // Step 2
    let devRepo = await ensureRepo({repoName: "dev", prefix, name: req.body.id})

    // Step 3
    let fnRepo = await ensureRepo({repoName: "functions", prefix, name: req.body.id})

    res.json({ id: req.body.id , user, repos:[devRepo.repo, fnRepo.repo]})
});

app.get('/producers/:username', async (req, res) => {
    let user = await findUser(req.params.username)
    if (!user){
        return res.status(404).end()
    }
    let repos = await getRepos({name:req.params.username, prefix})

    res.json({ id: req.params.username, envs: {}, user: user.user , repos})
});

app.get('/producers/', async (req, res) => {
    let users = await findUsers(prefix)
    if (!users){
        return res.json({users:[]})
    }
    users = users.filter(u=>u.login.indexOf(prefix+'-')>=0).map(async u=> {
        u.name = u.login.replace(prefix+'-', "")
        u.namespace = prefix
        u.repos = await getRepos({name:u.name, prefix});
        return u
    })
    users = await Promise.all(users)

    res.json(users)
});

async function findUser(name) {
    return request
        .get('/users/' + prefix + '/' + name)
        .use(baseUrl)
        .then(r => r.body)
        .catch(err => {
            return null
        })
}

async function findUsers(prefix) {
    return request
        .get(`/search/users?q=${prefix}&limit=1000`)
        .use(baseUrl)
        .then(r => r.body.users)
        .catch(err => {
            return null
        })
}

async function ensureRepo({name, prefix, repoName}) {
    return request
        .put(`/users/${prefix}/${name}/repos/${repoName}`)
        .use(baseUrl)
        .then(r => r.body)
        .catch(err => {
            return null
        })
}

async function getRepos({name, prefix}) {
    return request
        .get(`/users/${prefix}/${name}/repos`)
        .use(baseUrl)
        .then(r => r.body.repos)
        .catch(err => {
            return null
        })
}


app.all('/producers/:username/accesskey', (req, res) => {
    res.json({ key: null, message: 'NOT REQUIRED, JUST FOR BACKWARD COMPATIBILITY' })
})

app.listen(3002, () => console.log('Configstore API is running port 3002'));