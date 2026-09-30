# OracleCanary 🐤

**The early warning for DeFi price feeds.**

Lending protocols decide loans and liquidations using oracle prices, but no public tool shows
which oracle each market reads, or whether it still works. When Switchboard shut down in
September 2026, protocols had 6 days to migrate and nobody could list who was still exposed.

OracleCanary maps the oracle dependencies of Solana lending markets (Kamino, Jupiter Lend and marginfi)
down to the upstream providers: Kamino's Scope price chains with their fallbacks, caps and TWAPs,
Jupiter Lend's chained Chainlink, Pyth and exchange-rate sources, and marginfi's per-bank oracle
setups. It then checks:

| Check | Severity | Meaning |
|---|---|---|
| `STALE` | critical | Price older than the reserve's own limit: the protocol rejects it |
| `NEAR_STALE` | warning | Price older than 80% of that limit |
| `DEPRECATED_PROVIDER` | critical / warning | Price depends on a shut-down provider (Switchboard); critical when nothing else can replace it |
| `NO_FALLBACK` | warning | An oracle whose failure alone stops the price |
| `NO_ORACLE` | critical | No oracle configured, or an empty price chain |
| `EMPTY_PRICE_ENTRY` | critical | The price chain points at an unconfigured Scope entry |
| `SOURCES_DIVERGE` | critical / warning | Fallback sources disagree beyond their own tolerance |
| `FIXED_PRICE` | info | The price is fixed and does not follow the market; a price made only of fixed values is never `STALE` |
| `PRICE_DEVIATION` | critical / warning / info | The oracle price is 3%+ from a liquid market price (Jupiter, $250K+ liquidity), or 50%+ above a thinner one ($25K+): critical when 10%+ above (collateral overvalued), a warning when below, info for a fixed price below (a likely deliberate haircut). Covers fixed prices, which are never stale but can be wrong. Off unless `PRICE_DEVIATION_CHECK=on`, since it names reserves one by one |
| `WIDE_CONFIDENCE` | warning | Pyth's confidence interval is wider than 2% of the price (marginfi banks reading Pyth) |
| `MARKET_CLOSED` | info | A tokenized US stock is `STALE` because its price stopped at the market close; it should resume at the next open (no score penalty) |

Each reserve gets a 0–100 score (critical −50, warning −15, info −5; `MARKET_CLOSED` only explains a `STALE` and costs nothing).

> Built for the Colosseum Crypto World's Fair hackathon (Sep–Oct 2026).

## API

Read-only REST API with OpenAPI docs at `/api/docs`.

Live at https://oraclecanary.com/api/docs.

```
GET /api/reserves?listed=true&score[lt]=100&order[totalSupplyUsd]=desc
GET /api/reserves/{address}
GET /api/reserves/{address}/history      hourly health, for charts
GET /api/events?id[gt]=123               changes in failed checks, for alerts
GET /api/incidents?resolved=false        periods a reserve's price could not be used, with duration
GET /api/reserves/{address}/attestation  the latest health, signed for the on-chain oracle_guard
GET /api/vaults                          Kamino curator vaults: deposits, allocations, money at risk
GET /api/reserves?check=STALE&provider=Chainlink   filter by failed check or oracle provider
GET /api/reserves.csv?listed=true&itemsPerPage=2000 the same lists as CSV (also /api/incidents.csv)
GET /api/wallets/{address}/positions      a wallet's Kamino and marginfi deposits and loans and Kamino
                                         vault shares, read from the chain (join with /api/reserves)
```

`listed=true` keeps markets listed in the protocol's own app (Kamino's listed markets, marginfi's main
group, every Jupiter Lend vault): anyone can create a Kamino or marginfi market with arbitrary tokens
and prices. `protocol=kamino`, `protocol=jupiter-lend` or `protocol=marginfi` narrows to one protocol.

## Project structure

```
indexer/   TypeScript: reads Solana (Kamino reserves and Scope prices, Jupiter Lend vaults, marginfi
           banks, Pyth and Chainlink prices), runs the checks, writes to PostgreSQL
web/       Symfony 8 + API Platform 5: the public API; owns the database schema (Doctrine migrations)
onchain/   Anchor program oracle_guard: other programs call assert_oracle_healthy with a health
           attestation signed by OracleCanary and fail when the reserve's oracle is unhealthy
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

# 4. Wallet positions for the "My positions" page, on :3001 (the web app's dev server proxies
#    /api/wallets there; set POSITIONS_URL to point it elsewhere). Not part of /api/docs.
npm run positions
```

Tests: `cd web && php bin/phpunit`, `cd indexer && npm test`, `cd ui && npm run build` (type-checks) and
`cd onchain && npm test`.

## Contributing

`main` is protected: changes go through a branch and a pull request, and GitHub Actions
(`.github/workflows/ci.yml`) must pass (jobs `indexer`, `web`, `ui`, `onchain`) before it can be merged.

```bash
git switch -c my-change        # work on a branch
git push -u origin my-change   # then open a pull request on GitHub
```

The server deploys `main` (`deploy/deploy.sh`), so merging is what ships.

## Production

[deploy/](deploy/README.md) runs everything on one server with Docker Compose: PostgreSQL, the API
and web app behind Caddy with automatic HTTPS, the indexer, and daily backups. `GET /api/health`
returns 503 when the data stops refreshing, for uptime monitors.

The public Solana RPC rate-limits `getProgramAccounts`, so production needs a dedicated RPC
provider. API responses are cacheable for 30s (`s-maxage=60`), so a CDN can serve most traffic.

## License

MIT
