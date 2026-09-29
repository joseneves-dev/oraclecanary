import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate, setPriceDeviationCheck } from '../src/health.js';
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

  it('does not flag the age of a price made only of fixed values', () => {
    const fixed = evaluateKamino(reserve(), feed(entry(3, 'FixedPrice', { unixTimestamp: NOW - 456 })), NOW);
    assert.deepEqual(codes(fixed), ['FIXED_PRICE:info']);
    assert.equal(fixed.priceAgeSeconds, 456);

    // A fixed value multiplied with a market price still ages with that price.
    const mixed = evaluateKamino(reserve({ scopeChain: [3, 4] }), feed(entry(3, 'FixedPrice', { unixTimestamp: NOW - 456 }), entry(4, 'PythLazer')), NOW);
    assert.ok(codes(mixed).includes('STALE:critical'));
  });

  describe('price against the market', () => {
    const market = (usdPrice: number, liquidity = 5_000_000) => ({ usdPrice, liquidity });
    const fresh = (index: number, price: number) => entry(index, 'PythLazer', { price });

    it('multiplies the Scope chain and flags a price far from the market', () => {
      // A staking rate times SOL: 1.1 × 100 = 110, against a market price of 95.
      const f = feed(fresh(3, 1.1), fresh(4, 100));
      const result = evaluate(reserve({ scopeChain: [3, 4] }), { scope: f, market: market(95) }, NOW);
      const check = result.checks.find((c) => c.code === 'PRICE_DEVIATION');

      assert.equal(check?.severity, 'critical');
      assert.match(check!.message, /The oracle price \$110\.00 is 16% above the market price \(\$95\.00 on Jupiter\): collateral is overvalued/);
      assert.equal(result.score, 100 - 50 - 15); // the deviation, and no fallback
    });

    it('reports a price below the market as a liquidation risk, never as critical', () => {
      const result = evaluate(reserve(), { scope: feed(fresh(3, 96)), market: market(100) }, NOW);
      const check = result.checks.find((c) => c.code === 'PRICE_DEVIATION');
      assert.equal(check?.severity, 'warning');
      assert.match(check!.message, /4\.0% below .*borrowers can be liquidated early/);

      // A deliberate haircut far below the market (seen on banks being wound down) stays a warning.
      const haircut = evaluate(reserve(), { scope: feed(fresh(3, 56)), market: market(100) }, NOW);
      assert.equal(haircut.checks.find((c) => c.code === 'PRICE_DEVIATION')?.severity, 'warning');
    });

    it('ignores small gaps, thin markets and reserves with nothing in them', () => {
      const codesWith = (price: number, m: ReturnType<typeof market>, supply = 1_000_000) =>
        codes(evaluate(reserve({ totalSupplyUsd: supply }), { scope: feed(fresh(3, price)), market: m }, NOW));

      assert.ok(!codesWith(102, market(100)).some((c) => c.startsWith('PRICE_DEVIATION')));
      assert.ok(!codesWith(120, market(100, 100_000)).some((c) => c.startsWith('PRICE_DEVIATION')), 'thin market, only 20% off');
      assert.ok(!codesWith(200, market(100, 500)).some((c) => c.startsWith('PRICE_DEVIATION')), 'next to no market');
      assert.ok(!codesWith(0.000001, market(2), 0).some((c) => c.startsWith('PRICE_DEVIATION')));
    });

    it('flags a price far above even a thin market: a dead token left with a fixed price', () => {
      const result = evaluate(reserve(), { scope: feed(entry(3, 'FixedPrice', { price: 0.0001 })), market: market(0.0000000286, 30_000) }, NOW);
      const check = result.checks.find((c) => c.code === 'PRICE_DEVIATION');

      assert.equal(check?.severity, 'critical');
      assert.match(check!.message, /The fixed price \$0\.0001 is 3,497× the market price \(\$0\.0000000286 on Jupiter, a thin market\): collateral is overvalued/);
    });

    it('does not trust a market thin enough to be dumped on purpose', () => {
      // An honest $1 price against a pool with a few thousand dollars someone pushed down to $0.30.
      const result = evaluate(reserve(), { scope: feed(fresh(3, 1)), market: market(0.3, 5_000) }, NOW);
      assert.ok(!codes(result).some((c) => c.startsWith('PRICE_DEVIATION')));
    });

    it('writes moderate multiples with one decimal', () => {
      const result = evaluate(reserve(), { scope: feed(fresh(3, 2.4)), market: market(1) }, NOW);
      assert.match(result.checks.find((c) => c.code === 'PRICE_DEVIATION')!.message, /\$2\.40 is 2\.4× the market price/);
    });

    it('treats a fixed price below the market as a likely deliberate haircut', () => {
      const result = evaluate(reserve(), { scope: feed(entry(3, 'FixedPrice', { price: 80 })), market: market(145) }, NOW);
      const check = result.checks.find((c) => c.code === 'PRICE_DEVIATION');
      assert.equal(check?.severity, 'info');
      assert.match(check!.message, /probably a deliberate haircut/);
    });

    it('does not alarm about the price of a bank being wound down, which backs no borrowing', () => {
      // marginfi's WEN bank: fixed far above the market, but reduce-only with no collateral weight.
      const result = evaluate(
        reserve({ windingDown: true }),
        { scope: feed(entry(3, 'FixedPrice', { price: 0.0001 })), market: market(0.0000073, 500_000) },
        NOW,
      );
      const check = result.checks.find((c) => c.code === 'PRICE_DEVIATION');

      assert.equal(check?.severity, 'info');
      assert.match(check!.message, /14× the market price .*wound down and counts it for no collateral/);
      assert.ok(codes(result).includes('WINDING_DOWN:info'));
      assert.equal(result.score, 100 - 5 - 5); // the fixed price and the deviation; winding down itself costs nothing
    });

    it('is not computed while switched off', () => {
      setPriceDeviationCheck(false);
      try {
        const result = evaluate(reserve(), { scope: feed(fresh(3, 200)), market: market(100) }, NOW);
        assert.ok(!codes(result).some((c) => c.startsWith('PRICE_DEVIATION')));
      } finally {
        setPriceDeviationCheck(true);
      }
    });
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

describe('providers', () => {
  it('lists where the price comes from, not the caps that bound it', () => {
    const f = feed(
      entry(1, 'Chainlink'),
      entry(2, 'PythLazer'),
      entry(4, 'FixedPrice', { price: 1.2 }),
      mostRecentOf(3, [1, 2], 100, [4]),
    );
    assert.deepEqual(evaluateKamino(reserve(), f, NOW).providers.sort(), ['Chainlink', 'PythLazer']);
  });

  it('still warns about a shut-down provider behind a cap', () => {
    const f = feed(entry(1, 'Chainlink'), entry(2, 'PythLazer'), entry(4, 'SwitchboardOnDemand'), mostRecentOf(3, [1, 2], 100, [4]));
    assert.ok(codes(evaluateKamino(reserve(), f, NOW)).includes('DEPRECATED_PROVIDER:warning'));
  });
});
