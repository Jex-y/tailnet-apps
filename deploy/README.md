# Deploy

Fork the repo. Every push to `main` runs lint, typecheck, the migration check and the tests, then builds
`ghcr.io/<owner>/<repo>:<sha>`. Once a deploy host is configured, CI joins the tailnet as an ephemeral `tag:ci` node
and SSHes to the host with a key that can only run `deploy/deploy.sh`, passing just the commit SHA. The script pulls
that image, unpacks the stack (`deploy/stack/`, baked into the image) into `$APP_DIR/releases/<sha>/`, migrates,
starts the server and worker and waits for their health checks, rolling back to the previous release if they fail.

The stack joins the tailnet as its own device, `apps`, through a Tailscale sidecar. Server, worker, Postgres and
Garage share the sidecar's network and publish nothing on the host itself:

- `https://apps.<tailnet>.ts.net/` is the server
- `https://apps.<tailnet>.ts.net:3900` is S3 (Garage, region `garage`, path-style, bucket `apps`)
- `psql -h apps.<tailnet>.ts.net -U <user> apps` is Postgres
- `https://apps-mcp.<tailnet>.ts.net/mcp` is the MCP connector, on its own device, `apps-mcp`, the only one funnelled
  to the internet

Postgres and Garage keep their data in `$APP_DIR/data`, so back up that directory. On a Synology NAS, put `APP_DIR`
inside a shared folder and Hyper Backup covers it.

## One-time setup

**Tailscale**, in the policy file, where `<host>` is the deploy host's machine name:

```jsonc
"tagOwners": {
    "tag:ci":   ["autogroup:admin"], // ephemeral GitHub Actions runners
    "tag:apps": ["autogroup:admin"], // the stack's sidecar
},
"acls": [
    {"action": "accept", "src": ["autogroup:member"], "dst": ["*:*"]},
    {"action": "accept", "src": ["tag:ci"], "dst": ["<host>:22"]},
],
// Lets `apps-mcp`, the MCP connector for claude.ai, be funnelled to the internet.
"nodeAttrs": [
    {"target": ["tag:apps"], "attr": ["funnel"]},
],
```

- An OAuth client with the Auth Keys write scope for `tag:ci`, for CI.
- Two one-off auth keys, for the `apps` and `apps-mcp` sidecars: not reusable, not ephemeral, pre-approved, tagged
  `tag:apps`. Each is only used on first start; the sidecars keep their identities in their state volumes after that.

**Deploy host**, any Linux machine on the tailnet with Docker Compose:

- Pick an `APP_DIR`, say `/srv/apps`, and copy [`deploy/.env.example`](.env.example) to `$APP_DIR/.env`.
  Fill it in: your tailnet's DNS name, the sidecar's auth key, and secrets for Postgres, Garage and Web Push.
  Generate the Web Push pair once; changing it invalidates every subscription.
- If the image is private, log in to GHCR with a classic PAT that has only `read:packages`:
  `docker login ghcr.io -u <github-user>`
- Install the deploy script:

  ```sh
  ssh <host> 'mkdir -p ~/bin && cat > ~/bin/apps-deploy && chmod 755 ~/bin/apps-deploy' < deploy/deploy.sh
  ```

  Generate a key pair for CI and authorise it, in the host's `~/.ssh/authorized_keys`, to run that script and
  nothing else. The forced command also sets which image the host deploys and where:

  ```
  command="IMAGE=ghcr.io/<owner>/<repo> APP_DIR=/srv/apps /home/<user>/bin/apps-deploy",restrict ssh-ed25519 AAAA… apps-ci
  ```

**GitHub**, in the repo's settings:

- Repository variables: `DEPLOY_HOST` (the host's tailnet name, e.g. `<host>.<tailnet>.ts.net`), `DEPLOY_USER`,
  and `DEPLOY_KNOWN_HOST`, the host's line for `known_hosts` (`ssh-keyscan -t ed25519 <host>.<tailnet>.ts.net`).
  CI skips the deploy until `DEPLOY_HOST` is set.
- Secrets in a `production` environment: `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` from the OAuth client, and
  `DEPLOY_SSH_KEY`, the private half of the CI key.
