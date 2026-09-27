# Deploying OracleCanary

One server runs the whole stack with Docker Compose: PostgreSQL, the API and web app
(FrankenPHP/Caddy, automatic HTTPS), the Solana indexer and a daily database backup.

## Requirements

- A Linux VPS with 2 vCPU / 4 GB RAM (2 GB works) and Docker Engine with the Compose plugin.
- A Solana RPC that allows `getProgramAccounts` (the public RPC rate-limits it). Helius' free plan
  covers a check every 5 minutes; a check every minute needs a paid plan.
- The domain's DNS pointing at the server.

## First install

```bash
# On the server
git clone https://github.com/joseneves-dev/oraclecanary.git && cd oraclecanary
cp deploy/.env.example deploy/.env
# Fill in deploy/.env: SERVER_NAME, APP_SECRET and POSTGRES_PASSWORD (openssl rand -hex 32), RPC_URL.
chmod 600 deploy/.env
```

Copy the built web app into `deploy/ui/` (it must contain `index.html` and `assets/`), then:

```bash
./deploy/deploy.sh
```

On first start the API waits for the database, applies the migrations and gets a TLS certificate
for `SERVER_NAME`; the indexer fills the data within one check interval.

## DNS and TLS with Cloudflare

1. Add an `A` record for the domain with the server's IP. Keep it **DNS only (grey cloud)** until
   `https://<domain>/health` answers, so Caddy can obtain its certificate.
2. Switch the record to **Proxied (orange cloud)** and set SSL/TLS mode to **Full (strict)**.

## Updating

```bash
./deploy/deploy.sh            # pulls main, rebuilds what changed, restarts
```

To update the web app, replace the contents of `deploy/ui/`; no restart is needed.

## Operations

| Task | Command |
|---|---|
| Status | `docker compose -f deploy/compose.yaml --env-file deploy/.env ps` |
| Logs | `docker compose -f deploy/compose.yaml --env-file deploy/.env logs -f indexer` |
| Health | `curl https://<domain>/health`: 200 when every protocol is fresh, 503 otherwise |
| Restore a backup | `gunzip -c deploy/backups/<file>.sql.gz \| docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T database psql -U oraclecanary oraclecanary` |

Backups are written daily to `deploy/backups/` and kept for `BACKUP_KEEP_DAYS` days. Copy them off
the server as well (object storage or another machine): a backup on the same disk does not survive
losing the server.

Point an uptime monitor (UptimeRobot, Better Stack...) at `https://<domain>/health` to be alerted
when the API is down or the data stops refreshing.
