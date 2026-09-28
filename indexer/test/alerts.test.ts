import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alertFor, formatAlert, problemCodes, type HealthEvent } from '../src/alerts.js';

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

const CLOSED_STALE = ['MARKET_CLOSED:info', 'STALE:critical'];

/** Runs events through alertFor keeping the open-alert state, as the notifier does. */
function alertsFor(...events: HealthEvent[]): (string | null)[] {
  const open = new Set<string>();
  return events.map((e) => {
    const alert = alertFor(e, open.has(e.address), MIN);
    if (alert?.kind === 'resolved') open.delete(e.address);
    else if (alert) open.add(e.address);
    return alert?.kind ?? null;
  });
}

describe('problemCodes', () => {
  it('excuses only a stale price, and only while the market is closed', () => {
    assert.deepEqual(problemCodes(['STALE:critical', 'NO_FALLBACK:warning']), ['STALE']);
    assert.deepEqual(problemCodes(CLOSED_STALE), []);
    assert.deepEqual(problemCodes([...CLOSED_STALE, 'NO_ORACLE:critical']), ['NO_ORACLE']);
  });
});

describe('alertFor', () => {
  it('alerts when a price becomes unusable and when it recovers', () => {
    assert.deepEqual(alertsFor(event(['NO_FALLBACK:warning'], ['NO_FALLBACK:warning', 'STALE:critical']), event(['STALE:critical'], ['NO_FALLBACK:warning'])), ['started', 'resolved']);
  });

  it('does not alert on warnings alone', () => {
    assert.deepEqual(alertsFor(event([], ['NO_FALLBACK:warning'])), [null]);
  });

  it('stays quiet while a stock market is closed, and when it reopens normally', () => {
    assert.deepEqual(alertsFor(event(['NO_FALLBACK:warning'], CLOSED_STALE), event(CLOSED_STALE, ['NO_FALLBACK:warning'])), [null, null]);
  });

  it('alerts when a stock is still frozen after the market opens, and when it then recovers', () => {
    assert.deepEqual(alertsFor(event([], CLOSED_STALE), event(CLOSED_STALE, ['STALE:critical']), event(['STALE:critical'], [])), [null, 'still-frozen', 'resolved']);
  });

  it('still alerts other critical problems while the market is closed', () => {
    assert.deepEqual(alertsFor(event([], [...CLOSED_STALE, 'DEPRECATED_PROVIDER:critical'])), ['started']);
    assert.deepEqual(alertsFor(event([], CLOSED_STALE), event(CLOSED_STALE, [...CLOSED_STALE, 'NO_ORACLE:critical'])), [null, 'started']);
  });

  it('recovers an outage that lasted past the close', () => {
    const outage = event(['NO_FALLBACK:warning'], ['DEPRECATED_PROVIDER:critical']);
    const closes = event(['DEPRECATED_PROVIDER:critical'], [...CLOSED_STALE, 'DEPRECATED_PROVIDER:critical']);
    const fixed = event([...CLOSED_STALE, 'DEPRECATED_PROVIDER:critical'], CLOSED_STALE);

    assert.deepEqual(alertsFor(outage, closes, fixed), ['started', null, 'resolved']);
  });

  it('alerts when another critical check starts during an incident', () => {
    assert.deepEqual(alertsFor(event([], ['STALE:critical']), event(['STALE:critical'], ['DEPRECATED_PROVIDER:critical', 'STALE:critical'])), ['started', 'worsened']);
    assert.deepEqual(alertsFor(event([], ['DEPRECATED_PROVIDER:critical', 'STALE:critical']), event(['DEPRECATED_PROVIDER:critical', 'STALE:critical'], ['STALE:critical'])), ['started', null]);
  });

  it('opens alerts only for reserves with enough supplied, but always closes them', () => {
    assert.deepEqual(alertsFor(event([], ['STALE:critical'], { totalSupplyUsd: 500 })), [null]);
    assert.deepEqual(alertsFor(event([], ['STALE:critical']), event(['STALE:critical'], [], { totalSupplyUsd: 500 })), ['started', 'resolved']);
  });

  it('does not report a recovery for a reserve it never alerted about', () => {
    assert.deepEqual(alertsFor(event(['STALE:critical'], [])), [null]);
  });
});

describe('formatAlert', () => {
  it('says what failed, where, what is at stake and links the reserve', () => {
    const text = formatAlert(alertFor(event([], ['STALE:critical']), false, MIN)!, 'https://oraclecanary.com');

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

  it('does not blame the excused stale price for another problem during a closure', () => {
    const text = formatAlert(alertFor(event([], [...CLOSED_STALE, 'NO_ORACLE:critical']), false, MIN)!, 'https://x');
    assert.match(text, /\nNo price oracle is configured\.\n/);
  });

  it('escapes HTML in names read from chain', () => {
    const text = formatAlert(alertFor(event([], ['STALE:critical'], { asset: '<b>X&Y', marketName: null }), false, MIN)!, 'https://x');
    assert.match(text, /Price unusable: &lt;b&gt;X&amp;Y<\/b>\nKamino\n/);
  });
});
