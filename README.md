# OracleCanary 🐤

**The early warning for DeFi price feeds.**

Lending protocols decide loans and liquidations using oracle prices, but no public tool shows
which oracle each market reads, or whether it still works. When Switchboard shut down in
September 2026, protocols had 6 days to migrate and nobody could list who was still exposed.

OracleCanary maps the oracle dependencies of Solana lending markets (Kamino and marginfi) down to the
upstream providers, following Kamino's Scope price chains, fallbacks, caps and TWAPs and marginfi's
per-bank oracle setups, and checks:

| Check | Severity | Meaning |
|---|---|---|
| `STALE` | critical | Price older than the reserve's own limit: the protocol rejects it |
| `NEAR_STALE` | warning | Price older than 80% of that limit |
| `DEPRECATED_PROVIDER` | critical / warning | Price depends on a shut-down provider (Switchboard); critical when nothing else can replace it |
| `NO_FALLBACK` | warning | An oracle whose failure alone stops the price |
| `NO_ORACLE` | critical | No oracle configured, or an empty price chain |
| `EMPTY_PRICE_ENTRY` | critical | The price chain points at an unconfigured Scope entry |
| `SOURCES_DIVERGE` | critical / warning | Fallback sources disagree beyond their own tolerance |
| `FIXED_PRICE` | info | The price is fixed and does not follow the market |

Each reserve gets a 0–100 score (critical −50, warning −15, info −5).

> Built for the Colosseum Crypto World's Fair hackathon (Sep–Oct 2026).

## API

Read-only REST API with OpenAPI docs at `/api/docs`.

```
GET /api/reserves?listed=true&score[lt]=100&order[totalSupplyUsd]=desc
GET /api/reserves/{address}
```

`listed=true` keeps markets listed in the protocol's own app (Kamino's listed markets, marginfi's main
group): anyone can create a market with arbitrary tokens and prices. `protocol=kamino` or
`protocol=marginfi` narrows to one protocol.

## Project structure

```
indexer/   TypeScript: reads Solana (Kamino reserves and Scope prices, marginfi banks and Pyth prices),
           runs the checks, writes to PostgreSQL
web/       Symfony 8 + API Platform 5: the public API; owns the database schema (Doctrine migrations)
```

## Run locally

```bash
# 1. Database (PostgreSQL in Docker, host port 5433)
cd web && docker compose up -d
composer install && php bin/console doctrine:migrations:migrate

# 2. API on http://127.0.0.1:8000
symfony serve -d

# 3. Indexer: `npm run check` runs once, `npm run dev` checks every CHECK_INTERVAL_SECONDS
cd ../indexer && cp .env.example .env && npm install && npm run check
```

Tests: `cd web && php bin/phpunit` and `cd indexer && npm test`.

## Production

- Set `APP_ENV=prod` and a random `APP_SECRET` in the environment (or `.env.local`). The committed
  `.env` defaults to `dev`, which enables the debug profiler.
- Set `DATABASE_URL` for both `web` and `indexer`, and `RPC_URL` for the indexer. The public Solana
  RPC rate-limits `getProgramAccounts`; use a dedicated RPC provider.
- Run `php bin/console doctrine:migrations:migrate` on deploy, and keep `npm run dev` (the indexer
  loop) running as a service.
- API responses are cacheable for 30s (`s-maxage=60`), so a CDN can serve most traffic.

## License

MIT
