// Resolves each active Kamino reserve's Scope price chain down to the upstream oracle providers.
import 'dotenv/config';
import { Connection } from '@solana/web3.js';

import { fetchKaminoReserves } from './adapters/kamino.js';
import { fetchScopeFeed, resolveLeaves, type ScopeFeed } from './oracles/scope.js';

const MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

const connection = new Connection(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
const now = Math.floor(Date.now() / 1000);

const reserves = (await fetchKaminoReserves(connection)).filter((r) => r.status === 'active' && r.feeds.scope);

const feeds = new Map<string, ScopeFeed>();
for (const address of new Set(reserves.map((r) => r.feeds.scope!))) {
  try {
    feeds.set(address, await fetchScopeFeed(connection, address));
  } catch (e) {
    console.warn(`Skipping Scope account ${address}: ${(e as Error).message}`);
  }
}

const leafUsage = new Map<string, Set<string>>();
const missing: Record<string, unknown>[] = [];
for (const r of reserves) {
  const feed = feeds.get(r.feeds.scope!);
  if (!feed) continue;
  for (const i of r.scopeChain) {
    if (!feed.entries.has(i)) {
      missing.push({ asset: r.asset, market: r.market.slice(0, 6), scopeAccount: r.feeds.scope!.slice(0, 6), index: i });
      continue;
    }
    for (const leaf of resolveLeaves(feed, i)) {
      if (!leafUsage.has(leaf.type)) leafUsage.set(leaf.type, new Set());
      leafUsage.get(leaf.type)!.add(r.reserve);
    }
  }
}

console.log('Active reserves that ultimately depend on each provider type:');
console.table([...leafUsage].map(([type, set]) => ({ type, reserves: set.size })).sort((a, b) => b.reserves - a.reserves));

console.log('Reserves whose Scope chain points at an empty entry:');
console.table(missing);

console.log('Main market, resolved to upstream providers:');
console.table(
  reserves
    .filter((r) => r.market === MAIN_MARKET)
    .sort((a, b) => a.asset.localeCompare(b.asset))
    .map((r) => {
      const feed = feeds.get(r.feeds.scope!);
      const leaves = feed ? r.scopeChain.flatMap((i) => resolveLeaves(feed, i)) : [];
      const top = feed ? r.scopeChain.map((i) => feed.entries.get(i)) : [];
      const oldest = Math.min(...top.map((e) => e?.unixTimestamp ?? 0));
      return {
        asset: r.asset,
        providers: [...new Set(leaves.map((l) => l.type))].join(', '),
        priceAgeS: oldest ? now - oldest : null,
        maxAgeS: r.maxAgePriceSeconds,
      };
    }),
);
