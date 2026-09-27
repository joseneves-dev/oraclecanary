import { createHash } from 'node:crypto';

import { Connection, PublicKey } from '@solana/web3.js';

import type { MarketOracleConfig, OracleSource } from '../types.js';

/*
 * Jupiter Lend vaults and oracles, read with hand-written decoders for the few fields used here.
 * Layouts follow the account definitions of Jupiter's vaults and oracle programs.
 */

export const VAULTS_PROGRAM = 'jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi';
export const ORACLE_PROGRAM = 'jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc';

// Jupiter Lend rejects prices older than this for supply, borrow, repay and withdraw; liquidations
// accept up to 7200 seconds.
export const USER_ACTION_MAX_AGE_SECONDS = 600;
export const LIQUIDATION_MAX_AGE_SECONDS = 7200;

// Exchange prices are stored with 12 decimals.
const EXCHANGE_PRICE_PRECISION = 1e12;
// Vault amounts are kept in 9 decimals whatever the token's own decimals.
const INTERNAL_DECIMALS = 9;

const TOKENS_API = 'https://lite-api.jup.ag/tokens/v2/search?query=';
const TOKENS_PER_REQUEST = 100;
const API_TIMEOUT_MS = 15_000;

const SOURCE_TYPES = [
  'Pyth', 'StakePool', 'MsolPool', 'Redstone', 'Chainlink', 'SinglePool', 'JupLend',
  'ChainlinkDataStreams', 'PstPool', 'DexSmartColPegOracle', 'DexSmartDebtPegOracle', 'InfPool',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Anchor account discriminator: the first 8 bytes of sha256("account:<Name>"). */
const discriminator = (name: string) => createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);

const pubkey = (data: Buffer, offset: number) => new PublicKey(data.subarray(offset, offset + 32)).toBase58();

interface VaultConfig {
  vaultId: number;
  oracle: string;
  supplyToken: string;
  borrowToken: string;
}

/** VaultConfig (packed): vault_id u16 · 7 × u16/i16 settings · borrow_fee u8 · vault_type u8 · oracle · ... */
export function decodeVaultConfig(data: Buffer): VaultConfig {
  return {
    vaultId: data.readUInt16LE(8),
    oracle: pubkey(data, 26),
    supplyToken: pubkey(data, 154),
    borrowToken: pubkey(data, 186),
  };
}

interface VaultState {
  vaultId: number;
  totalSupply: bigint;
  vaultSupplyExchangePrice: bigint;
}

/** VaultState (packed): vault_id u16 · u8 · i32 · u32 · u32 · total_supply u64 @23 · ... · vault_supply_exchange_price u64 @99. */
export function decodeVaultState(data: Buffer): VaultState {
  return {
    vaultId: data.readUInt16LE(8),
    totalSupply: data.readBigUInt64LE(23),
    vaultSupplyExchangePrice: data.readBigUInt64LE(99),
  };
}

// One oracle source: source pubkey · invert bool · multiplier u128 · divisor u128 · source_type u8.
const SOURCE_SIZE = 32 + 1 + 16 + 16 + 1;

function decodeSource(data: Buffer, offset: number): { account: string; type: SourceType } {
  const typeIndex = data[offset + SOURCE_SIZE - 1];
  const type = SOURCE_TYPES[typeIndex];
  if (!type) throw new Error(`Unknown Jupiter Lend oracle source type ${typeIndex}`);
  return { account: pubkey(data, offset), type };
}

/** Oracle: nonce u16 · sources vec (u32 length, then entries) · bump u8. */
export function decodeOracle(data: Buffer): { account: string; type: SourceType }[] {
  const count = data.readUInt32LE(10);
  return Array.from({ length: count }, (_, i) => decodeSource(data, 14 + i * SOURCE_SIZE));
}

/** DexPegOracleConfig: nonce u16 · dex, 2 positions, 2 reserves (5 × 32) · quote_in_token0 bool · conversion_source. */
export function decodeDexPegConversionSource(data: Buffer) {
  return decodeSource(data, 8 + 2 + 5 * 32 + 1);
}

// ChainlinkDataStreamsCache: nonce u16 · feeds vec of 34-byte entries · price u128 · last_update_timestamp_price u64.
const FEED_ENTRY_SIZE = 34;

/** Unix time of the last price the Chainlink Data Streams cache account accepted. */
export function decodeDataStreamsTimestamp(data: Buffer): number {
  const feeds = data.readUInt32LE(10);
  return Number(data.readBigUInt64LE(14 + feeds * FEED_ENTRY_SIZE + 16));
}

