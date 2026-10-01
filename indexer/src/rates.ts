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

const API_TIMEOUT_MS = 15_000;
/** Rates move slowly; one read every few minutes keeps the load on each API small. */
const REFRESH_SECONDS = Number(process.env.RATES_REFRESH_SECONDS ?? 300);

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
 * cached them.
 */
export function marginfiRate(
  cache: { lending_rate: number; borrowing_rate: number },
  lastUpdate: number,
  assetWeightInit: number,
): LendingRate | null {
  if (!lastUpdate) return null;
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

const kaminoCache = new Map<string, { rates: Map<string, LendingRate>; readAt: number }>();

/**
 * Rates of the reserves in the given markets, read again once older than REFRESH_SECONDS. A market
 * whose call fails keeps its last rates; one that never answered has none.
 */
export async function fetchKaminoRates(markets: string[], now = Date.now()): Promise<Map<string, LendingRate>> {
  const due = markets.filter((m) => now - (kaminoCache.get(m)?.readAt ?? 0) >= REFRESH_SECONDS * 1000);
  let failed = 0;
  for (let i = 0; i < due.length; i += KAMINO_CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + KAMINO_CONCURRENCY).map(async (market) => {
        try {
          kaminoCache.set(market, { rates: parseKaminoMetrics(await getJson(KAMINO_METRICS_API(market)), new Date(now)), readAt: now });
        } catch {
          failed++;
        }
      }),
    );
  }
  if (failed) console.warn(`Kamino rates: ${failed} of ${due.length} markets could not be read; their last rates are kept`);
  const all = new Map<string, LendingRate>();
  for (const market of markets) for (const [reserve, rate] of kaminoCache.get(market)?.rates ?? []) all.set(reserve, rate);
  return all;
}

/**
 * Attaches rates to the reserves of Kamino's listed markets. Never throws: without rates the
 * reserves are returned as they are, and the stored rates stay.
 */
export async function withKaminoRates(reserves: MarketOracleConfig[]): Promise<MarketOracleConfig[]> {
  try {
    const markets = [...new Set(reserves.filter((r) => r.marketName).map((r) => r.market))];
    const rates = await fetchKaminoRates(markets);
    return reserves.map((r) => (rates.has(r.reserve) ? { ...r, rate: rates.get(r.reserve) } : r));
  } catch (e) {
    console.warn(`Kamino rates not updated: ${(e as Error).message}`);
    return reserves;
  }
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
    if (typeof t?.address !== 'string' || typeof mint !== 'string' || supplyRate === null) continue;
    const decimals = number(t.asset?.decimals ?? t.decimals) ?? 0;
    const assets = (number(t.totalAssets) ?? 0) / 10 ** decimals;
    pools.push({
      address: t.address,
      mint,
      asset: String(t.asset?.uiSymbol ?? t.asset?.symbol ?? ''),
      supplyApy: supplyRate / BPS,
      rewardsApy: (number(t.rewardsRate) ?? 0) / BPS,
      totalSupplyUsd: assets * (number(t.asset?.price) ?? 0),
      source: 'jupiter-api',
      at,
    });
  }
  return pools;
}

let earnCache: { pools: EarnPool[]; readAt: number } | null = null;

/** Jupiter Lend's Earn pools, read again once older than REFRESH_SECONDS; the last list on failure. */
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
