import type { MarketOracleConfig } from '../types.js';

/**
 * Independent market prices from Jupiter's price API, used to check that the price an oracle gives a
 * reserve is right, and to value reserves in unlisted markets, whose own price anyone can set.
 */

/** A token's market price and the liquidity behind it, both in USD. */
export interface MarketPrice {
  usdPrice: number;
  liquidity: number;
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
        if (usdPrice) prices.set(mint, { usdPrice, liquidity: Number.isFinite(p!.liquidity) ? p!.liquidity! : 0 });
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

/** A market price liquid enough to judge an oracle by, or undefined. */
export function reference(price: MarketPrice | undefined): MarketPrice | undefined {
  return price && price.liquidity >= MIN_REFERENCE_LIQUIDITY_USD ? price : undefined;
}
