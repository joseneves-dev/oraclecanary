# OracleCanary 🐤

**The early warning for DeFi price feeds.**

Lending protocols decide loans and liquidations using oracle prices, but no public tool shows
which oracle each market reads, or whether it still works. When Switchboard shut down in
September 2026, protocols had 6 days to migrate and nobody could list who was still exposed.

OracleCanary maps the oracle dependencies of every Solana lending market and checks their health:

- **Stale**: last update older than the market's own max age
- **Deviating**: price differs from a Pyth reference
- **Deprecated**: feed owned by a shut-down provider (e.g. Switchboard)
- **No fallback**: single point of failure

Each market gets a 0–100 risk score, with public alerts.

> Built for the Colosseum Crypto World's Fair hackathon (Sep–Oct 2026).

## Status
🚧 Work in progress.

## License
MIT

## Project structure

```
indexer/   TypeScript — reads Solana (Kamino, marginfi, Pyth), runs health checks, writes to PostgreSQL
web/       Symfony 8 — public website, market pages, API
```

## Run locally

```bash
# 1. Database (PostgreSQL in Docker)
cd web && docker compose up -d

# 2. Website
composer install && symfony serve -d

# 3. Indexer
cd ../indexer && cp .env.example .env && npm install && npm run dev
```
