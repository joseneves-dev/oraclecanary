import type { MarketOracleConfig } from './types.js';

/**
 * Spots changes to how listed reserves are priced, from one run to the next: a reserve newly listed,
 * a different price source (feed accounts, Scope chain, oracle setup, or the providers the price
 * ultimately comes from), or a different limit on the price's age. Such changes are routine when a
 * protocol migrates an oracle, and the first sign of trouble when a thin token is listed or an
 * oracle is swapped without notice; either way they are worth knowing within minutes.
 */

/** What was stored for a reserve at the previous run (lending_reserve). */
export interface StoredConfig {
  listed: boolean;
  /** The stored `feeds` JSON: feed accounts, scopeChain, oracle, and (from now on) oracleSetup. */
  feeds: Record<string, unknown>;
  maxAgeSeconds: number;
  providers: string[];
}

export type ConfigChangeKind = 'listed' | 'price_source' | 'max_age';

export interface ConfigChange {
  reserve: MarketOracleConfig;
  kind: ConfigChangeKind;
  /** One sentence for people. */
  detail: string;
  before: unknown;
  after: unknown;
}

/** The oracle fields of a reserve as stored in `feeds`. */
export function storedFeeds(r: MarketOracleConfig): Record<string, unknown> {
  return { ...r.feeds, scopeChain: r.scopeChain, oracle: r.oracle ?? null, oracleSetup: r.oracleSetup };
}

const SOURCE_FIELDS = ['pyth', 'switchboard', 'switchboardTwap', 'scope', 'scopeChain', 'oracle', 'oracleSetup'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const short = (value: unknown): string => {
  if (typeof value === 'string' && value.length > 12) return `${value.slice(0, 4)}…${value.slice(-4)}`;
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  if (value && typeof value === 'object') return 'a different oracle';
  return String(value ?? 'none');
};
const LABEL: Record<(typeof SOURCE_FIELDS)[number], string> = {
  pyth: 'Pyth feed',
  switchboard: 'Switchboard feed',
  switchboardTwap: 'Switchboard TWAP feed',
  scope: 'Scope price account',
  scopeChain: 'Scope price chain',
  oracle: 'Oracle',
  oracleSetup: 'Oracle setup',
};

/**
 * The changes between the stored configs and this run's listed reserves. Nothing is reported for a
 * protocol with no stored reserves yet (a first run), and a field newly recorded (absent before) is
 * not a change.
 */
export function configChanges(previous: Map<string, StoredConfig>, current: { reserve: MarketOracleConfig; providers: string[] }[]): ConfigChange[] {
  if (!previous.size) return [];
  const changes: ConfigChange[] = [];
  for (const { reserve: r, providers } of current) {
    if (!r.marketName || r.status !== 'active') continue;
    const before = previous.get(r.reserve);
    if (!before || !before.listed) {
      changes.push({
        reserve: r,
        kind: 'listed',
        detail: `Newly listed in ${r.marketName}, priced by ${providers.length ? providers.join(', ') : 'an unrecognised source'}.`,
        before: null,
        after: { providers },
      });
      continue;
    }

    const after = storedFeeds(r);
    const changed = SOURCE_FIELDS.filter((f) => f in before.feeds && !same(before.feeds[f], after[f]));
    const providersChanged =
      before.providers.length > 0 && providers.length > 0 && !same([...before.providers].sort(), [...providers].sort());
    if (changed.length || providersChanged) {
      const parts = changed.map((f) => `${LABEL[f]} ${short(before.feeds[f])} → ${short(after[f])}`);
      if (providersChanged) parts.push(`price now from ${providers.join(', ')} (was ${before.providers.join(', ')})`);
      changes.push({
        reserve: r,
        kind: 'price_source',
        detail: `Price source changed: ${parts.join('; ')}.`,
        before: { ...Object.fromEntries(changed.map((f) => [f, before.feeds[f]])), providers: before.providers },
        after: { ...Object.fromEntries(changed.map((f) => [f, after[f]])), providers },
      });
    }

    if (before.maxAgeSeconds !== r.maxAgePriceSeconds) {
      changes.push({
        reserve: r,
        kind: 'max_age',
        detail: `The oldest price the protocol accepts changed from ${before.maxAgeSeconds}s to ${r.maxAgePriceSeconds}s.`,
        before: before.maxAgeSeconds,
        after: r.maxAgePriceSeconds,
      });
    }
  }
  return changes;
}
