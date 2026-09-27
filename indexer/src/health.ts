import type { ScopeEntry, ScopeFeed } from './oracles/scope.js';
import { resolveLeaves } from './oracles/scope.js';
import type { MarketOracleConfig } from './types.js';

export type Severity = 'critical' | 'warning' | 'info';

export interface Check {
  code: 'STALE' | 'NEAR_STALE' | 'DEPRECATED_PROVIDER' | 'NO_FALLBACK' | 'EMPTY_PRICE_ENTRY' | 'SOURCES_DIVERGE' | 'FIXED_PRICE' | 'UNREADABLE_ORACLE';
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

/** Checks a reserve whose price comes from a Scope chain. */
function evaluateScope(reserve: MarketOracleConfig, feed: ScopeFeed, now: number): HealthResult {
  const checks: Check[] = [];
  const top: ScopeEntry[] = [];

  for (const index of reserve.scopeChain) {
    const entry = feed.entries.get(index);
    if (entry) top.push(entry);
    else checks.push({ code: 'EMPTY_PRICE_ENTRY', severity: 'critical', message: `Price chain points at Scope entry ${index}, which is not configured.` });
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

  const deprecated = providers.filter((p) => DEPRECATED_PROVIDERS.has(p));
  if (deprecated.length) {
    const onlySource = leaves.every((l) => DEPRECATED_PROVIDERS.has(l.type) || NON_MARKET_SOURCES.has(l.type));
    checks.push({
      code: 'DEPRECATED_PROVIDER',
      severity: onlySource ? 'critical' : 'warning',
      message: `Price depends on ${deprecated.join(', ')}, which has shut down${onlySource ? ' and has no other source' : ''}.`,
    });
  }

  const marketSources = new Set(leaves.filter((l) => !NON_MARKET_SOURCES.has(l.type)).map((l) => `${l.type}:${l.source}`));
  if (marketSources.size === 1) {
    checks.push({ code: 'NO_FALLBACK', severity: 'warning', message: `Price comes from a single oracle (${[...marketSources][0].split(':')[0]}) with no fallback.` });
  } else if (marketSources.size === 0 && leaves.some((l) => l.type === 'FixedPrice')) {
    checks.push({ code: 'FIXED_PRICE', severity: 'info', message: 'Price is fixed and does not follow the market.' });
  }

  const visit = (index: number, seen = new Set<number>()) => {
    if (seen.has(index)) return;
    seen.add(index);
    const entry = feed.entries.get(index);
    if (!entry) return;
    if (entry.maxDivergenceBps) {
      const sources = entry.dependsOn.map((i) => feed.entries.get(i)).filter((e): e is ScopeEntry => !!e);
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
