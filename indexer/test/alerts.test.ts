import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alertFor, announceConfigChange, formatAlert, formatConfigChange, formatSummary, problemCodes, summaryDue, type ConfigChangeEvent, type HealthEvent, type ReserveStatus } from '../src/alerts.js';

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

describe('formatSummary', () => {
  const reserve = (asset: string, checks: string[], totalSupplyUsd: number, protocol = 'kamino'): ReserveStatus => ({
    address: `reserve-${asset}`,
    protocol,
    asset,
    checks,
    totalSupplyUsd,
  });

  it('says all is clear, with what is watched, when nothing large is critical', () => {
    const text = formatSummary(
      [
        reserve('USDC', ['NO_FALLBACK:warning'], 3_000_000_000),
        reserve('SOL', [], 1_200_000_000, 'marginfi'),
        // A dead, empty vault stays out of the daily message, as it does of alerts.
        reserve('wstUSR', ['STALE:critical'], 0, 'jupiter-lend'),
      ],
      MIN,
      'https://oraclecanary.com',
    );

    assert.match(text, /🟢 Daily check: all clear/);
    assert.match(text, /3 listed reserves · \$4\.2B supplied · Jupiter Lend, Kamino, marginfi/);
    assert.match(text, /No reserve above \$10\.0K has a critical oracle problem\./);
    assert.doesNotMatch(text, /wstUSR/);
    assert.match(text, /https:\/\/oraclecanary\.com$/);
  });

  it('counts a stock paused by its closed market apart from real problems', () => {
    const text = formatSummary([reserve('FWDI', CLOSED_STALE, 27_000_000)], MIN, 'https://oraclecanary.com');

    assert.match(text, /all clear/);
    assert.match(text, /Market closed: 1 tokenized stock paused \(\$27\.0M\)\./);
  });

  it('lists critical reserves, largest first', () => {
    const text = formatSummary(
      [reserve('JTO', ['STALE:critical'], 50_000), reserve('<b>X', ['NO_ORACLE:critical'], 900_000), reserve('SOL', [], 1_000_000)],
      MIN,
      'https://oraclecanary.com',
    );

    assert.match(text, /🔴 Daily check: 2 critical/);
    assert.ok(text.indexOf('&lt;b&gt;X (Kamino): NO_ORACLE, $900.0K') < text.indexOf('JTO (Kamino): STALE, $50.0K'));
  });
});

describe('summaryDue', () => {
  it('is due once per UTC day, from the chosen hour', () => {
    assert.equal(summaryDue(new Date('2026-09-29T13:59:00Z'), 14, '2026-09-28'), null);
    assert.equal(summaryDue(new Date('2026-09-29T14:00:00Z'), 14, '2026-09-28'), '2026-09-29');
    assert.equal(summaryDue(new Date('2026-09-29T20:00:00Z'), 14, '2026-09-29'), null);
    assert.equal(summaryDue(new Date('2026-09-29T15:00:00Z'), 14, null), '2026-09-29');
  });
});

describe('configuration changes', () => {
  const change = (overrides: Partial<ConfigChangeEvent> = {}): ConfigChangeEvent => ({
    id: '1',
    address: 'reserve-sol',
    protocol: 'kamino',
    asset: 'SOL',
    marketName: 'Main Market',
    kind: 'price_source',
    detail: 'Price source changed: Scope price chain [3] → [495].',
    totalSupplyUsd: 250_000_000,
    ...overrides,
  });

  it('announces every new listing, and other changes to reserves worth alerting on', () => {
    assert.ok(announceConfigChange(change({ kind: 'listed', totalSupplyUsd: 0 }), MIN));
    assert.ok(announceConfigChange(change(), MIN));
    assert.ok(!announceConfigChange(change({ totalSupplyUsd: 50 }), MIN));
  });

  it('says what changed, where, and links the reserve', () => {
    const text = formatConfigChange(change(), 'https://oraclecanary.com');
    assert.match(text, /^<b>🔧 Price source changed: SOL<\/b>\nKamino · Main Market\n\nPrice source changed: Scope price chain \[3\] → \[495\]\.\nSupply: \$250\.0M/);
    assert.ok(text.endsWith('https://oraclecanary.com/reserves/reserve-sol'));
  });
});
