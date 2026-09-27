import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate } from '../src/health.js';
import type { ScopeEntry, ScopeFeed } from '../src/oracles/scope.js';
import type { MarketOracleConfig } from '../src/types.js';

const NOW = 1_800_000_000;

function entry(index: number, type: string, overrides: Partial<ScopeEntry> = {}): ScopeEntry {
  return {
    index,
    type,
    source: `source-${index}`,
    price: 100,
    unixTimestamp: NOW - 10,
    lastUpdatedSlot: 1,
    refPrice: null,
    dependsOn: [],
    maxDivergenceBps: null,
    ...overrides,
  };
}

function feed(...entries: ScopeEntry[]): ScopeFeed {
  return { pricesAccount: 'prices', mappingsAccount: 'mappings', entries: new Map(entries.map((e) => [e.index, e])) };
}

function reserve(overrides: Partial<MarketOracleConfig> = {}): MarketOracleConfig {
  return {
    protocol: 'kamino',
    market: 'market',
    marketName: 'Main Market',
    reserve: 'reserve',
    asset: 'SOL',
    mint: 'mint',
    status: 'active',
    maxAgePriceSeconds: 120,
    feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: 'prices' },
    scopeChain: [3],
    lastPriceUpdateTs: NOW,
    totalSupplyUsd: 1_000_000,
    ...overrides,
  };
}

const codes = (r: ReturnType<typeof evaluate>) => r.checks.map((c) => `${c.code}:${c.severity}`);

describe('evaluate', () => {
  it('scores a fresh price with two fallback sources as healthy', () => {
    const f = feed(
      entry(1, 'Chainlink'),
      entry(2, 'PythLazer', { price: 100.5 }),
      entry(3, 'MostRecentOf', { dependsOn: [1, 2], maxDivergenceBps: 1600 }),
    );
    const result = evaluate(reserve(), f, NOW);
    assert.deepEqual(result.checks, []);
    assert.equal(result.score, 100);
    assert.deepEqual(result.providers.sort(), ['Chainlink', 'PythLazer']);
    assert.equal(result.priceAgeSeconds, 10);
  });

  it('flags a price older than the protocol limit as stale', () => {
    const result = evaluate(reserve(), feed(entry(3, 'PythLazer', { unixTimestamp: NOW - 300 })), NOW);
    assert.ok(codes(result).includes('STALE:critical'));
  });

  it('warns when a price is close to the limit', () => {
    const result = evaluate(reserve(), feed(entry(3, 'PythLazer', { unixTimestamp: NOW - 100 })), NOW);
    assert.ok(codes(result).includes('NEAR_STALE:warning'));
  });

  it('warns when a price has a single market source', () => {
    const result = evaluate(reserve(), feed(entry(3, 'PythLazer')), NOW);
    assert.deepEqual(codes(result), ['NO_FALLBACK:warning']);
    assert.equal(result.score, 85);
  });

  it('does not count a staking rate as a second price source', () => {
    const f = feed(entry(3, 'PythLazer'), entry(210, 'SplStake'));
    const result = evaluate(reserve({ scopeChain: [210, 3] }), f, NOW);
    assert.ok(codes(result).includes('NO_FALLBACK:warning'));
  });

  it('flags a chain that points at an empty Scope entry', () => {
    const result = evaluate(reserve({ scopeChain: [14] }), feed(entry(3, 'PythLazer')), NOW);
    assert.ok(codes(result).includes('EMPTY_PRICE_ENTRY:critical'));
  });

  it('is critical when the only source is a shut-down provider', () => {
    const result = evaluate(reserve(), feed(entry(3, 'SwitchboardOnDemand')), NOW);
    assert.ok(codes(result).includes('DEPRECATED_PROVIDER:critical'));
  });

  it('only warns when a shut-down provider has a live fallback', () => {
    const f = feed(
      entry(1, 'SwitchboardOnDemand'),
      entry(2, 'PythLazer'),
      entry(3, 'MostRecentOf', { dependsOn: [1, 2], maxDivergenceBps: 1600 }),
    );
    assert.ok(codes(evaluate(reserve(), f, NOW)).includes('DEPRECATED_PROVIDER:warning'));
  });

  it('flags fallback sources that disagree beyond their own limit', () => {
    const f = feed(
      entry(1, 'Chainlink', { price: 100 }),
      entry(2, 'PythLazer', { price: 120 }),
      entry(3, 'MostRecentOf', { dependsOn: [1, 2], maxDivergenceBps: 1000 }),
    );
    assert.ok(codes(evaluate(reserve(), f, NOW)).includes('SOURCES_DIVERGE:critical'));
  });

  it('is critical for a reserve that reads only a Switchboard feed directly', () => {
    const r = reserve({ feeds: { pyth: null, switchboard: 'sb', switchboardTwap: null, scope: null }, scopeChain: [] });
    const result = evaluate(r, undefined, NOW);
    assert.deepEqual(codes(result), ['DEPRECATED_PROVIDER:critical']);
    assert.equal(result.score, 50);
  });

  it('reports an unreadable Scope account instead of guessing', () => {
    assert.deepEqual(codes(evaluate(reserve(), undefined, NOW)), ['UNREADABLE_ORACLE:warning']);
  });
});
