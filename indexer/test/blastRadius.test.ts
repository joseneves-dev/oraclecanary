import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate } from '../src/health.js';
import type { ScopeEntry, ScopeFeed } from '../src/oracles/scope.js';
import type { MarketOracleConfig } from '../src/types.js';
// The UI's "If an oracle fails" page reads the checks health.ts writes; these tests feed it those
// checks, so a change to their wording that it could no longer read fails here.
import {
  type DependencyReserve,
  dependencies,
  feedExposure,
  feedsOf,
  feedUses,
  providerExposure,
  providerSummaries,
} from '../../ui/src/lib/blastRadius.js';

const NOW = 1_800_000_000;

function entry(index: number, type: string, overrides: Partial<ScopeEntry> = {}): ScopeEntry {
  return {
    index, type, source: `source-${index}`, price: 100, unixTimestamp: NOW - 10, lastUpdatedSlot: 1, refPrice: null,
    combine: null, sources: [], bounds: [], dependsOn: [], maxDivergenceBps: null, sourcesMaxAgeS: null, ...overrides,
  };
}
const any = (index: number, sources: number[], overrides: Partial<ScopeEntry> = {}) =>
  entry(index, 'MostRecentOf', { source: null, combine: 'any', sources, dependsOn: sources, maxDivergenceBps: 1600, ...overrides });
const all = (index: number, sources: number[]) => entry(index, 'MultiplicationChain', { source: null, combine: 'all', sources, dependsOn: sources });
const feed = (...entries: ScopeEntry[]): ScopeFeed => ({ pricesAccount: 'prices', mappingsAccount: 'mappings', entries: new Map(entries.map((e) => [e.index, e])) });

function config(overrides: Partial<MarketOracleConfig> = {}): MarketOracleConfig {
  return {
    protocol: 'kamino', market: 'market', marketName: 'Main Market', reserve: 'reserve', asset: 'SOL', mint: 'mint', status: 'active',
    maxAgePriceSeconds: 120, feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: 'prices' }, scopeChain: [3],
    oracleSetup: null, lastPriceUpdateTs: NOW, totalSupplyUsd: 1_000_000, ...overrides,
  };
}

/** The reserve as /api/reserves returns it, with the checks and providers health.ts computed. */
function apiRow(c: MarketOracleConfig, scope?: ScopeFeed, extra: { sourceTimes?: Map<string, number>; pythTime?: number } = {}): DependencyReserve {
  const pyth = extra.pythTime ? { price: 100, confidence: 0.01, publishTime: extra.pythTime } : undefined;
  const h = evaluate(c, { scope, sourceTimes: extra.sourceTimes, pyth }, NOW);
  return {
    address: c.reserve,
    protocol: c.protocol,
    totalSupplyUsd: c.totalSupplyUsd,
    providers: h.providers,
    checks: h.checks,
    oracleAccounts: {
      scopePrices: c.feeds.scope, scopeChain: c.scopeChain, pyth: c.feeds.pyth, switchboard: c.feeds.switchboard,
      oracle: c.oracle?.account ?? null, sources: c.oracle?.sources ?? [],
    },
  };
}

const relianceMap = (r: DependencyReserve) => Object.fromEntries(dependencies(r).map((d) => [d.provider, d.reliance]));

describe('dependencies: Kamino Scope', () => {
  it('two fallback sources: neither is required, Scope is', () => {
    const r = apiRow(config(), feed(entry(1, 'Chainlink'), entry(2, 'PythLazer'), any(3, [1, 2])));
    assert.deepEqual(relianceMap(r), { Scope: 'required', Chainlink: 'fallback', PythLazer: 'fallback' });
  });

  it('a single source is required', () => {
    const r = apiRow(config(), feed(entry(3, 'PythLazer')));
    assert.deepEqual(relianceMap(r), { Scope: 'required', PythLazer: 'required' });
  });

  it('multiplied entries are each required; a staking rate is structure', () => {
    const r = apiRow(
      config({ scopeChain: [5, 3] }),
      feed(entry(1, 'Chainlink'), entry(2, 'PythLazer'), any(3, [1, 2]), entry(5, 'SplStake')),
    );
    assert.deepEqual(relianceMap(r), { Scope: 'required', SplStake: 'structure', Chainlink: 'fallback', PythLazer: 'fallback' });

    const chained = apiRow(config({ scopeChain: [4] }), feed(entry(1, 'ChainlinkX'), entry(2, 'PythLazer'), all(4, [1, 2])));
    assert.deepEqual(relianceMap(chained), { Scope: 'required', ChainlinkX: 'required', PythLazer: 'required' });
  });

  it('a fallback too old for Scope to use leaves the other source required', () => {
    const r = apiRow(
      config(),
      feed(entry(1, 'Chainlink', { unixTimestamp: NOW - 5000 }), entry(2, 'PythLazer'), any(3, [1, 2], { sourcesMaxAgeS: 600 })),
    );
    assert.equal(relianceMap(r).PythLazer, 'required');
    assert.equal(relianceMap(r).Chainlink, 'fallback');
  });

  it('a shut-down Switchboard with no alternative is required, with one it is not', () => {
    const alone = apiRow(config(), feed(entry(3, 'SwitchboardOnDemand')));
    assert.equal(relianceMap(alone).Switchboard, 'required');

    const backed = apiRow(config(), feed(entry(1, 'SwitchboardOnDemand'), entry(2, 'PythLazer'), any(3, [1, 2])));
    assert.equal(relianceMap(backed).Switchboard, 'fallback');
    assert.equal(relianceMap(backed).PythLazer, 'fallback');
  });

  it('lists the Scope price account as a required feed, with its entries', () => {
    const r = apiRow(config({ scopeChain: [5, 3] }), feed(entry(3, 'PythLazer'), entry(5, 'SplStake')));
    assert.deepEqual(feedUses(r), [{ account: 'prices', provider: 'Scope', reliance: 'required', entries: [5, 3] }]);
  });
});

