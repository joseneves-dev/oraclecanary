import { reference, type MarketPrice } from './oracles/marketPrice.js';
import type { PythPrice } from './oracles/pyth.js';
import type { ScopeEntry, ScopeFeed } from './oracles/scope.js';
import { resolveLeaves } from './oracles/scope.js';
import { type ClosedReason, US_STOCK_MINTS, usStockSession } from './marketHours.js';
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
    | 'UNREADABLE_ORACLE'
    | 'MARKET_CLOSED'
    | 'WINDING_DOWN'
    | 'PRICE_DEVIATION'
    | 'WIDE_CONFIDENCE';
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

/** Checks that explain another check rather than report a problem of their own. */
const NO_PENALTY = new Set<Check['code']>(['MARKET_CLOSED', 'WINDING_DOWN']);

function score(checks: Check[]): number {
  return Math.max(0, 100 - checks.reduce((sum, c) => sum + (NO_PENALTY.has(c.code) ? 0 : PENALTY[c.severity]), 0));
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

  // The price is computed from `leaves`; caps and floors are read too, so a shut-down provider
  // behind one still matters, but they are not where the price comes from.
  const leaves = reserve.scopeChain.flatMap((i) => resolveLeaves(feed, i, false));
  const leavesWithBounds = reserve.scopeChain.flatMap((i) => resolveLeaves(feed, i));
  const providers = [...new Set(leaves.map((l) => l.type))];

  // A price made only of fixed values says nothing about the market, so an old one is as right as a
  // new one: its timestamp only moves when Scope is refreshed. Its age is reported but not flagged.
  const fixedOnly = !missing.size && leaves.length > 0 && leaves.every((l) => l.type === 'FixedPrice');

  const priceAgeSeconds = top.length ? now - Math.min(...top.map((e) => e.unixTimestamp)) : null;
  if (!fixedOnly && priceAgeSeconds !== null && reserve.maxAgePriceSeconds > 0) {
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
  } else if (leavesWithBounds.some((l) => DEPRECATED_PROVIDERS.has(l.type))) {
    checks.push({
      code: 'DEPRECATED_PROVIDER',
      severity: 'warning',
      message: `Price still reads ${typesOf(leavesWithBounds.filter((l) => DEPRECATED_PROVIDERS.has(l.type)))}, which has shut down, but has another source.`,
    });
  }

  const liveSinglePoints = [...singlePoints.values()].filter((e) => !DEPRECATED_PROVIDERS.has(e.type));
  if (liveSinglePoints.length) {
    checks.push({ code: 'NO_FALLBACK', severity: 'warning', message: `Price has no fallback for ${typesOf(liveSinglePoints)}: if it stops, the price stops.` });
  }

  if (!missing.size && !leaves.some((l) => !NON_MARKET_SOURCES.has(l.type))) {
    if (fixedOnly) {
      checks.push({
        code: 'FIXED_PRICE',
        severity: 'info',
        message: 'Price is fixed and does not follow the market; how long ago it was refreshed does not change it, so its age is not checked.',
      });
    } else if (leaves.some((l) => l.type === 'FixedPrice')) {
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

/** What a marginfi oracle setup multiplies the Pyth price by, for setups that are not a plain feed. */
const MARGINFI_RATE_SOURCES: Record<string, string> = {
  StakedWithPythPush: 'Stake pool rate',
  PythLST: 'LST rate',
  PythMSOL: 'mSOL rate',
  KaminoPythPush: 'Kamino exchange rate',
  KaminoLST: 'Kamino exchange rate',
  KaminoMSOL: 'Kamino exchange rate',
  DriftPythPull: 'Drift exchange rate',
  SolendPythPull: 'Solend exchange rate',
  JuplendPythPull: 'Jupiter Lend exchange rate',
  JuplendLST: 'Jupiter Lend exchange rate',
  JuplendMSOL: 'Jupiter Lend exchange rate',
  PTPyth: 'PT discount',
};

/**
 * Checks a marginfi bank. Each bank prices from exactly one oracle account, possibly multiplied by
 * an exchange rate, so there is never a fallback oracle.
 */
function evaluateMarginfi(reserve: MarketOracleConfig, pyth: PythPrice | undefined, now: number): HealthResult {
  const setup = reserve.oracleSetup ?? 'None';
  const checks: Check[] = [];

  if (setup === 'None') {
    checks.push({ code: 'NO_ORACLE', severity: 'critical', message: 'No price oracle is configured for this bank.' });
    return { score: score(checks), checks, providers: [], priceAgeSeconds: null };
  }
  if (setup.startsWith('Fixed')) {
    checks.push({ code: 'FIXED_PRICE', severity: 'info', message: 'Price is fixed and does not follow the market.' });
    return { score: score(checks), checks, providers: ['FixedPrice'], priceAgeSeconds: null };
  }
  if (reserve.feeds.switchboard) {
    checks.push({ code: 'DEPRECATED_PROVIDER', severity: 'critical', message: 'Price comes only from a Switchboard feed, which has shut down.' });
    return { score: score(checks), checks, providers: ['SwitchboardOnDemand'], priceAgeSeconds: null };
  }
  if (!reserve.feeds.pyth) {
    checks.push({ code: 'UNREADABLE_ORACLE', severity: 'warning', message: `Oracle setup ${setup} is not analysed yet.` });
    return { score: score(checks), checks, providers: [setup], priceAgeSeconds: null };
  }

  const providers = ['Pyth', ...(MARGINFI_RATE_SOURCES[setup] ? [MARGINFI_RATE_SOURCES[setup]] : [])];
  if (!pyth) {
    checks.push({ code: 'UNREADABLE_ORACLE', severity: 'warning', message: 'The Pyth price account could not be read.' });
    return { score: score(checks), checks, providers, priceAgeSeconds: null };
  }

  const priceAgeSeconds = Math.max(0, now - pyth.publishTime);
  if (priceAgeSeconds > reserve.maxAgePriceSeconds) {
    checks.push({ code: 'STALE', severity: 'critical', message: `Price is ${priceAgeSeconds}s old; the protocol rejects prices older than ${reserve.maxAgePriceSeconds}s.` });
  } else if (priceAgeSeconds > reserve.maxAgePriceSeconds * NEAR_STALE_RATIO) {
    checks.push({ code: 'NEAR_STALE', severity: 'warning', message: `Price is ${priceAgeSeconds}s old, close to the ${reserve.maxAgePriceSeconds}s limit.` });
  }
  if (pyth.price > 0 && pyth.confidence / pyth.price > WIDE_CONFIDENCE_RATIO) {
    checks.push({
      code: 'WIDE_CONFIDENCE',
      severity: 'warning',
      message: `Pyth is unsure of this price: its confidence interval is ±${percent(pyth.confidence / pyth.price)} of it.`,
    });
  }
  checks.push({ code: 'NO_FALLBACK', severity: 'warning', message: 'Price has no fallback for Pyth: marginfi reads a single feed, so if it stops, the price stops.' });

  return { score: score(checks), checks, providers, priceAgeSeconds };
}

/** Jupiter Lend oracle sources that are not a market price: exchange rates and pool pegs. */
const JUPITER_NON_MARKET_SOURCES = new Set([
  'StakePool', 'MsolPool', 'SinglePool', 'JupLend', 'PstPool', 'InfPool', 'DexSmartColPegOracle', 'DexSmartDebtPegOracle',
]);

/** Jupiter Lend rejects older prices for liquidations too; see USER_ACTION_MAX_AGE_SECONDS for user actions. */
const JUPITER_LIQUIDATION_MAX_AGE_SECONDS = 7200;

/**
 * Checks a Jupiter Lend vault. Its oracle multiplies or divides every source in turn, so each
 * market-price source is required; `sourceTimes` holds the last update of each readable source.
 */
function evaluateJupiterLend(reserve: MarketOracleConfig, sourceTimes: Map<string, number>, now: number): HealthResult {
  const sources = reserve.oracle?.sources ?? [];
  const checks: Check[] = [];
  if (!sources.length) {
    checks.push({ code: 'NO_ORACLE', severity: 'critical', message: 'The vault\'s oracle has no price source.' });
    return { score: score(checks), checks, providers: [], priceAgeSeconds: null };
  }

  const providers = [...new Set(sources.map((s) => (s.type.startsWith('DexSmart') ? 'Dex peg' : s.type)))];
  const market = sources.filter((s) => !JUPITER_NON_MARKET_SOURCES.has(s.type));
  const unreadable = market.filter((s) => !sourceTimes.has(s.account));
  const ages = market.flatMap((s) => (sourceTimes.has(s.account) ? [Math.max(0, now - sourceTimes.get(s.account)!)] : []));
  const priceAgeSeconds = ages.length ? Math.max(...ages) : null;
  const limit = reserve.maxAgePriceSeconds;

  if (priceAgeSeconds !== null) {
    if (priceAgeSeconds > JUPITER_LIQUIDATION_MAX_AGE_SECONDS) {
      checks.push({ code: 'STALE', severity: 'critical', message: `Price is ${priceAgeSeconds}s old: users and even liquidations are rejected (limits ${limit}s and ${JUPITER_LIQUIDATION_MAX_AGE_SECONDS}s).` });
    } else if (priceAgeSeconds > limit) {
      checks.push({ code: 'STALE', severity: 'critical', message: `Price is ${priceAgeSeconds}s old; users cannot supply, borrow, repay or withdraw past ${limit}s.` });
    } else if (priceAgeSeconds > limit * NEAR_STALE_RATIO) {
      checks.push({ code: 'NEAR_STALE', severity: 'warning', message: `Price is ${priceAgeSeconds}s old, close to the ${limit}s limit.` });
    }
  }
  if (unreadable.length) {
    checks.push({ code: 'UNREADABLE_ORACLE', severity: 'warning', message: `Could not read the ${[...new Set(unreadable.map((s) => s.type))].join(', ')} source.` });
  }
  if (market.length) {
    checks.push({
      code: 'NO_FALLBACK',
      severity: 'warning',
      message: `Price has no fallback for ${[...new Set(market.map((s) => s.type))].join(', ')}: every source is required, so if one stops, the price stops.`,
    });
  }

  return { score: score(checks), checks, providers, priceAgeSeconds };
}

export interface OracleData {
  scope?: ScopeFeed;
  pyth?: PythPrice;
  /** Jupiter Lend: last update time of each oracle source account that could be read. */
  sourceTimes?: Map<string, number>;
  /** An independent market price of the reserve's token, to check the oracle's price against. */
  market?: MarketPrice;
}

export function evaluate(reserve: MarketOracleConfig, oracles: OracleData, now: number): HealthResult {
  const result =
    reserve.protocol === 'marginfi'
      ? evaluateMarginfi(reserve, oracles.pyth, now)
      : reserve.protocol === 'jupiter-lend'
        ? evaluateJupiterLend(reserve, oracles.sourceTimes ?? new Map(), now)
        : evaluateKamino(reserve, oracles.scope, now);
  const closed = marketClosedCheck(reserve, result, now);
  const deviation = priceDeviationCheck(reserve, oracles, result);
  const windingDown: Check | null = reserve.windingDown
    ? {
        code: 'WINDING_DOWN',
        severity: 'info',
        message: 'Being wound down: no new deposits or borrows, and deposits count for no collateral, so its price backs no borrowing.',
      }
    : null;
  const extra = [closed, deviation, windingDown].filter((c): c is Check => !!c);
  if (!extra.length) return result;
  const checks = [...result.checks, ...extra];
  return { ...result, checks, score: score(checks) };
}

/** Pyth considers a price uncertain past this share of it; its usual interval is far below 0.1%. */
const WIDE_CONFIDENCE_RATIO = 0.02;
/** Gaps from the market price reported as a warning, and as critical (above the market only). */
const DEVIATION_WARNING = 0.03;
const DEVIATION_CRITICAL = 0.1;
/**
 * Far above the market, even a thin market's price is evidence enough: pushing a thin market up only
 * shrinks the gap, so it cannot be used to raise a false alarm. This catches dead tokens left with a
 * fixed price, the case that has caused bad debt elsewhere.
 */
const DEVIATION_THIN_MARKET_ABOVE = 0.5;
/**
 * Below this, a market is too easy to dump: a few hundred dollars could push its price down and make
 * an honest oracle look far above it. Dead tokens still trade on pools this deep, the illiquid LP
 * tokens that caused false alarms at $1K do not.
 */
const THIN_MARKET_MIN_LIQUIDITY_USD = 25_000;
/** Below this, nothing depends on the price enough to be worth a check (e.g. reserves wound down). */
const DEVIATION_MIN_SUPPLY_USD = 1_000;

/**
 * Whether PRICE_DEVIATION is computed. It names protocols' reserves one by one, so run.ts turns it off
 * unless PRICE_DEVIATION_CHECK=on, until those findings have been shared with the protocols privately.
 * On by default here so the tests exercise it.
 */
let priceDeviationEnabled = true;
export function setPriceDeviationCheck(enabled: boolean): void {
  priceDeviationEnabled = enabled;
}

const percent = (ratio: number) => `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`;
/** "$107.82", "$0.302", "$0.0000000288": three significant digits under $1, never in e-notation. */
const usdPrice = (value: number) =>
  `$${value >= 1 ? value.toFixed(2) : value.toLocaleString('en', { maximumSignificantDigits: 3, maximumFractionDigits: 20 })}`;
/** "8.8% above" for gaps under 100%, then "2.4× the" and "3,474× the", which read better than 347,300%. */
const gapText = (price: number, market: number) => {
  const times = price / market;
  if (times < 2) return `${percent(Math.abs(price - market) / market)} ${price > market ? 'above' : 'below'} the`;
  return `${times < 10 ? times.toFixed(1) : Math.round(times).toLocaleString('en')}× the`;
};

/**
 * The price the protocol would use for this reserve now, when it can be worked out from the oracle
 * accounts alone: a Kamino Scope chain multiplies its entries, and a plain or fixed marginfi bank
 * uses its Pyth feed or its fixed price. Setups that multiply in an exchange rate, and Jupiter Lend
 * vaults (whose oracle prices collateral in the debt token), are left out.
 */
export function oraclePrice(reserve: MarketOracleConfig, oracles: OracleData): number | null {
  if (reserve.protocol === 'kamino' && oracles.scope && reserve.scopeChain.length) {
    const entries = reserve.scopeChain.map((i) => oracles.scope!.entries.get(i));
    return entries.every((e) => e) ? entries.reduce((price, e) => price * e!.price, 1) : null;
  }
  if (reserve.protocol === 'marginfi') {
    if (reserve.fixedPrice !== undefined) return reserve.fixedPrice;
    if (reserve.oracleSetup && MARGINFI_PLAIN_PYTH.has(reserve.oracleSetup) && oracles.pyth) return oracles.pyth.price;
  }
  return null;
}

/** marginfi setups whose price is the Pyth price itself; every other one multiplies in a rate or a discount. */
const MARGINFI_PLAIN_PYTH = new Set(['PythLegacy', 'PythPushOracle']);

/**
 * Compares the oracle's price with a liquid market price. Staleness says a price is late; this says
 * it is wrong, which matters most for fixed prices: a fixed price is never stale, but it can be blind.
 *
 * An oracle above the market overvalues collateral, which is how depegged tokens priced at $1 have
 * caused bad debt: critical when far off, and checked even against a thin market. Below the market
 * can liquidate borrowers early (a warning); a fixed price below it is most likely a deliberate,
 * conservative haircut on a bank being wound down (info).
 */
function priceDeviationCheck(reserve: MarketOracleConfig, oracles: OracleData, result: HealthResult): Check | null {
  const price = oraclePrice(reserve, oracles);
  const quote = oracles.market;
  if (!priceDeviationEnabled || !quote || price === null || !(price > 0) || reserve.totalSupplyUsd < DEVIATION_MIN_SUPPLY_USD) return null;

  const gap = (price - quote.usdPrice) / quote.usdPrice;
  const liquid = !!reference(quote);
  const thinButFarAbove = gap >= DEVIATION_THIN_MARKET_ABOVE && quote.liquidity >= THIN_MARKET_MIN_LIQUIDITY_USD;
  if (Math.abs(gap) < DEVIATION_WARNING || !(liquid || thinButFarAbove)) return null;

  const fixed = result.checks.some((c) => c.code === 'FIXED_PRICE');
  const what = `${fixed ? 'The fixed price' : 'The oracle price'} ${usdPrice(price)} is ${gapText(price, quote.usdPrice)} market price`;
  const where = `${usdPrice(quote.usdPrice)} on Jupiter${liquid ? '' : ', a thin market'}`;
  // Deposits that count for no collateral cannot be borrowed against, whatever their price says.
  if (reserve.windingDown) {
    return { code: 'PRICE_DEVIATION', severity: 'info', message: `${what} (${where}), but the bank is being wound down and counts it for no collateral: only the displayed value is off.` };
  }
  if (gap > 0) {
    return { code: 'PRICE_DEVIATION', severity: gap >= DEVIATION_CRITICAL ? 'critical' : 'warning', message: `${what} (${where}): collateral is overvalued.` };
  }
  return fixed
    ? { code: 'PRICE_DEVIATION', severity: 'info', message: `${what} (${where}): probably a deliberate haircut, but it can liquidate borrowers early.` }
    : { code: 'PRICE_DEVIATION', severity: 'warning', message: `${what} (${where}): borrowers can be liquidated early.` };
}

/**
 * Feeds that follow extended hours keep publishing until 20:00 New York time, four hours after the
 * regular close; a price that stopped later than that did not stop because trading ended.
 */
const AFTER_HOURS_SECONDS = 4 * 3600;

/** Warned once per process, so a missing calendar year shows in the logs without flooding them. */
let calendarWarned = false;

const CLOSED_FOR: Record<ClosedReason, string> = { weekend: 'for the weekend', holiday: 'for a holiday', overnight: 'overnight' };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. "Fri 25 Sep 20:00 UTC"; built by hand because locale data varies between Node builds. */
const utcLabel = (d: Date) =>
  `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)} UTC`;

/**
 * Explains a stale tokenized stock whose feed stopped because the US market closed: the protocol still
 * rejects the price, but the oracle is following the market rather than failing. Only a price that
 * was still fresh at the close (so not already stale while trading) and stopped by the end of the
 * after-hours session is explained away.
 */
function marketClosedCheck(reserve: MarketOracleConfig, result: HealthResult, now: number): Check | null {
  if (!US_STOCK_MINTS.has(reserve.mint) || result.priceAgeSeconds === null) return null;
  if (!result.checks.some((c) => c.code === 'STALE')) return null;

  let market: ReturnType<typeof usStockSession>;
  try {
    market = usStockSession(new Date(now * 1000));
  } catch (e) {
    if (!calendarWarned) console.warn(`MARKET_CLOSED is disabled: ${(e as Error).message}`);
    calendarWarned = true;
    return null;
  }
  if (market.open) return null;

  const lastPrice = now - result.priceAgeSeconds;
  const close = market.lastClose.getTime() / 1000;
  if (lastPrice < close - reserve.maxAgePriceSeconds || lastPrice > close + AFTER_HOURS_SECONDS) return null;
  const stopped = lastPrice <= close ? `at the ${utcLabel(market.lastClose)} close` : `at ${utcLabel(new Date(lastPrice * 1000))}, after the close`;
  return {
    code: 'MARKET_CLOSED',
    severity: 'info',
    message:
      `The US stock market is closed ${CLOSED_FOR[market.reason]}: the price stopped ${stopped} ` +
      `and should resume at the ${utcLabel(market.nextOpen)} open. Until then the protocol rejects it.`,
  };
}

function evaluateKamino(reserve: MarketOracleConfig, scopeFeed: ScopeFeed | undefined, now: number): HealthResult {
  if (reserve.feeds.scope) {
    if (!scopeFeed) {
      const checks: Check[] = [{ code: 'UNREADABLE_ORACLE', severity: 'warning', message: 'The Scope price account could not be read.' }];
      return { score: score(checks), checks, providers: [], priceAgeSeconds: null };
    }
    return evaluateScope(reserve, scopeFeed, now);
  }
  return evaluateDirect(reserve);
}
