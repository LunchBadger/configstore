# configstore

create producer/user
```
kubeclt port-forward configstore-7b4bbbf497-jrbj6 3002 # set to the configstore pod
curl -X POST localhost:3002/api/producers -d '{"id":"serhiikuts"}' -H "Content-Type: application/json" # substitute out the WP username
```