describe('dependencies: marginfi and Jupiter Lend', () => {
  it('a marginfi bank relies on its one feed; its stake rate is structure', () => {
    const r = apiRow(
      config({ protocol: 'marginfi', oracleSetup: 'StakedWithPythPush', feeds: { pyth: 'pyth-sol', switchboard: null, switchboardTwap: null, scope: null }, scopeChain: [] }),
      undefined,
      { pythTime: NOW - 5 },
    );
    assert.deepEqual(relianceMap(r), { 'Stake pool rate': 'structure', Pyth: 'required' });
    assert.deepEqual(feedUses(r), [{ account: 'pyth-sol', provider: 'Pyth', reliance: 'required' }]);
  });

  it('a marginfi bank on Switchboard relies on it alone', () => {
    const r = apiRow(config({ protocol: 'marginfi', oracleSetup: 'SwitchboardPull', feeds: { pyth: null, switchboard: 'sb', switchboardTwap: null, scope: null }, scopeChain: [] }));
    assert.deepEqual(relianceMap(r), { Switchboard: 'required' });
    assert.deepEqual(feedUses(r), [{ account: 'sb', provider: 'Switchboard', reliance: 'required' }]);
  });

  it('a fixed marginfi price depends on no oracle', () => {
    const r = apiRow(config({ protocol: 'marginfi', oracleSetup: 'Fixed', fixedPrice: 1, feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: null }, scopeChain: [] }));
    assert.deepEqual(relianceMap(r), { FixedPrice: 'structure' });
  });

  it('every Jupiter Lend market source is required; a stake pool is structure', () => {
    const r = apiRow(
      config({
        protocol: 'jupiter-lend',
        feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: null },
        scopeChain: [],
        oracle: { account: 'oracle', sources: [{ type: 'StakePool', account: 'pool' }, { type: 'Chainlink', account: 'cl' }, { type: 'Pyth', account: 'py' }] },
        maxAgePriceSeconds: 600,
      }),
      undefined,
      { sourceTimes: new Map([['cl', NOW - 5], ['py', NOW - 5]]) },
    );
    assert.deepEqual(relianceMap(r), { StakePool: 'structure', Chainlink: 'required', Pyth: 'required' });
    assert.deepEqual(feedUses(r).map((u) => `${u.account}:${u.reliance}`), ['pool:structure', 'cl:required', 'py:required']);
  });
});

describe('exposure', () => {
  const sol = { ...apiRow(config({ reserve: 'sol', totalSupplyUsd: 300 }), feed(entry(1, 'Chainlink'), entry(2, 'PythLazer'), any(3, [1, 2]))) };
  const jto = apiRow(config({ reserve: 'jto', totalSupplyUsd: 200 }), feed(entry(3, 'PythLazer')));
  const usdc = apiRow(
    config({ reserve: 'usdc', protocol: 'marginfi', oracleSetup: 'PythPushOracle', totalSupplyUsd: 50, feeds: { pyth: 'pyth-usdc', switchboard: null, switchboardTwap: null, scope: null }, scopeChain: [] }),
    undefined,
    { pythTime: NOW - 5 },
  );
  const rows = [usdc, sol, jto];

  it('splits the reserves a provider reaches into stops and keeps, largest first', () => {
    const lazer = providerExposure(rows, 'PythLazer');
    assert.deepEqual(lazer.stops.map((r) => r.address), ['jto']);
    assert.deepEqual(lazer.keeps.map((r) => r.address), ['sol']);
    assert.equal(lazer.stopsUsd, 200);
    assert.equal(lazer.keepsUsd, 300);
    assert.equal(providerExposure(rows, 'RedStone').stops.length, 0);
  });

  it('summarises every provider, oracles before structure', () => {
    const s = providerSummaries(rows);
    assert.deepEqual(s.map((p) => [p.provider, p.stopsUsd, p.keepsUsd]), [
      ['Scope', 500, 0],
      ['PythLazer', 200, 300],
      ['Pyth', 50, 0],
      ['Chainlink', 0, 300],
    ]);
  });

  it('follows one feed account to its reserves', () => {
    const f = feedExposure(rows, 'pyth-usdc');
    assert.equal(f.provider, 'Pyth');
    assert.deepEqual(f.stops.map((r) => r.address), ['usdc']);
    assert.equal(feedExposure(rows, 'prices').stopsUsd, 500);
    assert.deepEqual(feedsOf(rows, 'Scope').map((x) => [x.account, x.count, x.stopsUsd]), [['prices', 2, 500]]);
  });
});
