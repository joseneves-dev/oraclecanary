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
   `https://<domain>/api/health` answers, so Caddy can obtain its certificate.
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
| Logs | `docker compose -f deploy/compose.yaml --env-file deploy/.env logs -f indexer` (or `alerts`, `bot`, `positions`, `api`) |
| Health | `curl https://<domain>/api/health`: 200 when every protocol is fresh, 503 otherwise |
| Restore a backup | `gunzip -c deploy/backups/<file>.sql.gz \| docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T database psql -U oraclecanary oraclecanary` |

Backups are written daily to `deploy/backups/` and kept for `BACKUP_KEEP_DAYS` days. Copy them off
the server as well (object storage or another machine): a backup on the same disk does not survive
losing the server.

Point an uptime monitor (UptimeRobot, Better Stack...) at `https://<domain>/api/health` to be alerted
when the API is down or the data stops refreshing.

## Personal wallet alerts

The `bot` service answers the Telegram bot's private messages: `/watch <wallet>` (up to 5 per chat),
`/unwatch`, `/list` and `/check`. Every `WATCH_INTERVAL_SECONDS` (5 min) it reads each watched
wallet and sends a direct message when one of its Kamino or marginfi loan accounts is held up by a
price the protocol cannot use, and when it recovers (a tokenized stock paused by its closed market is
not alerted). The web app's "Get Telegram alerts" button opens the bot with the wallet filled in.
It uses the same `TELEGRAM_BOT_TOKEN` as `alerts` and `POSITIONS_RPC_URL` (or `RPC_URL`); the
number of watched wallets and their deposits is public at `/api/stats`. Only this service reads the
bot's messages: running a second copy with the same token (say, locally) makes Telegram refuse one of
them, and commands go unanswered.

## Wallet positions

The `positions` service answers `GET /api/wallets/{address}/positions` for the "My positions" page:
a wallet's Kamino and marginfi deposits and loans and its Kamino vault shares, read from the chain.
The `api` service proxies that path to it (`POSITIONS_UPSTREAM`, default `positions:3001`); if it is
down, only that page fails. It stores nothing.

Each new wallet costs a few RPC calls, including two `getProgramAccounts`, on a public endpoint. It
caches each wallet for a minute, runs at most 4 lookups at once, allows 10 new wallets a minute per
visitor and 120 in total, and gives up on a lookup after 15 s. Set `POSITIONS_RPC_URL` to a separate
key so these lookups can never use up the indexer's quota.

## Telegram alerts

The `alerts` service posts to a Telegram channel when a reserve with at least `ALERT_MIN_SUPPLY_USD`
supplied gets a critical check, gets a new one, or recovers. A tokenized stock that goes stale
because its market closed is not alerted, but one still frozen after the market opens is. Once a
day, at `SUMMARY_HOUR_UTC` (14:00 UTC by default, just after the US market opens; `off` disables
it), it also posts a short summary: reserves watched, total supplied and any critical ones, so a
quiet channel still shows the monitor is running.

1. Create a bot with @BotFather and a public channel; add the bot to the channel as an
   administrator allowed to post.
2. Set `TELEGRAM_BOT_TOKEN` (and `TELEGRAM_CHAT_ID` if the channel is not `@OracleCanaryAlerts`) in
   `deploy/.env`, then run `./deploy/deploy.sh`.

Without a token the service stays idle (and shows as unhealthy, having no heartbeat). On its first
start it alerts only on events recorded from then on; after that it remembers the last event handled
and which alerts are still open (volume `alerts_data`), so restarts neither repeat nor skip alerts,
and every alert gets its "Recovered". A message Telegram refuses (e.g. the bot was removed from the
channel) is logged and skipped, and the container turns **unhealthy** until messages go through
again: check `ps` after a deploy. Logs: `docker compose -f deploy/compose.yaml --env-file deploy/.env logs -f alerts`.

## Attestation signing key

The API signs `/api/reserves/{address}/attestation` with `ATTESTATION_SECRET_KEY`, and the on-chain
`oracle_guard` only accepts the matching public key. Create the key **once**, on the server:

```bash
grep -q '^ATTESTATION_SECRET_KEY=.' deploy/.env || printf '\nATTESTATION_SECRET_KEY=%s\n' "$(openssl rand -base64 32)" >> deploy/.env
./deploy/deploy.sh
```

The public key is the `publicKey` field of any attestation. Give it to the guard with
`onchain/ts/devnet.ts init` the first time. Replacing the secret changes the public key, and the guard
then rejects every attestation (`WrongSigner`) until `onchain/ts/devnet.ts rotate <new public key>`
is run with the admin wallet. Back up the secret like the database password.
