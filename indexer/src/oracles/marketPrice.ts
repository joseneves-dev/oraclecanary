import type { MarketOracleConfig } from '../types.js';

/**
 * Independent market prices from Jupiter's price API, used to check that the price an oracle gives a
 * reserve is right, and to value reserves in unlisted markets, whose own price anyone can set.
 */

/** A token's market price and the liquidity behind it, both in USD. */
export interface MarketPrice {
  usdPrice: number;
  liquidity: number;
  /** The token's decimals, needed to size a swap quote. */
  decimals?: number;
  /** Change of the price over 24 hours, in percent. */
  priceChange24h?: number;
  /** What selling the token on Jupiter really gets, quoted only where the price suggests an oracle is off. */
  swap?: SwapPrice;
}

/** The USD price per token that a swap of `sizeUsd` (at the oracle price) gets on Jupiter. */
export interface SwapPrice {
  usdPrice: number;
  sizeUsd: number;
}

const PRICE_API = 'https://lite-api.jup.ag/price/v3?ids=';
const IDS_PER_REQUEST = 50;
const API_TIMEOUT_MS = 15_000;

/**
 * Below this much liquidity a market price is too easy to move to judge an oracle by. Tokens without
 * such a price (no DEX market, e.g. most tokenized stocks) are simply not compared.
 */
export const MIN_REFERENCE_LIQUIDITY_USD = 250_000;

/** Market prices by mint, and the mints whose price is unknown because the request failed. */
export interface MarketPrices {
  prices: Map<string, MarketPrice>;
  /** Mints of batches Jupiter did not answer: their price is unknown, not absent. */
  failed: Set<string>;
}

interface ApiPrice {
  usdPrice?: number;
  liquidity?: number;
  decimals?: number;
  priceChange24h?: number;
  /** Token-2022 "scaled UI amount" tokens (xStocks...): `usdPrice` is per displayed token. */
  scaledUiConfig?: { usdPricePrescaled?: number };
}

/**
 * The price of one raw token, the unit oracles and on-chain amounts use. For tokens with a UI
 * multiplier, `usdPrice` is per displayed token and would be off by the multiplier (8% for STRCx).
 */
export function rawUsdPrice(p: ApiPrice): number | null {
  const price = p.scaledUiConfig ? p.scaledUiConfig.usdPricePrescaled : p.usdPrice;
  return Number.isFinite(price) && price! > 0 ? price! : null;
}

/**
 * Market prices of the given mints. Mints without a price are left out; a failed request leaves out
 * its batch (listed in `failed`) rather than failing the run, since what uses these prices is optional.
 */
