import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReserveHealthRow } from '../src/db.js';
import { checkKeys, detectTransitions, hourOf, type StoredHealth } from '../src/history.js';

function row(address: string, score: number, checks: { code: string; severity: 'critical' | 'warning' | 'info'; message?: string }[]): ReserveHealthRow {
  return {
    reserve: { reserve: address } as ReserveHealthRow['reserve'],
    health: { score, checks: checks.map((c) => ({ ...c, message: c.message ?? 'm' })) as ReserveHealthRow['health']['checks'], providers: [], priceAgeSeconds: 1 },
  };
}

describe('detectTransitions', () => {
  const previous = new Map<string, StoredHealth>([
    ['steady', { score: 85, checks: ['NO_FALLBACK:warning'] }],
    ['went-stale', { score: 85, checks: ['NO_FALLBACK:warning'] }],
    ['recovered', { score: 35, checks: ['NO_FALLBACK:warning', 'STALE:critical'] }],
  ]);

  it('reports reserves whose score or checks changed, not those whose messages did', () => {
    const transitions = detectTransitions(previous, [
      row('steady', 85, [{ code: 'NO_FALLBACK', severity: 'warning', message: 'price is 12s old' }]),
      row('went-stale', 35, [{ code: 'STALE', severity: 'critical' }, { code: 'NO_FALLBACK', severity: 'warning' }]),
      row('recovered', 85, [{ code: 'NO_FALLBACK', severity: 'warning' }]),
    ]);

    assert.deepEqual(transitions.map((t) => t.row.reserve.reserve), ['went-stale', 'recovered']);
    assert.deepEqual(transitions[0].current, { score: 35, checks: ['NO_FALLBACK:warning', 'STALE:critical'] });
    assert.deepEqual(transitions[1].previous.checks, ['NO_FALLBACK:warning', 'STALE:critical']);
  });

  it('does not report reserves seen for the first time', () => {
    assert.deepEqual(detectTransitions(previous, [row('new', 50, [{ code: 'STALE', severity: 'critical' }])]), []);
  });

  it('ignores a reserve going in and out of near-stale', () => {
    const flapping = new Map<string, StoredHealth>([['usds', { score: 85, checks: ['NO_FALLBACK:warning'] }]]);
    const rows = [row('usds', 70, [{ code: 'NEAR_STALE', severity: 'warning' }, { code: 'NO_FALLBACK', severity: 'warning' }])];
    assert.deepEqual(detectTransitions(flapping, rows), []);
  });
});

describe('checkKeys', () => {
  it('is order-independent and ignores duplicates', () => {
    assert.deepEqual(
      checkKeys([{ code: 'STALE', severity: 'critical' }, { code: 'NO_FALLBACK', severity: 'warning' }, { code: 'STALE', severity: 'critical' }]),
      ['NO_FALLBACK:warning', 'STALE:critical'],
    );
  });
});

describe('hourOf', () => {
  it('truncates to the start of the UTC hour', () => {
    assert.equal(hourOf(new Date('2026-09-27T19:47:13.500Z')).toISOString(), '2026-09-27T19:00:00.000Z');
  });
});
