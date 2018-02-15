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

    //TODO: create git user and repos  
    res.json({ id: req.body.id , user, repos:[devRepo.repo, fnRepo.repo]})
});

app.get('/producers/:username', async (req, res) => {
    let user = await findUser(req.params.username)
    if (!user){
        return res.status(404).end()
    }
    let repos = await getRepos({name:req.params.username, prefix})

    //TODO: return
    //{"id":"circleci","envs":{"dev":"b186115877109568ab0f46388f01a0816c44e768"}}
    res.json({ id: req.params.username, envs: {}, user: user.user , repos: repos.repos})
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
        .then(r => r.body)
        .catch(err => {
            return null
        })
}


app.all('/producers/:username/accesskey', (req, res) => {
    res.json({ key: null })
})

app.listen(6666, () => console.log('Configstore API is running port 6666'));