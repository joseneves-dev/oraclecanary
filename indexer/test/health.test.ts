import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate } from '../src/health.js';
import type { ScopeEntry, ScopeFeed } from '../src/oracles/scope.js';
import type { MarketOracleConfig } from '../src/types.js';

const NOW = 1_800_000_000;

/** Evaluates a Kamino reserve priced by the given Scope feed. */
const evaluateKamino = (r: MarketOracleConfig, f: ScopeFeed | undefined, now: number) => evaluate(r, { scope: f }, now);

/** A leaf entry that reads an external oracle account. */
function entry(index: number, type: string, overrides: Partial<ScopeEntry> = {}): ScopeEntry {
  return {
    index,
    type,
    source: `source-${index}`,
    price: 100,
    unixTimestamp: NOW - 10,
    lastUpdatedSlot: 1,
    refPrice: null,
    combine: null,
    sources: [],
    bounds: [],
    dependsOn: [],
    maxDivergenceBps: null,
    sourcesMaxAgeS: null,
    ...overrides,
  };
}

/** Fallback entry: the most recent valid source wins. */
function mostRecentOf(index: number, sources: number[], maxDivergenceBps = 1600, bounds: number[] = [], sourcesMaxAgeS: number | null = null): ScopeEntry {
  return entry(index, bounds.length ? 'CappedMostRecentOf' : 'MostRecentOf', {
    source: null,
    combine: 'any',
    sources,
    bounds,
    dependsOn: [...sources, ...bounds],
    maxDivergenceBps,
    sourcesMaxAgeS,
  });
}