/** Sources whose value is a structural rate (stake pools, Jupiter Lend fTokens...) rather than a market price. */
export const RATE_SOURCES = new Set<SourceType>(['StakePool', 'MsolPool', 'SinglePool', 'JupLend', 'PstPool', 'InfPool']);

async function fetchByDiscriminator(connection: Connection, program: string, account: string) {
  return connection.getProgramAccounts(new PublicKey(program), {
    filters: [{ memcmp: { offset: 0, bytes: discriminator(account).toString('base64'), encoding: 'base64' } }],
  });
}

interface TokenInfo {
  symbol: string;
  decimals: number;
  usdPrice: number | null;
}

async function fetchTokens(mints: string[]): Promise<Map<string, TokenInfo>> {
  const tokens = new Map<string, TokenInfo>();
  const unique = [...new Set(mints)];
  for (let i = 0; i < unique.length; i += TOKENS_PER_REQUEST) {
    const response = await fetch(TOKENS_API + unique.slice(i, i + TOKENS_PER_REQUEST).join(','), {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Jupiter tokens API returned ${response.status}`);
    for (const t of (await response.json()) as { id: string; symbol: string; decimals: number; usdPrice?: number }[]) {
      tokens.set(t.id, { symbol: t.symbol, decimals: t.decimals, usdPrice: t.usdPrice ?? null });
    }
  }
  return tokens;
}

export async function fetchJupiterLendVaults(connection: Connection): Promise<MarketOracleConfig[]> {
  const [configs, states, oracles, pegConfigs] = await Promise.all([
    fetchByDiscriminator(connection, VAULTS_PROGRAM, 'VaultConfig'),
    fetchByDiscriminator(connection, VAULTS_PROGRAM, 'VaultState'),
    fetchByDiscriminator(connection, ORACLE_PROGRAM, 'Oracle'),
    fetchByDiscriminator(connection, ORACLE_PROGRAM, 'DexPegOracleConfig'),
  ]);

  const stateById = new Map(states.map((s) => decodeVaultState(Buffer.from(s.account.data))).map((s) => [s.vaultId, s]));
  const sourcesByOracle = new Map(oracles.map((o) => [o.pubkey.toBase58(), decodeOracle(Buffer.from(o.account.data))]));
  const pegConversion = new Map(pegConfigs.map((p) => [p.pubkey.toBase58(), decodeDexPegConversionSource(Buffer.from(p.account.data))]));

  const decoded = configs.flatMap(({ pubkey: address, account }) => {
    try {
      return [{ address: address.toBase58(), config: decodeVaultConfig(Buffer.from(account.data)) }];
    } catch (e) {
      console.warn(`Skipping Jupiter Lend vault ${address.toBase58()}: ${(e as Error).message}`);
      return [];
    }
  });
  const tokens = await fetchTokens(decoded.flatMap(({ config }) => [config.supplyToken, config.borrowToken]));

  return decoded.map(({ address, config }) => {
    const supply = tokens.get(config.supplyToken);
    const borrow = tokens.get(config.borrowToken);
    const state = stateById.get(config.vaultId);

    const sources: OracleSource[] = (sourcesByOracle.get(config.oracle) ?? []).flatMap((s) => {
      // A Dex peg source prices from a pool but converts with another oracle source, which must also be live.
      const conversion = pegConversion.get(s.account);
      return conversion ? [s, conversion] : [s];
    });

    const collateral =
      state && supply ? (Number(state.totalSupply) * Number(state.vaultSupplyExchangePrice)) / EXCHANGE_PRICE_PRECISION / 10 ** INTERNAL_DECIMALS : 0;

    return {
      protocol: 'jupiter-lend',
      // Jupiter Lend runs every vault in one program, shown as a single market in its app.
      market: VAULTS_PROGRAM,
      marketName: 'Jupiter Lend',
      reserve: address,
      asset: supply && borrow ? `${supply.symbol}/${borrow.symbol}` : '',
      mint: config.supplyToken,
      status: 'active',
      maxAgePriceSeconds: USER_ACTION_MAX_AGE_SECONDS,
      feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: null },
      scopeChain: [],
      oracleSetup: null,
      oracle: { account: config.oracle, sources },
      lastPriceUpdateTs: 0,
      totalSupplyUsd: collateral * (supply?.usdPrice ?? 0),
    };
  });
}
