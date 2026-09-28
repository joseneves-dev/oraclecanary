import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alertFor, formatAlert, type HealthEvent } from '../src/alerts.js';

const MIN = 10_000;

const event = (previousChecks: string[], checks: string[], overrides: Partial<HealthEvent> = {}): HealthEvent => ({
  id: '1',
  address: 'reserve-fwdi',
  protocol: 'kamino',
  asset: 'FWDI',
  marketName: 'Superstate Opening Bell Market',
  previousChecks,
  checks,
  totalSupplyUsd: 27_000_000,
  ...overrides,
});

const kind = (e: HealthEvent) => alertFor(e, MIN)?.kind ?? null;

describe('alertFor', () => {
  it('alerts when a price becomes unusable and when it recovers', () => {
    assert.equal(kind(event(['NO_FALLBACK:warning'], ['NO_FALLBACK:warning', 'STALE:critical'])), 'started');
    assert.equal(kind(event(['STALE:critical'], ['NO_FALLBACK:warning'])), 'resolved');
  });

  it('does not alert on warnings alone', () => {
    assert.equal(kind(event([], ['NO_FALLBACK:warning'])), null);
  });

  it('stays quiet while a stock market is closed, and when it reopens normally', () => {
    assert.equal(kind(event(['NO_FALLBACK:warning'], ['MARKET_CLOSED:info', 'STALE:critical'])), null);
    assert.equal(kind(event(['MARKET_CLOSED:info', 'STALE:critical'], ['NO_FALLBACK:warning'])), null);
  });

  it('alerts when a stock is still frozen after the market opens', () => {
    assert.equal(kind(event(['MARKET_CLOSED:info', 'STALE:critical'], ['STALE:critical'])), 'still-frozen');
  });

  it('alerts when another critical check starts during an incident', () => {
    assert.equal(kind(event(['STALE:critical'], ['DEPRECATED_PROVIDER:critical', 'STALE:critical'])), 'worsened');
    assert.equal(kind(event(['DEPRECATED_PROVIDER:critical', 'STALE:critical'], ['STALE:critical'])), null);
  });

  it('leaves out reserves with little supplied', () => {
    assert.equal(kind(event([], ['STALE:critical'], { totalSupplyUsd: 500 })), null);
  });
});

describe('formatAlert', () => {
  it('says what failed, where, what is at stake and links the reserve', () => {
    const text = formatAlert(alertFor(event([], ['STALE:critical']), MIN)!, 'https://oraclecanary.com');

    assert.equal(
      text,
      [
        '<b>🔴 Price unusable: FWDI</b>',
        'Kamino · Superstate Opening Bell Market',
        '',
        'The price is stale, so the protocol rejects it. Borrowing and liquidations fail until it updates.',
        'Supply: $27.0M',
        '',
        'https://oraclecanary.com/reserves/reserve-fwdi',
      ].join('\n'),
    );
  });

  it('escapes HTML in names read from chain', () => {
    const text = formatAlert(alertFor(event([], ['STALE:critical'], { asset: '<b>X&Y', marketName: null }), MIN)!, 'https://x');
    assert.match(text, /Price unusable: &lt;b&gt;X&amp;Y<\/b>\nKamino\n/);
  });
});