/** Product entry: every source is required. */
function multiplication(index: number, sources: number[]): ScopeEntry {
  return entry(index, 'MultiplicationChain', { source: null, combine: 'all', sources, dependsOn: sources });
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
    oracleSetup: null,
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
      mostRecentOf(3, [1, 2]),
    );
    const result = evaluateKamino(reserve(), f, NOW);
    assert.deepEqual(result.checks, []);
    assert.equal(result.score, 100);
    assert.deepEqual(result.providers.sort(), ['Chainlink', 'PythLazer']);
    assert.equal(result.priceAgeSeconds, 10);
  });

  it('flags a price older than the protocol limit as stale', () => {
    const result = evaluateKamino(reserve(), feed(entry(3, 'PythLazer', { unixTimestamp: NOW - 300 })), NOW);
    assert.ok(codes(result).includes('STALE:critical'));
  });

  it('warns when a price is close to the limit', () => {
    const result = evaluateKamino(reserve(), feed(entry(3, 'PythLazer', { unixTimestamp: NOW - 100 })), NOW);
    assert.ok(codes(result).includes('NEAR_STALE:warning'));
  });

  it('warns when a price has a single market source', () => {
    const result = evaluateKamino(reserve(), feed(entry(3, 'PythLazer')), NOW);
    assert.deepEqual(codes(result), ['NO_FALLBACK:warning']);
    assert.equal(result.score, 85);
  });

  it('does not count a staking rate as a second price source', () => {
    const f = feed(entry(3, 'PythLazer'), entry(210, 'SplStake'));
    const result = evaluateKamino(reserve({ scopeChain: [210, 3] }), f, NOW);
    assert.ok(codes(result).includes('NO_FALLBACK:warning'));
  });

  it('flags a chain that points at an empty Scope entry', () => {
    const result = evaluateKamino(reserve({ scopeChain: [14] }), feed(entry(3, 'PythLazer')), NOW);
    assert.ok(codes(result).includes('EMPTY_PRICE_ENTRY:critical'));
  });

  it('is critical when the only source is a shut-down provider', () => {
    const result = evaluateKamino(reserve(), feed(entry(3, 'SwitchboardOnDemand')), NOW);
    assert.ok(codes(result).includes('DEPRECATED_PROVIDER:critical'));
  });

  it('only warns when a shut-down provider has a live fallback', () => {
    const f = feed(
      entry(1, 'SwitchboardOnDemand'),
      entry(2, 'PythLazer'),
      mostRecentOf(3, [1, 2]),
    );
    assert.ok(codes(evaluateKamino(reserve(), f, NOW)).includes('DEPRECATED_PROVIDER:warning'));
  });

  it('flags fallback sources that disagree beyond their own limit', () => {
    const f = feed(
      entry(1, 'Chainlink', { price: 100 }),
      entry(2, 'PythLazer', { price: 120 }),
      mostRecentOf(3, [1, 2], 1000),
    );
    assert.ok(codes(evaluateKamino(reserve(), f, NOW)).includes('SOURCES_DIVERGE:critical'));
  });

  it('is critical for a reserve that reads only a Switchboard feed directly', () => {
    const r = reserve({ feeds: { pyth: null, switchboard: 'sb', switchboardTwap: null, scope: null }, scopeChain: [] });
    const result = evaluateKamino(r, undefined, NOW);
    assert.deepEqual(codes(result), ['DEPRECATED_PROVIDER:critical']);
    assert.equal(result.score, 50);
  });

  it('reports an unreadable Scope account instead of guessing', () => {
    assert.deepEqual(codes(evaluateKamino(reserve(), undefined, NOW)), ['UNREADABLE_ORACLE:warning']);
  });

  describe('fallbacks and multiplied sources', () => {
    it('is critical when a shut-down provider is multiplied into the price, even next to a live oracle', () => {
      const f = feed(entry(1, 'SwitchboardOnDemand'), entry(2, 'PythPull'));
      const result = evaluateKamino(reserve({ scopeChain: [1, 2] }), f, NOW);
      assert.ok(codes(result).includes('DEPRECATED_PROVIDER:critical'));
      assert.ok(codes(result).includes('NO_FALLBACK:warning'), 'PythPull is also required');
    });

    it('treats every factor of a MultiplicationChain as required', () => {
      const f = feed(entry(1, 'OrcaWhirlpoolAtoB'), entry(2, 'PythPull'), multiplication(3, [1, 2]));
      const result = evaluateKamino(reserve(), f, NOW);
      assert.deepEqual(codes(result), ['NO_FALLBACK:warning']);
      assert.match(result.checks[0].message, /OrcaWhirlpoolAtoB, PythPull/);
    });

    it('finds an oracle shared by every fallback branch', () => {
      const f = feed(
        entry(1, 'PythLazer'),
        entry(2, 'OrcaWhirlpoolAtoB'),
        entry(3, 'RaydiumAmmV3AtoB'),
        multiplication(4, [1, 2]),
        multiplication(5, [1, 3]),
        mostRecentOf(6, [4, 5]),
      );
      const result = evaluateKamino(reserve({ scopeChain: [6] }), f, NOW);
      assert.deepEqual(codes(result), ['NO_FALLBACK:warning']);
      assert.match(result.checks[0].message, /for PythLazer:/);
    });

    it('is healthy when a staking rate multiplies a price that has a fallback', () => {
      const f = feed(entry(1, 'Chainlink'), entry(2, 'PythLazer'), mostRecentOf(3, [1, 2]), entry(210, 'SplStake'));
      assert.deepEqual(codes(evaluateKamino(reserve({ scopeChain: [210, 3] }), f, NOW)), []);
    });

    it('does not compare a cap against the prices it limits', () => {
      const f = feed(
        entry(1, 'Chainlink', { price: 1.0 }),
        entry(2, 'PythLazer', { price: 1.0 }),
        entry(4, 'FixedPrice', { price: 1.2 }),
        mostRecentOf(3, [1, 2], 100, [4]),
      );
      const result = evaluateKamino(reserve(), f, NOW);
      assert.deepEqual(codes(result), []);
      assert.equal(result.score, 100);
    });

    it('does not count a frozen source as a fallback', () => {
      const f = feed(
        entry(1, 'SwitchboardOnDemand', { price: 80, unixTimestamp: NOW - 86_400 }),
        entry(2, 'PythLazer', { price: 100 }),
        mostRecentOf(3, [1, 2], 500, [], 3600),
      );
      const result = evaluateKamino(reserve(), f, NOW);
      assert.ok(codes(result).includes('NO_FALLBACK:warning'), 'only PythLazer is live');
      assert.ok(!codes(result).some((c) => c.startsWith('SOURCES_DIVERGE')), 'the frozen price is not compared');
    });

    it('follows a TWAP entry to the oracle it averages', () => {
      const twap = entry(5, 'ScopeTwap1h', { source: null, combine: 'all', sources: [1], dependsOn: [1] });
      const result = evaluateKamino(reserve({ scopeChain: [5] }), feed(entry(1, 'SwitchboardOnDemand'), twap), NOW);
      assert.ok(codes(result).includes('DEPRECATED_PROVIDER:critical'));
    });

    it('flags a missing entry deep inside the price graph', () => {
      const f = feed(entry(1, 'PythLazer'), multiplication(3, [1, 99]));
      assert.ok(codes(evaluateKamino(reserve(), f, NOW)).includes('EMPTY_PRICE_ENTRY:critical'));
    });
  });

  describe('reserves without an oracle', () => {
    it('is critical when Scope is configured with an empty price chain', () => {
      const result = evaluateKamino(reserve({ scopeChain: [] }), feed(entry(3, 'PythLazer')), NOW);
      assert.deepEqual(codes(result), ['NO_ORACLE:critical']);
    });

    it('is critical when no oracle is configured at all', () => {
      const r = reserve({ feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: null }, scopeChain: [] });
      assert.deepEqual(codes(evaluateKamino(r, undefined, NOW)), ['NO_ORACLE:critical']);
    });

    it('is critical when only a Switchboard TWAP account is set', () => {
      const r = reserve({ feeds: { pyth: null, switchboard: null, switchboardTwap: 'twap', scope: null }, scopeChain: [] });
      assert.deepEqual(codes(evaluateKamino(r, undefined, NOW)), ['NO_ORACLE:critical']);
    });
  });
});
