const express = require('express');
const app = express();
app.use(express.json());

app.post('/producers', async (req, res) => {
    console.log(req.body.id)
    //TODO: create git user and repos  
    res.json({ id: req.body.id })
});

app.get('/producers/:username', async (req, res) => {
    
    //TODO: return
    //{"id":"circleci","envs":{"dev":"b186115877109568ab0f46388f01a0816c44e768"}}
    res.json({ id: req.params.username, envs:{} })
});

app.all('/producers/:username/accesskey', (req, res) => {
    res.json({ key: null })
})

app.listen(6666, () => console.log('Configstore API is running'));