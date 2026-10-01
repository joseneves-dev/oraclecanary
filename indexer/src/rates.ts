/*
 * Lending rates: what a deposit earns and a loan costs, per reserve, from each protocol's own public
 * source. Kamino and Jupiter Lend publish them through their APIs; marginfi caches them on the bank
 * account the indexer already reads. Rates are context for the oracle facts, never part of a check:
 * a failure here is logged and the last stored rates are kept (see db.ts).
 */

import type { MarketOracleConfig } from './types.js';

/** A reserve's rates as its protocol reports them. Fractions: 0.05 is 5%. */
export interface LendingRate {
  /** What depositors earn per year, compounded, excluding token incentives. */
  supplyApy: number;
  /** What borrowers pay per year, compounded. */
  borrowApy: number;
  /**
   * Share of a deposit's value that can be borrowed against it (0 to 1); 0 means it is not
   * accepted as collateral. Null when the source does not say.
   */
  maxLtv: number | null;
  /** Where the rate comes from, e.g. "kamino-api". */
  source: RateSource;
  /** When the source last computed the rate (or, for an API, when it was read). */
  at: Date;
}

export type RateSource = 'kamino-api' | 'jupiter-api' | 'marginfi-onchain';

const API_TIMEOUT_MS = 8_000;
/** Rates move slowly; one read every few minutes keeps the load on each API small. Unset, empty or 0: 300. */
const REFRESH_SECONDS = Number(process.env.RATES_REFRESH_SECONDS) || 300;

const number = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

// ---- marginfi: the bank's own cache ----

/** BankCache rates are u32 fractions of 1000%: u32::MAX is 10 (1000%). */
const MARGINFI_RATE_MAX = 0xffff_ffff;
const MARGINFI_RATE_SCALE = 10;
/** marginfi's SDK and app turn its APRs into APYs with hourly compounding. */
const HOURS_PER_YEAR = 365 * 24;

/** A yearly rate compounded `periods` times a year. */
export function aprToApy(apr: number, periods = HOURS_PER_YEAR): number {
  return (1 + apr / periods) ** periods - 1;
}

/**
 * The rates a marginfi bank cached at its last update: `lending_rate` (what depositors earn) and
 * `borrowing_rate` (what borrowers pay, fees included), both APRs. Null when the bank has never
 * cached them: no update yet, or both rates still 0 (a live bank always charges borrowers something),
 * so an unwritten cache is not stored as a 0% reading.
 */
export function marginfiRate(
  cache: { lending_rate: number; borrowing_rate: number },
  lastUpdate: number,
  assetWeightInit: number,
): LendingRate | null {
  if (!lastUpdate || (!cache.lending_rate && !cache.borrowing_rate)) return null;
  const apr = (raw: number) => (raw / MARGINFI_RATE_MAX) * MARGINFI_RATE_SCALE;
  return {
    supplyApy: aprToApy(apr(cache.lending_rate)),
    borrowApy: aprToApy(apr(cache.borrowing_rate)),
    maxLtv: Number.isFinite(assetWeightInit) ? Math.max(0, Math.min(1, assetWeightInit)) : null,
    source: 'marginfi-onchain',
    at: new Date(lastUpdate * 1000),
  };
}

// ---- Kamino: the reserve metrics API, one call per listed market ----

const KAMINO_METRICS_API = (market: string) => `https://api.kamino.finance/kamino-market/${market}/reserves/metrics`;
/** Calls in flight at once; Kamino lists a few dozen markets. */
const KAMINO_CONCURRENCY = 6;

/** Reads one market's metrics: rates by reserve address. Entries without numeric rates are skipped. */
export function parseKaminoMetrics(body: unknown, at: Date): Map<string, LendingRate> {
  const rates = new Map<string, LendingRate>();
  if (!Array.isArray(body)) throw new Error('Kamino metrics are not a list');
  for (const entry of body as Record<string, unknown>[]) {
    const supplyApy = number(entry?.supplyApy);
    const borrowApy = number(entry?.borrowApy);
    if (typeof entry?.reserve !== 'string' || supplyApy === null || borrowApy === null) continue;
    rates.set(entry.reserve, { supplyApy, borrowApy, maxLtv: number(entry.maxLtv), source: 'kamino-api', at });
  }
  return rates;
}

interface MarketState {
  rates: Map<string, LendingRate>;
  readAt: number;
  /** Failed calls in a row; each one doubles the wait before the next try. */
  failures: number;
  retryAt: number;
  /** A call still running, possibly started by an earlier run whose time budget ran out. */
  pending?: Promise<void>;
}
const kaminoCache = new Map<string, MarketState>();

/** After a failure a market is retried after 1 minute, then 2, 4... up to 30. */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;
/** How long a health run waits for rates; calls still running finish in the background for the next run. */
export const RATES_BUDGET_MS = 10_000;

async function readMarket(market: string, state: MarketState, now: number): Promise<void> {
  try {
    state.rates = parseKaminoMetrics(await getJson(KAMINO_METRICS_API(market)), new Date(now));
    state.readAt = now;
    state.failures = 0;
    state.retryAt = 0;
  } catch (e) {
    state.failures++;
    state.retryAt = now + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (state.failures - 1));
    console.warn(`Kamino rates of market ${market} not read (${state.failures} in a row, last rates kept): ${(e as Error).message}`);
  }
}

