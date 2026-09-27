import type { ScopeEntry, ScopeFeed } from './oracles/scope.js';
import { resolveLeaves } from './oracles/scope.js';
import type { MarketOracleConfig } from './types.js';

export type Severity = 'critical' | 'warning' | 'info';

export interface Check {
  code:
    | 'STALE'
    | 'NEAR_STALE'
    | 'DEPRECATED_PROVIDER'
    | 'NO_FALLBACK'
    | 'NO_ORACLE'
    | 'EMPTY_PRICE_ENTRY'
    | 'SOURCES_DIVERGE'
    | 'FIXED_PRICE'
    | 'UNREADABLE_ORACLE';
  severity: Severity;
  message: string;
}

export interface HealthResult {
  score: number;
  checks: Check[];
  /** Upstream provider types the price ultimately comes from. */
  providers: string[];
  /** Age of the oldest price in the reserve's price chain, if it could be read. */
  priceAgeSeconds: number | null;
}

/** Providers that have shut down; anything still reading them will stop getting prices. */
export const DEPRECATED_PROVIDERS = new Set(['SwitchboardOnDemand', 'SwitchboardV2']);

/**
 * Entries that describe a token's structure (staking rate, maturity, fixed peg) rather than a market
 * price, so they do not count as an independent price source.
 */
const NON_MARKET_SOURCES = new Set(['FixedPrice', 'SplStake', 'MsolStake', 'JitoRestaking', 'DiscountToMaturity']);

const PENALTY: Record<Severity, number> = { critical: 50, warning: 15, info: 5 };

/** Past this share of the protocol's max age, a price is reported as close to stale. */
const NEAR_STALE_RATIO = 0.8;
/** Past this share of a fallback's allowed divergence, its sources are reported as disagreeing. */
const DIVERGENCE_WARNING_RATIO = 0.5;

function score(checks: Check[]): number {
  return Math.max(0, 100 - checks.reduce((sum, c) => sum + PENALTY[c.severity], 0));
}

function spreadBps(entries: ScopeEntry[]): number {
  const prices = entries.map((e) => e.price).filter((p) => p > 0);
  if (prices.length < 2) return 0;
  const min = Math.min(...prices);
  return ((Math.max(...prices) - min) / min) * 10_000;
}

/** Result of asking "which single oracle, if it stopped, would break this price?". */
interface Dependency {
  /** The price cannot be produced at all (a required entry is missing or the graph loops). */
  broken: boolean;
  /** Market-price leaves whose failure alone breaks the price, keyed by type and source account. */
  singlePoints: Map<string, ScopeEntry>;
}

const leafKey = (e: ScopeEntry) => `${e.type}:${e.source ?? e.index}`;

/** Whether `parent` would still use `source`, given the parent's own limit on source age. */
function isFresh(source: ScopeEntry | undefined, parent: ScopeEntry, now: number): boolean {
  if (!source || !parent.sourcesMaxAgeS) return true;
  return now - source.unixTimestamp <= parent.sourcesMaxAgeS;
}

/**
 * Walks a Scope entry: multiplied sources (`all`) are each required, fallback sources (`any`)
 * only fail together. Bounds (caps and floors) limit the price but are not part of producing it.
 * Structural leaves (a peg, a staking rate) are not oracles, so they are never a point of failure.
 */
function dependency(feed: ScopeFeed, index: number, now: number, missing: Set<number>, path = new Set<number>()): Dependency {
  const entry = feed.entries.get(index);
  if (!entry) {
    missing.add(index);
    return { broken: true, singlePoints: new Map() };
  }
  if (path.has(index)) return { broken: true, singlePoints: new Map() };

  if (!entry.combine) {
    return { broken: false, singlePoints: NON_MARKET_SOURCES.has(entry.type) ? new Map() : new Map([[leafKey(entry), entry]]) };
  }

  const inner = new Set(path).add(index);
  const parts = entry.sources.map((i) => dependency(feed, i, now, missing, inner));

  if (entry.combine === 'all') {
    return {
      broken: parts.length === 0 || parts.some((p) => p.broken),
      singlePoints: new Map(parts.flatMap((p) => [...p.singlePoints])),
    };
  }

  // Scope skips sources older than its own limit, so a frozen source is not a live alternative.
  const working = parts.filter((p, k) => !p.broken && isFresh(feed.entries.get(entry.sources[k]), entry, now));
  if (!working.length) return { broken: true, singlePoints: new Map() };
  const [first, ...rest] = working;
  const shared = [...first.singlePoints].filter(([key]) => rest.every((p) => p.singlePoints.has(key)));
  return { broken: false, singlePoints: new Map(shared) };
}

