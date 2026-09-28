# OracleCanary UI

Web interface for [OracleCanary](https://github.com/joseneves-dev/oraclecanary): which oracle every Solana
lending market depends on, and whether it is healthy.

Vue 3 + TypeScript + Vite, talking to the OracleCanary REST API (`/api`).

## Licence notice

The layout, styles and shell components are based on the **Vireo** admin template, purchased on
ThemeForest under an Envato licence. This repository must stay **private**: the template code may not
be redistributed. Only the parts the product uses are kept here.

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
