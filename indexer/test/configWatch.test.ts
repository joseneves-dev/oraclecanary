import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { configChanges, storedFeeds, type StoredConfig } from '../src/configWatch.js';
import type { MarketOracleConfig } from '../src/types.js';

const reserve = (overrides: Partial<MarketOracleConfig> = {}): MarketOracleConfig => ({
  protocol: 'kamino',
  market: 'market',
  marketName: 'Main Market',
  reserve: 'reserve-sol',
  asset: 'SOL',
  mint: 'mint',
  status: 'active',
  maxAgePriceSeconds: 120,
  feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH' },
  scopeChain: [3],
  oracleSetup: null,
  lastPriceUpdateTs: 0,
  totalSupplyUsd: 1_000_000,
  ...overrides,
});

const stored = (r: MarketOracleConfig, overrides: Partial<StoredConfig> = {}): StoredConfig => ({
  listed: true,
  feeds: storedFeeds(r),
  maxAgeSeconds: r.maxAgePriceSeconds,
  providers: ['PythLazer'],
  ...overrides,
});

describe('configChanges', () => {
  it('reports nothing when nothing changed, or on a first run', () => {
    const r = reserve();
    assert.deepEqual(configChanges(new Map([[r.reserve, stored(r)]]), [{ reserve: r, providers: ['PythLazer'] }]), []);
    assert.deepEqual(configChanges(new Map(), [{ reserve: r, providers: ['PythLazer'] }]), []);
  });

  it('reports a reserve newly listed', () => {
    const known = reserve();
    const fresh = reserve({ reserve: 'reserve-new', asset: 'NEW' });
    const [change] = configChanges(new Map([[known.reserve, stored(known)]]), [{ reserve: fresh, providers: ['OrcaWhirlpoolAtoB'] }]);
    assert.equal(change.kind, 'listed');
    assert.equal(change.detail, 'Newly listed in Main Market, priced by OrcaWhirlpoolAtoB.');
  });

  it('reports a new price chain and a new provider as one price-source change', () => {
    const before = reserve();
    const after = reserve({ scopeChain: [495] });
    const [change] = configChanges(new Map([[before.reserve, stored(before)]]), [{ reserve: after, providers: ['Chainlink'] }]);
    assert.equal(change.kind, 'price_source');
    assert.match(change.detail, /Scope price chain \[3\] → \[495\]; price now from Chainlink \(was PythLazer\)/);
  });

  it('reports a changed age limit', () => {
    const before = reserve();
    const after = reserve({ maxAgePriceSeconds: 600 });
    const [change] = configChanges(new Map([[before.reserve, stored(before)]]), [{ reserve: after, providers: ['PythLazer'] }]);
    assert.equal(change.kind, 'max_age');
    assert.match(change.detail, /from 120s to 600s/);
  });

  it('ignores a field recorded for the first time, unlisted markets and unreadable providers', () => {
    const r = reserve({ oracleSetup: 'PythPushOracle' });
    const old = stored(r);
    delete old.feeds.oracleSetup;
    assert.deepEqual(configChanges(new Map([[r.reserve, old]]), [{ reserve: r, providers: [] }]), []);

    const unlisted = reserve({ reserve: 'reserve-x', marketName: null });
    assert.deepEqual(configChanges(new Map([[r.reserve, old]]), [{ reserve: unlisted, providers: ['Pyth'] }]), []);
  });
});