/** Checks a reserve whose price comes from a Scope chain. */
function evaluateScope(reserve: MarketOracleConfig, feed: ScopeFeed, now: number): HealthResult {
  const checks: Check[] = [];
  if (!reserve.scopeChain.length) {
    checks.push({ code: 'NO_ORACLE', severity: 'critical', message: 'Scope is configured but the price chain is empty, so the reserve has no price source.' });
    return { score: score(checks), checks, providers: [], priceAgeSeconds: null };
  }

  const top = reserve.scopeChain.map((i) => feed.entries.get(i)).filter((e): e is ScopeEntry => !!e);
  const missing = new Set<number>();
  // The reserve's own chain multiplies its entries, so each one is required.
  const parts = reserve.scopeChain.map((i) => dependency(feed, i, now, missing));
  const singlePoints = new Map(parts.flatMap((p) => [...p.singlePoints]));

  for (const index of missing) {
    checks.push({ code: 'EMPTY_PRICE_ENTRY', severity: 'critical', message: `Price depends on Scope entry ${index}, which is not configured.` });
  }

  const leaves = reserve.scopeChain.flatMap((i) => resolveLeaves(feed, i));
  const providers = [...new Set(leaves.map((l) => l.type))];

  const priceAgeSeconds = top.length ? now - Math.min(...top.map((e) => e.unixTimestamp)) : null;
  if (priceAgeSeconds !== null && reserve.maxAgePriceSeconds > 0) {
    if (priceAgeSeconds > reserve.maxAgePriceSeconds) {
      checks.push({ code: 'STALE', severity: 'critical', message: `Price is ${priceAgeSeconds}s old; the protocol rejects prices older than ${reserve.maxAgePriceSeconds}s.` });
    } else if (priceAgeSeconds > reserve.maxAgePriceSeconds * NEAR_STALE_RATIO) {
      checks.push({ code: 'NEAR_STALE', severity: 'warning', message: `Price is ${priceAgeSeconds}s old, close to the ${reserve.maxAgePriceSeconds}s limit.` });
    }
  }

  const typesOf = (entries: Iterable<ScopeEntry>) => [...new Set([...entries].map((e) => e.type))].join(', ');

  const deprecatedSinglePoints = [...singlePoints.values()].filter((e) => DEPRECATED_PROVIDERS.has(e.type));
  if (deprecatedSinglePoints.length) {
    checks.push({
      code: 'DEPRECATED_PROVIDER',
      severity: 'critical',
      message: `Price breaks without ${typesOf(deprecatedSinglePoints)}, which has shut down.`,
    });
  } else if (providers.some((p) => DEPRECATED_PROVIDERS.has(p))) {
    checks.push({
      code: 'DEPRECATED_PROVIDER',
      severity: 'warning',
      message: `Price still reads ${typesOf(leaves.filter((l) => DEPRECATED_PROVIDERS.has(l.type)))}, which has shut down, but has another source.`,
    });
  }

  const liveSinglePoints = [...singlePoints.values()].filter((e) => !DEPRECATED_PROVIDERS.has(e.type));
  if (liveSinglePoints.length) {
    checks.push({ code: 'NO_FALLBACK', severity: 'warning', message: `Price has no fallback for ${typesOf(liveSinglePoints)}: if it stops, the price stops.` });
  }

  if (!missing.size && !leaves.some((l) => !NON_MARKET_SOURCES.has(l.type))) {
    if (leaves.some((l) => l.type === 'FixedPrice')) {
      checks.push({ code: 'FIXED_PRICE', severity: 'info', message: 'Price is fixed and does not follow the market.' });
    } else if (!leaves.length) {
      checks.push({ code: 'NO_ORACLE', severity: 'critical', message: 'The price chain reads no oracle.' });
    }
  }

  const visit = (index: number, seen = new Set<number>()) => {
    if (seen.has(index)) return;
    seen.add(index);
    const entry = feed.entries.get(index);
    if (!entry) return;
    if (entry.maxDivergenceBps) {
      // Only the alternative sources are compared; a cap is a limit, not a competing price.
      const sources = entry.sources
        .map((i) => feed.entries.get(i))
        .filter((e): e is ScopeEntry => !!e && isFresh(e, entry, now));
      const spread = spreadBps(sources);
      if (spread > entry.maxDivergenceBps * DIVERGENCE_WARNING_RATIO) {
        checks.push({
          code: 'SOURCES_DIVERGE',
          severity: spread > entry.maxDivergenceBps ? 'critical' : 'warning',
          message: `Fallback sources disagree by ${(spread / 100).toFixed(2)}% (limit ${(entry.maxDivergenceBps / 100).toFixed(2)}%).`,
        });
      }
    }
    entry.dependsOn.forEach((i) => visit(i, seen));
  };
  reserve.scopeChain.forEach((i) => visit(i));

  return { score: score(checks), checks, providers, priceAgeSeconds };
}

/** Checks a reserve that reads Pyth or Switchboard directly, without Scope. */
function evaluateDirect(reserve: MarketOracleConfig): HealthResult {
  const checks: Check[] = [];
  const providers: string[] = [];
  if (reserve.feeds.pyth) providers.push('Pyth');
  if (reserve.feeds.switchboard) providers.push('SwitchboardOnDemand');

  if (!providers.length) {
    checks.push({ code: 'NO_ORACLE', severity: 'critical', message: 'No price oracle is configured for this reserve.' });
  }

  if (reserve.feeds.switchboard) {
    checks.push({
      code: 'DEPRECATED_PROVIDER',
      severity: reserve.feeds.pyth ? 'warning' : 'critical',
      message: `Configured with a Switchboard feed, which has shut down${reserve.feeds.pyth ? '' : ' and has no other source'}.`,
    });
  }
  if (providers.length === 1 && reserve.feeds.pyth) {
    checks.push({ code: 'NO_FALLBACK', severity: 'warning', message: 'Price comes from a single oracle (Pyth) with no fallback.' });
  }
  return { score: score(checks), checks, providers, priceAgeSeconds: null };
}

export function evaluate(reserve: MarketOracleConfig, scopeFeed: ScopeFeed | undefined, now: number): HealthResult {
  if (reserve.feeds.scope) {
    if (!scopeFeed) {
      const checks: Check[] = [{ code: 'UNREADABLE_ORACLE', severity: 'warning', message: 'The Scope price account could not be read.' }];
      return { score: score(checks), checks, providers: [], priceAgeSeconds: null };
    }
    return evaluateScope(reserve, scopeFeed, now);
  }
  return evaluateDirect(reserve);
}
