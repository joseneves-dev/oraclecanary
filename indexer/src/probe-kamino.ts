// Lists Kamino reserves and the oracle feeds each one is configured with.
import 'dotenv/config';
import { Connection } from '@solana/web3.js';

import { fetchKaminoReserves } from './adapters/kamino.js';

const MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

const connection = new Connection(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');

const reserves = await fetchKaminoReserves(connection);
const active = reserves.filter((r) => r.status === 'active');
const now = Math.floor(Date.now() / 1000);

const count = (pred: (r: (typeof reserves)[number]) => boolean) => active.filter(pred).length;

console.log(`Kamino reserves (current layout): ${reserves.length}, active: ${active.length}`);
console.log(`Active lending markets: ${new Set(active.map((r) => r.market)).size}`);
console.log('Active reserves by configured oracle slot:');
console.log(`  Scope:              ${count((r) => !!r.feeds.scope)}`);
console.log(`  Pyth (direct):      ${count((r) => !!r.feeds.pyth)}`);
console.log(`  Switchboard (direct): ${count((r) => !!(r.feeds.switchboard || r.feeds.switchboardTwap))}`);
console.log(`  No oracle at all:   ${count((r) => !r.feeds.scope && !r.feeds.pyth && !r.feeds.switchboard)}\n`);

console.log('Main market:');
console.table(
  active
    .filter((r) => r.market === MAIN_MARKET)
    .sort((a, b) => a.asset.localeCompare(b.asset))
    .map((r) => ({
      asset: r.asset,
      oracle: r.feeds.scope ? `Scope ${r.feeds.scope.slice(0, 4)}… [${r.scopeChain.join(',')}]` : r.feeds.pyth ? 'Pyth' : r.feeds.switchboard ? 'Switchboard' : '—',
      maxAgeS: r.maxAgePriceSeconds,
      priceAgeS: r.lastPriceUpdateTs ? now - r.lastPriceUpdateTs : null,
    })),
);