/**
 * Starts a call for each market whose rates are older than REFRESH_SECONDS, at most
 * KAMINO_CONCURRENCY at once, skipping markets with a call already running or backing off after a
 * failure. Resolves once every started call has finished. A failed market keeps its last rates.
 */
export function refreshKaminoRates(markets: string[], now = Date.now()): Promise<void> {
  const queue: [string, MarketState][] = [];
  for (const market of markets) {
    const state: MarketState = kaminoCache.get(market) ?? { rates: new Map(), readAt: 0, failures: 0, retryAt: 0 };
    kaminoCache.set(market, state);
    if (!state.pending && now >= state.retryAt && now - state.readAt >= REFRESH_SECONDS * 1000) {
      // Marked before any call starts, so a run that overlaps this one does not queue it again.
      state.pending = Promise.resolve();
      queue.push([market, state]);
    }
  }
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [market, state] = next;
      state.pending = readMarket(market, state, now);
      await state.pending;
      state.pending = undefined;
    }
  };
  return Promise.all(Array.from({ length: Math.min(KAMINO_CONCURRENCY, queue.length) }, worker)).then(() => undefined);
}

/** The last rates read for the reserves of the given markets. */
export function cachedKaminoRates(markets: string[]): Map<string, LendingRate> {
  const all = new Map<string, LendingRate>();
  for (const market of markets) for (const [reserve, rate] of kaminoCache.get(market)?.rates ?? []) all.set(reserve, rate);
  return all;
}

/**
 * Refreshes the rates of the given markets, waiting at most `budgetMs`, then returns what is known.
 * Never throws and never holds a health run longer than the budget: calls still running then go on
 * in the background and serve the next run.
 */
export async function kaminoRatesWithin(markets: string[], budgetMs = RATES_BUDGET_MS, now = Date.now()): Promise<Map<string, LendingRate>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      refreshKaminoRates(markets, now),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } catch (e) {
    console.warn(`Kamino rates not updated: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  return cachedKaminoRates(markets);
}

/** Markets listed in Kamino's app, the only ones whose rates are read. */
export const listedMarkets = (reserves: MarketOracleConfig[]) => [...new Set(reserves.filter((r) => r.marketName).map((r) => r.market))];

/** Reserves with their rates attached where known; the others stay as they are (their stored rates are kept). */
export function attachRates(reserves: MarketOracleConfig[], rates: Map<string, LendingRate>): MarketOracleConfig[] {
  return reserves.map((r) => (rates.has(r.reserve) ? { ...r, rate: rates.get(r.reserve) } : r));
}

// ---- Jupiter Lend: Earn pools ----

/**
 * A Jupiter Lend Earn pool. Its deposits are what Jupiter Lend's vaults lend to borrowers of the
 * same token; it has no oracle of its own, so it is not a reserve.
 */
export interface EarnPool {
  /** The pool's share token (fToken) address. */
  address: string;
  /** Deposit token. */
  mint: string;
  asset: string;
  supplyApy: number;
  /** Token incentives on top of supplyApy, reported apart. */
  rewardsApy: number;
  totalSupplyUsd: number;
  source: RateSource;
  at: Date;
}

const JUPITER_EARN_API = 'https://lite-api.jup.ag/lend/v1/earn/tokens';
/** Jupiter reports rates in basis points. */
const BPS = 10_000;

export function parseJupiterEarn(body: unknown, at: Date): EarnPool[] {
  if (!Array.isArray(body)) throw new Error('Jupiter Earn tokens are not a list');
  const pools: EarnPool[] = [];
  for (const t of body as Record<string, any>[]) {
    const supplyRate = number(t?.supplyRate);
    const mint = t?.assetAddress ?? t?.asset?.address;
    const decimals = number(t?.asset?.decimals ?? t?.decimals);
    const totalAssets = number(t?.totalAssets);
    const price = number(t?.asset?.price);
    // A pool missing any of these would be stored with a wrong rate or a $0 value: skipped instead.
    if (typeof t?.address !== 'string' || typeof mint !== 'string' || supplyRate === null || decimals === null || totalAssets === null || price === null) {
      console.warn(`Jupiter Earn pool ${String(t?.address ?? '?')} skipped: missing rate, mint, decimals, total assets or price`);
      continue;
    }
    const assets = totalAssets / 10 ** decimals;
    pools.push({
      address: t.address,
      mint,
      asset: String(t.asset?.uiSymbol ?? t.asset?.symbol ?? ''),
      supplyApy: supplyRate / BPS,
      rewardsApy: (number(t.rewardsRate) ?? 0) / BPS,
      totalSupplyUsd: assets * price,
      source: 'jupiter-api',
      at,
    });
  }
  return pools;
}

let earnCache: { pools: EarnPool[]; readAt: number } | null = null;

/**
 * Jupiter Lend's Earn pools, read again once older than REFRESH_SECONDS. Throws when the call fails
 * (the caller keeps the stored pools); an answer with no usable pool returns the last list read.
 */
export async function fetchJupiterEarn(now = Date.now()): Promise<EarnPool[]> {
  if (earnCache && now - earnCache.readAt < REFRESH_SECONDS * 1000) return earnCache.pools;
  const pools = parseJupiterEarn(await getJson(JUPITER_EARN_API), new Date(now));
  if (pools.length) earnCache = { pools, readAt: now };
  return earnCache?.pools ?? [];
}

/** Clears the in-memory caches; for tests. */
export function resetRateCaches(): void {
  kaminoCache.clear();
  earnCache = null;
}