export async function fetchMarketPrices(mints: string[]): Promise<MarketPrices> {
  const unique = [...new Set(mints)];
  const prices = new Map<string, MarketPrice>();
  const failed = new Set<string>();
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const batch = unique.slice(i, i + IDS_PER_REQUEST);
    try {
      const response = await fetch(PRICE_API + batch.join(','), { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as Record<string, ApiPrice | null>;
      for (const [mint, p] of Object.entries(body)) {
        const usdPrice = p ? rawUsdPrice(p) : null;
        if (!usdPrice) continue;
        const price: MarketPrice = { usdPrice, liquidity: Number.isFinite(p!.liquidity) ? p!.liquidity! : 0 };
        if (Number.isInteger(p!.decimals)) price.decimals = p!.decimals;
        if (Number.isFinite(p!.priceChange24h)) price.priceChange24h = p!.priceChange24h;
        prices.set(mint, price);
      }
    } catch (e) {
      batch.forEach((mint) => failed.add(mint));
      console.warn(`Jupiter price API: ${(e as Error).message}; skipping ${batch.length} mints`);
    }
  }
  return { prices, failed };
}

/**
 * Anyone can create an unlisted market and give its tokens any price, so a reserve there can claim
 * trillions of dollars. Its supply is valued at the market price instead, or 0 when the token has
 * none. When the price is unknown because Jupiter did not answer, the last stored value is kept
 * (`previous`), so an outage does not make reserves worth nothing for a run.
 */
export function valueUnlisted(reserve: MarketOracleConfig, market: MarketPrices, previous: Map<string, number>): MarketOracleConfig {
  if (reserve.marketName || reserve.supplyTokens === undefined) return reserve;
  const price = market.prices.get(reserve.mint)?.usdPrice;
  if (price === undefined && market.failed.has(reserve.mint)) {
    return { ...reserve, totalSupplyUsd: previous.get(reserve.reserve) ?? 0 };
  }
  return { ...reserve, totalSupplyUsd: reserve.supplyTokens * (price ?? 0) };
}

/**
 * Past this 24-hour move the price API is not a price to judge an oracle by: a few trades in a thin
 * market can make it (dfdvSOL showed +77% after two buys, $233 while a swap got $133).
 */
export const MAX_PRICE_CHANGE_24H_PERCENT = 50;

/** Whether a market price is steady enough to compare an oracle with at all. */
export function reliable(price: MarketPrice): boolean {
  return !(Math.abs(price.priceChange24h ?? 0) > MAX_PRICE_CHANGE_24H_PERCENT);
}

/**
 * A market price liquid enough to judge an oracle by, or undefined. Jupiter's `liquidity` is not
 * always pool depth (for dfdvSOL it was the token's market value), so this only picks the reserves to
 * check with a swap quote (see swapPrices), and never flags one by itself.
 */
export function reference(price: MarketPrice | undefined): MarketPrice | undefined {
  return price && price.liquidity >= MIN_REFERENCE_LIQUIDITY_USD && reliable(price) ? price : undefined;
}

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const QUOTE_API = 'https://lite-api.jup.ag/swap/v1/quote';
/** What a swap that confirms a price is worth, at the oracle price: enough to cross a real market. */
export const SWAP_SIZE_USD = 10_000;
/**
 * Above this price impact (as Jupiter reports it), the swap is too thin to judge an oracle by. Jupiter
 * can also count a gap from its own price as impact (0.43 for dfdvSOL even for one token), so such a
 * quote is set aside too: a missed alert rather than a false one.
 */
const MAX_PRICE_IMPACT = 0.02;
const QUOTE_TIMEOUT_MS = 5_000;
/** All the quotes of one run together wait at most this long, so they cannot hold up the checks. */
export const QUOTE_BUDGET_MS = 10_000;
const QUOTE_CONCURRENCY = 4;

/** The swap to quote for one reserve, sold at its oracle price. */
export interface SwapRequest {
  mint: string;
  decimals: number;
  oraclePrice: number;
  sizeUsd: number;
}

/** Swap prices already quoted in a run (null: no usable quote), and the time left to quote others. */
export interface SwapQuotes {
  cache: Map<string, SwapPrice | null>;
  remainingMs: number;
}

export const newSwapQuotes = (budgetMs = QUOTE_BUDGET_MS): SwapQuotes => ({ cache: new Map(), remainingMs: budgetMs });

/** The swap size for a reserve: $10K, or a tenth of a smaller reserve (at least $100). */
export const swapSizeUsd = (totalSupplyUsd: number) => Math.min(SWAP_SIZE_USD, Math.max(100, totalSupplyUsd / 10));

type Fetch = typeof fetch;

/** Output amount and price impact (a fraction) of a Jupiter quote, or null when there is none. */
async function quote(fetchImpl: Fetch, input: string, output: string, amount: bigint, timeoutMs: number): Promise<{ out: number; impact: number } | null> {
  const url = `${QUOTE_API}?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=50`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return null;
  const body = (await response.json()) as { outAmount?: string; priceImpactPct?: string };
  const out = Number(body.outAmount);
  const impact = Number(body.priceImpactPct);
  return Number.isFinite(out) && out > 0 && Number.isFinite(impact) ? { out, impact } : null;
}

/**
 * The USD price per token that selling `sizeUsd` of it (at the oracle price) gets: into USDC, or into
 * SOL valued at `solUsd` when USDC has no route (liquid staking tokens). Null when there is no route,
 * the time is up, or the swap moves the price too much.
 */
async function swapPrice(request: SwapRequest, solUsd: number | undefined, deadline: number, fetchImpl: Fetch): Promise<SwapPrice | null> {
  const raw = Math.round((request.sizeUsd / request.oraclePrice) * 10 ** request.decimals);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const sold = raw / 10 ** request.decimals;
  const timeLeft = () => Math.min(QUOTE_TIMEOUT_MS, deadline - Date.now());

  // undefined: no quote, so another output may still have a route.
  const sell = async (output: string, decimals: number, usdPerUnit: number): Promise<SwapPrice | null | undefined> => {
    if (timeLeft() <= 0) return null;
    const q = await quote(fetchImpl, request.mint, output, BigInt(raw), timeLeft()).catch(() => null);
    if (!q) return undefined;
    if (q.impact > MAX_PRICE_IMPACT) return null;
    return { usdPrice: ((q.out / 10 ** decimals) * usdPerUnit) / sold, sizeUsd: request.sizeUsd };
  };
  const usdc = await sell(USDC_MINT, 6, 1);
  if (usdc !== undefined) return usdc;
  if (!solUsd || request.mint === SOL_MINT) return null;
  return (await sell(SOL_MINT, 9, solUsd)) ?? null;
}

/**
 * Swap prices of the requested mints, quoted at most four at a time within the run's time budget and
 * cached per mint for the run. Mints without a usable quote are left out. Never throws.
 */
export async function swapPrices(requests: SwapRequest[], quotes: SwapQuotes, solUsd: number | undefined, fetchImpl: Fetch = fetch): Promise<Map<string, SwapPrice>> {
  const started = Date.now();
  const deadline = started + quotes.remainingMs;
  const pending = requests.filter((r, i) => !quotes.cache.has(r.mint) && requests.findIndex((o) => o.mint === r.mint) === i);
  const worker = async () => {
    for (let r = pending.shift(); r; r = pending.shift()) {
      quotes.cache.set(r.mint, await swapPrice(r, solUsd, deadline, fetchImpl).catch(() => null));
    }
  };
  await Promise.all(Array.from({ length: Math.min(QUOTE_CONCURRENCY, pending.length) }, worker));
  quotes.remainingMs = Math.max(0, quotes.remainingMs - (Date.now() - started));

  const prices = new Map<string, SwapPrice>();
  for (const r of requests) {
    const price = quotes.cache.get(r.mint);
    if (price) prices.set(r.mint, price);
  }
  return prices;
}
