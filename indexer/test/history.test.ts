import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReserveHealthRow } from '../src/db.js';
import { checkKeys, hourOf, lastingCheckKeys, planIncidents, trackChanges, type AlertState } from '../src/history.js';

type Severity = 'critical' | 'warning' | 'info';

function row(address: string, score: number, checks: { code: string; severity: Severity; message?: string }[]): ReserveHealthRow {
  return {
    reserve: { reserve: address } as ReserveHealthRow['reserve'],
    health: { score, checks: checks.map((c) => ({ ...c, message: c.message ?? 'm' })) as ReserveHealthRow['health']['checks'], providers: [], priceAgeSeconds: 1 },
  };
}

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 20, minute));
const CONFIRM = 180;

const closedStale = row('fwdi', 35, [{ code: 'STALE', severity: 'critical' }, { code: 'MARKET_CLOSED', severity: 'info' }]);
const healthy = row('fwdi', 85, [{ code: 'NO_FALLBACK', severity: 'warning' }]);
const stale = row('fwdi', 35, [{ code: 'STALE', severity: 'critical' }, { code: 'NO_FALLBACK', severity: 'warning' }]);
const unreadable = row('fwdi', 85, [{ code: 'UNREADABLE_ORACLE', severity: 'warning' }]);

/** Runs the rows one run per minute, starting at minute 0, and returns every confirmed change. */
function runEveryMinute(runs: ReserveHealthRow[][], initial = new Map<string, AlertState>()) {
  let states = initial;
  const changes = runs.flatMap((rows, minute) => {
    const result = trackChanges(states, rows, at(minute), CONFIRM);
    states = new Map([...states, ...result.states]);
    return result.transitions.map((t) => ({ minute, ...t }));
  });
  return { changes, states };
}

describe('trackChanges', () => {
  it('reports a change once it has lasted the confirmation time, dated when it started', () => {
    const { changes } = runEveryMinute([[healthy], [stale], [stale], [stale], [stale], [stale]]);

    assert.equal(changes.length, 1);
    assert.equal(changes[0].minute, 4);
    assert.deepEqual(changes[0].since, at(1));
    assert.deepEqual(changes[0].previous, { score: 85, checks: ['NO_FALLBACK:warning'] });
    assert.deepEqual(changes[0].current, { score: 35, checks: ['NO_FALLBACK:warning', 'STALE:critical'] });
  });

  it('ignores a price that goes stale and back between runs', () => {
    const { changes } = runEveryMinute([[healthy], [stale], [healthy], [stale], [healthy], [stale], [healthy]]);
    assert.deepEqual(changes, []);
  });

  it('keeps the last state through failed oracle reads instead of reporting a recovery', () => {
    const { changes, states } = runEveryMinute([[stale], [unreadable], [unreadable], [unreadable], [unreadable], [stale]]);

    assert.deepEqual(changes, []);
    assert.deepEqual(states.get('fwdi')?.reported.checks, ['NO_FALLBACK:warning', 'STALE:critical']);
  });

  it('reports a reserve that comes back in a different state', () => {
    // Seen healthy, then missing from three runs, then back stale for good.
    const { changes } = runEveryMinute([[healthy], [], [], [], [stale], [stale], [stale], [stale]]);
    assert.deepEqual(changes.map((c) => c.minute), [7]);
  });

  it('does not report reserves seen for the first time, or near-stale alone', () => {
    const nearStale = row('fwdi', 70, [{ code: 'NEAR_STALE', severity: 'warning' }, { code: 'NO_FALLBACK', severity: 'warning' }]);
    const { changes } = runEveryMinute([[stale], [stale], [healthy], [nearStale], [nearStale], [nearStale], [nearStale]]);

    assert.deepEqual(changes.map((c) => [c.minute, c.current.checks]), [[5, ['NO_FALLBACK:warning']]]);
  });
});

describe('planIncidents', () => {
  const state = (checks: string[]): AlertState => ({ reported: { score: 50, checks }, pending: null, pendingSince: null });
  const now = at(30);

  it('opens an incident when a change makes a reserve critical, dated when it started', () => {
    const transition = { row: stale, previous: state([]).reported, current: state(['STALE:critical']).reported, since: at(20) };
    const plan = planIncidents(new Set(), [stale], new Map([['fwdi', state(['NO_FALLBACK:warning', 'STALE:critical'])]]), [transition], now);

    assert.deepEqual(plan.open.map((o) => [o.startedAt, o.estimated, o.checks]), [[at(20), false, ['STALE:critical']]]);
    assert.deepEqual(plan.close, []);
  });

  it('keeps a closed stock market with the incident it explains', () => {
    const transition = { row: closedStale, previous: state([]).reported, current: state(['MARKET_CLOSED:info', 'STALE:critical']).reported, since: at(20) };
    const plan = planIncidents(new Set(), [closedStale], new Map([['fwdi', state(['MARKET_CLOSED:info', 'STALE:critical'])]]), [transition], now);

    assert.deepEqual(plan.open.map((o) => o.checks), [['STALE:critical', 'MARKET_CLOSED:info']]);
  });

  it('does not open an incident for a closed market alone', () => {
    const plan = planIncidents(new Set(), [closedStale], new Map([['fwdi', state(['MARKET_CLOSED:info'])]]), [], now);

    assert.deepEqual(plan.open, []);
  });

  it('estimates the start of a reserve already stale when first tracked from its price age', () => {
    const alreadyStale = { ...stale, health: { ...stale.health, priceAgeSeconds: 600 } };
    const plan = planIncidents(new Set(), [alreadyStale], new Map([['fwdi', state(['STALE:critical'])]]), [], now);

    assert.deepEqual(plan.open.map((o) => [o.startedAt, o.estimated]), [[at(20), true]]);
  });

  it('closes the open incident when the reserve is no longer critical, and leaves ongoing ones open', () => {
    const recovered = { row: healthy, previous: state(['STALE:critical']).reported, current: state(['NO_FALLBACK:warning']).reported, since: at(25) };
    const closing = planIncidents(new Set(['fwdi']), [healthy], new Map([['fwdi', state(['NO_FALLBACK:warning'])]]), [recovered], now);
    const ongoing = planIncidents(new Set(['fwdi']), [stale], new Map([['fwdi', state(['STALE:critical'])]]), [], now);

    assert.deepEqual(closing.close, [{ address: 'fwdi', endedAt: at(25) }]);
    assert.deepEqual([ongoing.open, ongoing.close], [[], []]);
  });
});

describe('checkKeys', () => {
  it('is order-independent and ignores duplicates', () => {
    assert.deepEqual(
      checkKeys([{ code: 'STALE', severity: 'critical' }, { code: 'NO_FALLBACK', severity: 'warning' }, { code: 'STALE', severity: 'critical' }]),
      ['NO_FALLBACK:warning', 'STALE:critical'],
    );
  });

  it('leaves transient checks out of the lasting ones', () => {
    assert.deepEqual(lastingCheckKeys([{ code: 'NEAR_STALE', severity: 'warning' }, { code: 'NO_FALLBACK', severity: 'warning' }]), ['NO_FALLBACK:warning']);
  });
});

describe('hourOf', () => {
  it('truncates to the start of the UTC hour', () => {
    assert.equal(hourOf(new Date('2026-09-27T19:47:13.500Z')).toISOString(), '2026-09-27T19:00:00.000Z');
  });
});
