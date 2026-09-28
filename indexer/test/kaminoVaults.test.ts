import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { curatorOf, curatorsByVault, valueVaults, type ApiVault } from '../src/adapters/kaminoVaults.js';
import type { MarketOracleConfig } from '../src/types.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const reserve = (address: string, totalSupplyUsd: number, ctokenSupply: number): MarketOracleConfig => ({
  protocol: 'kamino',
  market: 'm',
  marketName: 'Main Market',
  reserve: address,
  asset: 'USDC',
  mint: USDC,
  status: 'active',
  maxAgePriceSeconds: 120,
  feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: 'prices' },
  scopeChain: [3],
  oracleSetup: null,
  lastPriceUpdateTs: 0,
  totalSupplyUsd,
  ctokenSupply,
});

const vault = (allocations: [string, string][], tokenAvailable = '0', name = 'Steakhouse USDC', admin = 'admin-steakhouse', address = 'vault'): ApiVault => ({
  address,
  state: {
    vaultAdminAuthority: admin,
    name: [...Buffer.from(name), 0, 0, 0],
    tokenMint: USDC,
    tokenMintDecimals: 6,
    tokenAvailable,
    vaultAllocationStrategy: allocations.map(([r, ctokenAllocation]) => ({ reserve: r, ctokenAllocation })),
  },
});

const reserves = new Map([
  ['a', reserve('a', 1_000_000, 900_000)],
  ['b', reserve('b', 500_000, 500_000)],
]);

describe('valueVaults', () => {
  it('values each allocation as its share of the reserve, largest first, plus idle deposits', () => {
    const [v] = valueVaults(
      [vault([['b', '100000'], ['a', '90000'], ['11111111111111111111111111111111', '5']], '2000000')],
      reserves,
      new Map([[USDC, { usdPrice: 1, liquidity: 1e9 }]]),
    );

    assert.deepEqual(v.allocations, [{ reserve: 'b', usd: 100_000 }, { reserve: 'a', usd: 100_000 }].sort((x, y) => y.usd - x.usd));
    assert.equal(v.idleUsd, 2);
    assert.equal(v.totalUsd, 200_002);
    assert.equal(v.name, 'Steakhouse USDC');
    assert.equal(v.curator, 'Steakhouse');
    assert.equal(v.token, 'USDC');
  });

  it('leaves out reserves it did not read and drops empty vaults', () => {
    assert.deepEqual(valueVaults([vault([['unknown', '5000']])], reserves, new Map()), []);
    assert.deepEqual(valueVaults([vault([['a', '0']])], reserves, new Map()), []);
  });
});

describe('curatorsByVault', () => {
  it('credits every vault of an admin account to the curator its vaults are named after', () => {
    const curators = curatorsByVault([
      vault([], '0', 'Sentora PYUSD', 'admin-sentora', 'v1'),
      vault([], '0', 'Ethena PYUSD Prime', 'admin-sentora', 'v2'),
      vault([], '0', 'RWA USDC', 'admin-unknown', 'v3'),
    ]);
    assert.deepEqual([...curators], [['v1', 'Sentora'], ['v2', 'Sentora'], ['v3', null]]);
  });
});

describe('curatorOf', () => {
  it('recognises a curator as a word in the vault name', () => {
    assert.equal(curatorOf('Plume x Re7 USDC'), 'Re7');
    assert.equal(curatorOf('Sentora PYUSD'), 'Sentora');
    assert.equal(curatorOf('wYLDS Allocator'), null);
    assert.equal(curatorOf('Neutral Trade USDC Max Yield'), 'Neutral Trade');
    assert.equal(curatorOf('NeutralTrade USDC'), 'Neutral Trade');
    assert.equal(curatorOf('Galaxy USDT'), 'Galaxy');
  });
});
