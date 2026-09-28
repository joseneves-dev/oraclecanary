import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate } from '../src/health.js';
import { usStockSession } from '../src/marketHours.js';
import type { ScopeFeed } from '../src/oracles/scope.js';
import type { MarketOracleConfig } from '../src/types.js';

const utc = (iso: string) => new Date(`${iso}Z`);

describe('usStockSession', () => {
  it('is open during regular hours, in summer and winter time', () => {
    assert.deepEqual(usStockSession(utc('2026-09-28T13:30:00')), { open: true });
    assert.deepEqual(usStockSession(utc('2026-09-28T19:59:59')), { open: true });
    assert.deepEqual(usStockSession(utc('2026-12-01T14:30:00')), { open: true });
    assert.equal(usStockSession(utc('2026-12-01T14:29:00')).open, false);
  });

  it('reports a weekend from the Friday close to the Monday open', () => {
    const session = usStockSession(utc('2026-09-28T10:27:00'));
    assert.deepEqual(session, { open: false, reason: 'weekend', lastClose: utc('2026-09-25T20:00:00'), nextOpen: utc('2026-09-28T13:30:00') });
  });

  it('reports a weeknight as overnight', () => {
    const session = usStockSession(utc('2026-09-29T20:00:00'));
    assert.deepEqual(session, { open: false, reason: 'overnight', lastClose: utc('2026-09-29T20:00:00'), nextOpen: utc('2026-09-30T13:30:00') });
  });

  it('reports a long weekend with a holiday as a holiday', () => {
    // Labor Day, Monday 7 Sep 2026.
    const session = usStockSession(utc('2026-09-07T15:00:00'));
    assert.deepEqual(session, { open: false, reason: 'holiday', lastClose: utc('2026-09-04T20:00:00'), nextOpen: utc('2026-09-08T13:30:00') });
  });

  it('closes early the day after Thanksgiving', () => {
    assert.equal(usStockSession(utc('2026-11-27T17:59:00')).open, true);
    assert.equal(usStockSession(utc('2026-11-27T18:00:00')).open, false);
  });

  it('refuses to guess for years without a holiday list', () => {
    assert.throws(() => usStockSession(utc('2028-01-17T15:00:00')), /No US market holidays listed for 2028/);
  });

  it('has holidays listed for the next six months', () => {
    // Fails once the list is about to run out: add the next year from nyse.com.
    assert.doesNotThrow(() => usStockSession(new Date(Date.now() + 183 * 86_400_000)));
  });

  it('crosses the switch to winter time', () => {
    // US clocks go back on Sunday 1 Nov 2026: Friday closes at 20:00 UTC, Monday opens at 14:30 UTC.
    const session = usStockSession(utc('2026-11-01T12:00:00'));
    assert.deepEqual(session, { open: false, reason: 'weekend', lastClose: utc('2026-10-30T20:00:00'), nextOpen: utc('2026-11-02T14:30:00') });
  });
});

describe('MARKET_CLOSED', () => {
  const FWDI = '7GzQgf6DPo6ZANjnbhe9tNCpkGTv3zqHbsDx74jyQf9';
  const seconds = (iso: string) => utc(iso).getTime() / 1000;

  const reserve = (mint: string): MarketOracleConfig => ({
    protocol: 'kamino',
    market: 'market',
    marketName: 'Superstate Opening Bell Market',
    reserve: 'reserve',
    asset: 'FWDI',
    mint,
    status: 'active',
    maxAgePriceSeconds: 185,
    feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: 'prices' },
    scopeChain: [495],
    oracleSetup: null,
    lastPriceUpdateTs: 0,
    totalSupplyUsd: 27_000_000,
  });

  const pricedAt = (iso: string): ScopeFeed => ({
    pricesAccount: 'prices',
    mappingsAccount: 'mappings',
    entries: new Map([[495, {
      index: 495, type: 'PythLazer', source: 'lazer', price: 30, unixTimestamp: seconds(iso), lastUpdatedSlot: 1, refPrice: null,
      combine: null, sources: [], bounds: [], dependsOn: [], maxDivergenceBps: null, sourcesMaxAgeS: null,
    }]]),
  });

  const check = (mint: string, lastPrice: string, now: string) => {
    const result = evaluate(reserve(mint), { scope: pricedAt(lastPrice) }, seconds(now));
    return { result, closed: result.checks.find((c) => c.code === 'MARKET_CLOSED') };
  };

  it('explains a stock price that stopped at the Friday close, without changing the score', () => {
    const { result, closed } = check(FWDI, '2026-09-25T20:00:00', '2026-09-28T10:27:00');

    assert.ok(result.checks.some((c) => c.code === 'STALE' && c.severity === 'critical'));
    assert.equal(closed?.severity, 'info');
    assert.match(closed!.message, /closed for the weekend: the price stopped at the Fri 25 Sep 20:00 UTC close and should resume at the Mon 28 Sep 13:30 UTC open/);
    assert.equal(result.score, 35);
  });

  it('does not explain a price that was already stale before the close', () => {
    // The limit is 185s: a price from 19:56 was stale while the market was still open.
    assert.equal(check(FWDI, '2026-09-25T19:56:00', '2026-09-28T10:27:00').closed, undefined);
    assert.ok(check(FWDI, '2026-09-25T19:58:00', '2026-09-28T10:27:00').closed);
  });

  it('explains a feed that followed the after-hours session, but not one that stopped later', () => {
    const afterHours = check(FWDI, '2026-09-25T23:59:00', '2026-09-28T10:27:00').closed;
    assert.match(afterHours!.message, /the price stopped at Fri 25 Sep 23:59 UTC, after the close/);
    assert.equal(check(FWDI, '2026-09-26T01:00:00', '2026-09-28T10:27:00').closed, undefined);
  });

  it('does not explain a price that is still stale after the open', () => {
    assert.equal(check(FWDI, '2026-09-25T20:00:00', '2026-09-28T13:45:00').closed, undefined);
  });

  it('only labels tokenized stocks', () => {
    assert.equal(check('some-token', '2026-09-25T20:00:00', '2026-09-28T10:27:00').closed, undefined);
  });

  it('does not label a fresh stock price', () => {
    assert.equal(check(FWDI, '2026-09-28T10:26:00', '2026-09-28T10:27:00').closed, undefined);
  });
});
