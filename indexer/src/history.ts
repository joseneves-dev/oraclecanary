import type { ReserveHealthRow } from './db.js';

/** A reserve's stored health, as compared between runs. */
export interface StoredHealth {
  score: number;
  /** Failed checks as "CODE:severity", sorted. */
  checks: string[];
}

export interface HealthTransition {
  row: ReserveHealthRow;
  previous: StoredHealth;
  current: StoredHealth;
}

/**
 * The comparable part of a set of checks: codes and severities, not messages, which carry values
 * such as the price age that change on every run.
 */
export function checkKeys(checks: { code: string; severity: string }[]): string[] {
  return [...new Set(checks.map((c) => `${c.code}:${c.severity}`))].sort();
}

/**
 * Checks that flip with every feed update (a slow stablecoin feed goes in and out of "near stale" each
 * minute). They are kept in the stored checks but do not make a transition on their own.
 */
const TRANSIENT_CHECKS = new Set(['NEAR_STALE']);

const lasting = (keys: string[]) => keys.filter((k) => !TRANSIENT_CHECKS.has(k.split(':')[0])).join('|');

/**
 * Reserves whose failed checks changed since the previous run, ignoring transient checks. Reserves
 * seen for the first time are not transitions: there is nothing to compare them with.
 */
export function detectTransitions(previous: Map<string, StoredHealth>, rows: ReserveHealthRow[]): HealthTransition[] {
  return rows.flatMap((row) => {
    const before = previous.get(row.reserve.reserve);
    if (!before) return [];
    const current = { score: row.health.score, checks: checkKeys(row.health.checks) };
    return lasting(before.checks) !== lasting(current.checks) ? [{ row, previous: before, current }] : [];
  });
}

/** Start of the UTC hour a timestamp falls in. */
export function hourOf(date: Date): Date {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}
