# Configstore

The Configstore is a facade API built on Express for all the main metadata and configuration information for all LunchBadger Users and their projects.

The main underlying component that the Configstore utilizes is [Gitea][gitea], an open source git server that provides core underlying features of GitHub including code repositories, collaborators, etc.

Gitea provides the git source control experience as well as the "gitops" flow for managing and versioning Projects created by Users.

The Configstore consolidates information across all LunchBadger Users (Producers) by querying and aggregating information and changes within the Gitea users and their repositories.

# Configstore API
GET    /change-stream/:producer
GET    /producers
GET    /producers/:username
POST   /producers

# Creating Producers Manually
The LunchBadger UI can be configured to make an API call via the login page to create Producers automatically.
The intention of the create Producer API is to a key inrtegration point for a SSO or Identity service or system of record.

Producers can be created manually by invoking this API through the following procedure.
```
# identify the Configstore pod within Kubernetes
kubectl get pods --namespace default
# forward port 3002
kubeclt port-forward configstore-7b4bbbf497-jrbj6 3002 # set to the configstore pod
# POST to the Configstore Producer API with the desired Producer ID, e.g. `serhiikuts`
curl -X POST localhost:3002/api/producers -d '{"id":"serhiikuts"}' -H "Content-Type: application/json"
```

[gitea]: https://gitea.io/
