import type { ReserveHealthRow } from './db.js';

/** A reserve's health as compared between runs. */
export interface StoredHealth {
  score: number;
  /** Lasting failed checks as "CODE:severity", sorted. */
  checks: string[];
}

/** What change detection remembers about a reserve between runs. */
export interface AlertState {
  /** Last reported health. */
  reported: StoredHealth;
  /** A different health seen since `pendingSince`, reported once it has lasted long enough. */
  pending: StoredHealth | null;
  pendingSince: Date | null;
}

export interface HealthTransition {
  row: ReserveHealthRow;
  previous: StoredHealth;
  current: StoredHealth;
  /** When the new health was first seen. */
  since: Date;
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
 * minute; a small token's Pyth confidence hovers around its threshold). They are left out of change
 * detection and of recorded events.
 */
const TRANSIENT_CHECKS = new Set(['NEAR_STALE', 'WIDE_CONFIDENCE']);

/** Failed checks worth reporting a change of, as "CODE:severity". */
export function lastingCheckKeys(checks: { code: string; severity: string }[]): string[] {
  return checkKeys(checks.filter((c) => !TRANSIENT_CHECKS.has(c.code)));
}

const sameChecks = (a: string[], b: string[]) => a.join('|') === b.join('|');

/**
 * Compares this run's health with each reserve's alert state and returns the confirmed changes and
 * the states to store.
 *
 * - A change is reported only after it has lasted `confirmSeconds`: a price that goes stale for one
 *   run and is refreshed on the next is not an incident.
 * - A reserve whose oracle could not be read is left as it was: a failed read says nothing about its
 *   health, and treating it as one would report false recoveries.
 * - Reserves seen for the first time only get a state: there is nothing to compare them with.
 */
export function trackChanges(
  states: Map<string, AlertState>,
  rows: ReserveHealthRow[],
  now: Date,
  confirmSeconds: number,
): { transitions: HealthTransition[]; states: Map<string, AlertState> } {
  const transitions: HealthTransition[] = [];
  const next = new Map<string, AlertState>();

  for (const row of rows) {
    const address = row.reserve.reserve;
    const before = states.get(address);
    if (row.health.checks.some((c) => c.code === 'UNREADABLE_ORACLE')) {
      if (before) next.set(address, before);
      continue;
    }

    const current = { score: row.health.score, checks: lastingCheckKeys(row.health.checks) };
    if (!before) {
      next.set(address, { reported: current, pending: null, pendingSince: null });
      continue;
    }
    if (sameChecks(before.reported.checks, current.checks)) {
      next.set(address, { reported: current, pending: null, pendingSince: null });
      continue;
    }

    const since = before.pending && before.pendingSince && sameChecks(before.pending.checks, current.checks) ? before.pendingSince : now;
    if (now.getTime() - since.getTime() >= confirmSeconds * 1000) {
      transitions.push({ row, previous: before.reported, current, since });
      next.set(address, { reported: current, pending: null, pendingSince: null });
    } else {
      next.set(address, { reported: before.reported, pending: current, pendingSince: since });
    }
  }
  return { transitions, states: next };
}

export interface IncidentStart {
  row: ReserveHealthRow;
  startedAt: Date;
  /** The reserve was already critical when first tracked: the start is estimated from the price age. */
  estimated: boolean;
  /** Critical checks, and whether the stock market was closed, as "CODE:severity". */
  checks: string[];
}

const criticalKeys = (keys: string[]) => keys.filter((k) => k.endsWith(':critical'));
/** Checks that explain an incident rather than cause one; kept with it so the log shows why. */
const contextKeys = (keys: string[]) => keys.filter((k) => k.startsWith('MARKET_CLOSED:'));

/**
 * Incidents to open and close so that a reserve has an open incident exactly while its reported
 * state is critical. Being a comparison rather than a reaction to transitions, it also opens incidents
 * for reserves that were already critical before incidents were recorded.
 */
export function planIncidents(
  openIncidents: Set<string>,
  rows: ReserveHealthRow[],
  states: Map<string, AlertState>,
  transitions: HealthTransition[],
  now: Date,
): { open: IncidentStart[]; close: { address: string; endedAt: Date }[] } {
  const changed = new Map(transitions.map((t) => [t.row.reserve.reserve, t]));
  const open: IncidentStart[] = [];
  const close: { address: string; endedAt: Date }[] = [];

  for (const row of rows) {
    const address = row.reserve.reserve;
    const state = states.get(address);
    if (!state) continue;
    const critical = criticalKeys(state.reported.checks);
    const transition = changed.get(address);

    if (critical.length && !openIncidents.has(address)) {
      const staleFor = row.health.checks.some((c) => c.code === 'STALE') ? row.health.priceAgeSeconds : null;
      open.push({
        row,
        startedAt: transition?.since ?? new Date(now.getTime() - (staleFor ?? 0) * 1000),
        estimated: !transition,
        checks: [...critical, ...contextKeys(state.reported.checks)],
      });
    } else if (!critical.length && openIncidents.has(address)) {
      close.push({ address, endedAt: transition?.since ?? now });
    }
  }
  return { open, close };
}

/** Start of the UTC hour a timestamp falls in. */
export function hourOf(date: Date): Date {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}
