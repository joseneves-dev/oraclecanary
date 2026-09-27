import { Connection, PublicKey } from '@solana/web3.js';
// Import only the generated account decoder: the SDK's main entry pulls in
// transaction helpers whose peer dependencies conflict with each other.
import { Reserve } from '@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve.js';
import { PROGRAM_ID } from '@kamino-finance/klend-sdk/dist/@codegen/klend/programId.js';

import type { MarketOracleConfig } from '../types.js';

const KLEND_PROGRAM = new PublicKey(PROGRAM_ID);
const UNSET = PublicKey.default.toBase58(); // 11111111111111111111111111111111

// ReserveStatus enum in klend: 0 = Active, 1 = Obsolete, 2 = Hidden.
const RESERVE_STATUS: Record<number, MarketOracleConfig['status']> = { 0: 'active', 1: 'obsolete', 2: 'hidden' };

// Kamino fills every u16 slot of an unused Scope chain with this value.
const SCOPE_CHAIN_UNUSED = 65535;

function decodeName(bytes: number[]): string {
  return Buffer.from(bytes).toString('utf8').replace(/\0+$/, '').trim();
}

function feed(address: string): string | null {
  return address === UNSET ? null : address;
}

export async function fetchKaminoReserves(connection: Connection): Promise<MarketOracleConfig[]> {
  const accounts = await connection.getProgramAccounts(KLEND_PROGRAM, {
    filters: [{ memcmp: { offset: 0, bytes: Reserve.discriminator.toString('base64'), encoding: 'base64' } }],
  });

  // Older reserves use a shorter account layout that this decoder would misread, so skip them.
  const currentLayoutSize = 8 + (Reserve as unknown as { layout: { span: number } }).layout.span;

  return accounts.filter(({ account }) => account.data.length === currentLayoutSize).map(({ pubkey, account }) => {
    const reserve = Reserve.decode(Buffer.from(account.data));
    const tokenInfo = reserve.config.tokenInfo;
    const scopeChain = tokenInfo.scopeConfiguration.priceChain.filter((i) => i !== SCOPE_CHAIN_UNUSED);

    return {
      protocol: 'kamino',
      market: reserve.lendingMarket.toString(),
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
    };
  });
}
