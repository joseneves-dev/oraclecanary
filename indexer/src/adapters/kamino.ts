import { Connection, PublicKey } from '@solana/web3.js';
// Import only the generated account decoder: the SDK's main entry pulls in
// transaction helpers whose peer dependencies conflict with each other.
import { Reserve } from '@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve.js';
import { PROGRAM_ID } from '@kamino-finance/klend-sdk/dist/@codegen/klend/programId.js';

import type { MarketOracleConfig } from '../types.js';

const KLEND_PROGRAM = new PublicKey(PROGRAM_ID);
// Kamino leaves unused oracle slots as either the default key or its own "null" sentinel key.
const UNSET = new Set([PublicKey.default.toBase58(), 'nu11111111111111111111111111111111111111111']);

// ReserveStatus enum in klend: 0 = Active, 1 = Obsolete, 2 = Hidden.
const RESERVE_STATUS: Record<number, MarketOracleConfig['status']> = { 0: 'active', 1: 'obsolete', 2: 'hidden' };

// Kamino fills every u16 slot of an unused Scope chain with this value.
const SCOPE_CHAIN_UNUSED = 65535;

// Kamino stores scaled fractions ("Sf" fields) as fixed-point numbers with 60 fractional bits.
const SF_SCALE = 2 ** 60;

function decodeName(bytes: number[]): string {
  return Buffer.from(bytes).toString('utf8').replace(/\0+$/, '').trim();
}

function feed(address: string): string | null {
  return UNSET.has(address) ? null : address;
}

const KAMINO_MARKETS_API = 'https://api.kamino.finance/v2/kamino-market';

/**
 * Markets listed in Kamino's own app, by lending market address. Anyone can create a Kamino market
 * with arbitrary tokens and prices, so values from unlisted markets are not trustworthy.
 */
async function fetchListedMarkets(): Promise<Map<string, string>> {
  const response = await fetch(KAMINO_MARKETS_API);
  if (!response.ok) throw new Error(`Kamino markets API returned ${response.status}`);
  const markets = (await response.json()) as { name: string; lendingMarket: string }[];
  return new Map(markets.map((m) => [m.lendingMarket, m.name]));
}

export async function fetchKaminoReserves(connection: Connection): Promise<MarketOracleConfig[]> {
  const listedMarkets = await fetchListedMarkets();
  const accounts = await connection.getProgramAccounts(KLEND_PROGRAM, {
    filters: [{ memcmp: { offset: 0, bytes: Reserve.discriminator.toString('base64'), encoding: 'base64' } }],
  });

  // Older reserves use a shorter account layout that this decoder would misread, so skip them.
  const currentLayoutSize = 8 + (Reserve as unknown as { layout: { span: number } }).layout.span;

  return accounts.filter(({ account }) => account.data.length === currentLayoutSize).map(({ pubkey, account }) => {
    const reserve = Reserve.decode(Buffer.from(account.data));
    const tokenInfo = reserve.config.tokenInfo;
    const scopeChain = tokenInfo.scopeConfiguration.priceChain.filter((i) => i !== SCOPE_CHAIN_UNUSED);

    const decimals = 10 ** reserve.liquidity.mintDecimals.toNumber();
    const available = Number(reserve.liquidity.totalAvailableAmount.toString()) / decimals;
    const borrowed = Number(reserve.liquidity.borrowedAmountSf.toString()) / SF_SCALE / decimals;
    const price = Number(reserve.liquidity.marketPriceSf.toString()) / SF_SCALE;

    return {
      protocol: 'kamino',
      market: reserve.lendingMarket.toString(),
      marketName: listedMarkets.get(reserve.lendingMarket.toString()) ?? null,
      reserve: pubkey.toBase58(),
      asset: decodeName(tokenInfo.name),
      mint: reserve.liquidity.mintPubkey.toString(),
      status: RESERVE_STATUS[reserve.config.status] ?? 'unknown',
      maxAgePriceSeconds: tokenInfo.maxAgePriceSeconds.toNumber(),
      feeds: {
        pyth: feed(tokenInfo.pythConfiguration.price.toString()),
        switchboard: feed(tokenInfo.switchboardConfiguration.priceAggregator.toString()),
        switchboardTwap: feed(tokenInfo.switchboardConfiguration.twapAggregator.toString()),
        scope: feed(tokenInfo.scopeConfiguration.priceFeed.toString()),
      },
      scopeChain,
      lastPriceUpdateTs: reserve.liquidity.marketPriceLastUpdatedTs.toNumber(),
      totalSupplyUsd: (available + borrowed) * price,
    };
  });
}
