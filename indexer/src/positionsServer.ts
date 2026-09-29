import 'dotenv/config';
import { createServer } from 'node:http';

import { Connection } from '@solana/web3.js';

import { fetchWalletPositions, prewarmVaults } from './positions.js';
import { createPositionsHandler } from './positionsHttp.js';

/**
 * GET /api/wallets/{address}/positions: a wallet's lending positions, read from the chain (see
 * positions.ts; the limits are in positionsHttp.ts). The web server proxies the path here.
 * Read-only; nothing is stored.
 */

const PORT = Number(process.env.POSITIONS_PORT ?? 3001);
// A separate key keeps public lookups from spending the quota the indexer needs.
const RPC_URL = process.env.POSITIONS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const RPC_TIMEOUT_MS = 10_000;

const connection = new Connection(RPC_URL, {
  commitment: 'confirmed',
  disableRetryOnRateLimit: true,
  // Every RPC call gives up on its own, so a stalled node never keeps a lookup waiting.
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }),
});

prewarmVaults();
const handle = createPositionsHandler({ lookup: (wallet) => fetchWalletPositions(connection, wallet) });

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(`Positions: ${(e as Error).message}`);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"Internal error."}');
  });
});
server.on('error', (e) => {
  console.error(`Positions server: ${e.message}`);
  process.exit(1);
});
// The RPC URL can carry an API key, so only whether a custom one is set is logged.
server.listen(PORT, () =>
  console.log(`Wallet positions on :${PORT} (${process.env.POSITIONS_RPC_URL ? 'own RPC key' : process.env.RPC_URL ? "the indexer's RPC" : 'public RPC'})`),
);
