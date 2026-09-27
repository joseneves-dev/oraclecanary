# OracleCanary UI

Web interface for [OracleCanary](https://github.com/joseneves-dev/oraclecanary): which oracle every Solana
lending market depends on, and whether it is healthy.

Vue 3 + TypeScript + Vite, talking to the OracleCanary REST API (`/api`).

## Development

Requires Node.js 18+ and the OracleCanary API running on `http://127.0.0.1:8000`
(`cd ../oraclecanary/web && symfony serve`).

```bash
npm install
npm run dev          # http://localhost:5179, /api is proxied to the Symfony API
npm run api:types    # regenerate src/api/schema.d.ts from the API's OpenAPI spec
npm run build        # type-check and build to dist/
```

Set `API_URL` to proxy to another API host.
