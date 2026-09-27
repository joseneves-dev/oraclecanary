import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PublicKey } from '@solana/web3.js';

import { decodeDataStreamsTimestamp, decodeOracle, decodeVaultConfig, decodeVaultState } from '../src/adapters/jupiterLend.js';
import { evaluate } from '../src/health.js';
import { decodeChainlinkFeed } from '../src/oracles/chainlink.js';
import type { MarketOracleConfig, OracleSource } from '../src/types.js';

const NOW = 1_800_000_000;

function vault(sources: OracleSource[]): MarketOracleConfig {
  return {
    protocol: 'jupiter-lend',
    market: 'vaults',
    marketName: 'Jupiter Lend',
    reserve: 'vault',
    asset: 'SOL/USDC',
    mint: 'mint',
    status: 'active',
    maxAgePriceSeconds: 600,
    feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: null },
    scopeChain: [],
    oracleSetup: null,
    oracle: { account: 'oracle', sources },
    lastPriceUpdateTs: 0,
    totalSupplyUsd: 1_000_000,
  };
}

const codes = (r: ReturnType<typeof evaluate>) => r.checks.map((c) => `${c.code}:${c.severity}`);
const times = (entries: [string, number][]) => ({ sourceTimes: new Map(entries) });

describe('evaluate Jupiter Lend vaults', () => {
  it('requires every market source and ignores exchange rates for freshness', () => {
    const v = vault([
      { account: 'jitosol-rate', type: 'StakePool' },
      { account: 'sol-usd', type: 'Chainlink' },
    ]);
    const result = evaluate(v, times([['sol-usd', NOW - 30]]), NOW);
    assert.deepEqual(codes(result), ['NO_FALLBACK:warning']);
    assert.deepEqual(result.providers, ['StakePool', 'Chainlink']);
    assert.equal(result.priceAgeSeconds, 30);
  });

  it('uses the oldest market source as the price age', () => {
    const v = vault([
      { account: 'a', type: 'Pyth' },
      { account: 'b', type: 'Chainlink' },
    ]);
    assert.equal(evaluate(v, times([['a', NOW - 10], ['b', NOW - 90]]), NOW).priceAgeSeconds, 90);
  });

  it('distinguishes blocked user actions from blocked liquidations', () => {
    const v = vault([{ account: 'feed', type: 'Pyth' }]);
    assert.match(evaluate(v, times([['feed', NOW - 900]]), NOW).checks[0].message, /users cannot supply/);
    assert.match(evaluate(v, times([['feed', NOW - 10_000]]), NOW).checks[0].message, /even liquidations/);
    assert.deepEqual(codes(evaluate(v, times([['feed', NOW - 500]]), NOW)), ['NEAR_STALE:warning', 'NO_FALLBACK:warning']);
  });

  it('reports unreadable sources and empty oracles', () => {
    assert.ok(codes(evaluate(vault([{ account: 'x', type: 'Redstone' }]), times([]), NOW)).includes('UNREADABLE_ORACLE:warning'));
    assert.deepEqual(codes(evaluate(vault([]), times([]), NOW)), ['NO_ORACLE:critical']);
  });

  it('treats a vault priced only by exchange rates as having no market source to lose', () => {
    assert.deepEqual(codes(evaluate(vault([{ account: 'pst', type: 'PstPool' }]), times([]), NOW)), []);
  });
});

describe('Jupiter Lend decoders', () => {
  const key = (n: number) => new PublicKey(Buffer.alloc(32, n));

  it('reads the oracle and tokens of a vault config', () => {
    const data = Buffer.alloc(219);
    data.writeUInt16LE(7, 8);
    key(1).toBuffer().copy(data, 26);
    key(2).toBuffer().copy(data, 154);
    key(3).toBuffer().copy(data, 186);
    assert.deepEqual(decodeVaultConfig(data), {
      vaultId: 7,
      oracle: key(1).toBase58(),
      supplyToken: key(2).toBase58(),
      borrowToken: key(3).toBase58(),
    });
  });

  it('reads the supply and exchange price of a vault state', () => {
    const data = Buffer.alloc(127);
    data.writeUInt16LE(7, 8);
    data.writeBigUInt64LE(5_000_000_000n, 23);
    data.writeBigUInt64LE(1_050_000_000_000n, 99);
    assert.deepEqual(decodeVaultState(data), { vaultId: 7, totalSupply: 5_000_000_000n, vaultSupplyExchangePrice: 1_050_000_000_000n });
  });

  it('reads every source of an oracle, in order', () => {
    const data = Buffer.alloc(8 + 2 + 4 + 2 * 66 + 1);
    data.writeUInt32LE(2, 10);
    key(4).toBuffer().copy(data, 14);
    data[14 + 65] = 1; // StakePool
    key(5).toBuffer().copy(data, 14 + 66);
    data[14 + 66 + 65] = 4; // Chainlink
    assert.deepEqual(decodeOracle(data), [
      { account: key(4).toBase58(), type: 'StakePool' },
      { account: key(5).toBase58(), type: 'Chainlink' },
    ]);
  });

  it('reads the price timestamp of a Chainlink Data Streams cache after its feed list', () => {
    const feeds = 2;
    const data = Buffer.alloc(14 + feeds * 34 + 16 + 8 + 8);
    data.writeUInt32LE(feeds, 10);
    data.writeBigUInt64LE(BigInt(NOW), 14 + feeds * 34 + 16);
    assert.equal(decodeDataStreamsTimestamp(data), NOW);
  });
});

describe('decodeChainlinkFeed', () => {
  it('reads description, price and timestamp of the latest transmission', () => {
    const data = Buffer.alloc(248);
    Buffer.from('SOL / USD').copy(data, 106);
    data[138] = 8;
    data.writeUInt32LE(NOW, 208);
    data.writeBigUInt64LE(12_274_507_328n, 216);
    const feed = decodeChainlinkFeed(data);
    assert.equal(feed?.description, 'SOL / USD');
    assert.equal(feed?.timestamp, NOW);
    assert.ok(feed && Math.abs(feed.price - 122.74507328) < 1e-9);
  });

  it('rejects accounts too small to hold a transmission', () => {
    assert.equal(decodeChainlinkFeed(Buffer.alloc(100)), null);
  });
});
