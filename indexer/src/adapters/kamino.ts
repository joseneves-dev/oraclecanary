import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
// Import only the generated account decoder: the SDK's main entry pulls in
// transaction helpers whose peer dependencies conflict with each other.
import { LendingMarket } from '@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/LendingMarket.js';
import { Obligation } from '@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Obligation.js';
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

// Anyone can create a reserve, so on-chain values can be anything a u64 holds. Seconds beyond this
// are clamped: they fit the database column and are far longer than any real staleness limit.
const MAX_AGE_CEILING_SECONDS = 2 ** 31 - 1;

const KAMINO_MARKETS_API = 'https://api.kamino.finance/v2/kamino-market';
const API_TIMEOUT_MS = 15_000;

// Names from the last successful call, used when the Kamino API is briefly unavailable.
let lastListedMarkets: Map<string, string> | null = null;

/** Token names are fixed-size byte arrays; PostgreSQL rejects NUL bytes anywhere in text. */
function decodeName(bytes: number[]): string {
  return Buffer.from(bytes).toString('utf8').replaceAll('\0', '').trim();
}

function feed(address: string): string | null {
  return UNSET.has(address) ? null : address;
}

function clampSeconds(value: { toString(): string }): number {
  return Math.min(Number(value.toString()), MAX_AGE_CEILING_SECONDS);
}

/**
 * Markets listed in Kamino's own app, by lending market address. Anyone can create a Kamino market
 * with arbitrary tokens and prices, so values from unlisted markets are not trustworthy.
 */
async function fetchListedMarkets(): Promise<Map<string, string>> {
  try {
    const response = await fetch(KAMINO_MARKETS_API, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Kamino markets API returned ${response.status}`);
    const markets = (await response.json()) as { name: string; lendingMarket: string }[];
    lastListedMarkets = new Map(markets.map((m) => [m.lendingMarket, m.name]));
    return lastListedMarkets;
  } catch (e) {
    if (!lastListedMarkets) throw e;
    console.warn(`Kamino markets API unavailable, reusing the last known list: ${(e as Error).message}`);
    return lastListedMarkets;
  }
}

function toMarketOracleConfig(address: string, data: Buffer, listedMarkets: Map<string, string>): MarketOracleConfig {
  const reserve = Reserve.decode(data);
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
    reserve: address,
    asset: decodeName(tokenInfo.name),
    mint: reserve.liquidity.mintPubkey.toString(),
    status: RESERVE_STATUS[reserve.config.status] ?? 'unknown',
    maxAgePriceSeconds: clampSeconds(tokenInfo.maxAgePriceSeconds),
    feeds: {
      pyth: feed(tokenInfo.pythConfiguration.price.toString()),
      switchboard: feed(tokenInfo.switchboardConfiguration.priceAggregator.toString()),
      switchboardTwap: feed(tokenInfo.switchboardConfiguration.twapAggregator.toString()),
      scope: feed(tokenInfo.scopeConfiguration.priceFeed.toString()),
    },
    scopeChain,
    oracleSetup: null,
    lastPriceUpdateTs: clampSeconds(reserve.liquidity.marketPriceLastUpdatedTs),
    totalSupplyUsd: (available + borrowed) * price,
    supplyTokens: available + borrowed,
    // Raw units, like a vault's ctokenAllocation: their ratio is a vault's share of the reserve.
    ctokenSupply: Number(reserve.collateral.mintTotalSupply.toString()),
  };
}

export async function fetchKaminoReserves(connection: Connection): Promise<MarketOracleConfig[]> {
  const listedMarkets = await fetchListedMarkets();
  const accounts = await connection.getProgramAccounts(KLEND_PROGRAM, {
    filters: [{ memcmp: { offset: 0, bytes: Reserve.discriminator.toString('base64'), encoding: 'base64' } }],
  });

  // Older reserves use a shorter account layout that this decoder would misread, so skip them.
  const currentLayoutSize = 8 + (Reserve as unknown as { layout: { span: number } }).layout.span;

  const reserves: MarketOracleConfig[] = [];
  let oldLayout = 0;
  for (const { pubkey, account } of accounts) {
    if (account.data.length !== currentLayoutSize) {
      oldLayout++;
      continue;
    }
    // One malformed reserve must not stop every other reserve from being checked.
    try {
      reserves.push(toMarketOracleConfig(pubkey.toBase58(), Buffer.from(account.data), listedMarkets));
    } catch (e) {
      console.warn(`Skipping Kamino reserve ${pubkey.toBase58()}: ${(e as Error).message}`);
    }
  }
  if (oldLayout) console.warn(`Skipped ${oldLayout} Kamino reserves that use an older account layout.`);
  return reserves;
}

/** A wallet's deposit in or loan from one Kamino reserve. */
export interface KaminoPosition {
  /** The obligation (loan account) holding it; a wallet has one per market it uses. */
  account: string;
  market: string;
  reserve: string;
  side: 'deposit' | 'borrow';
  tokens: number;
  /** At the reserve's last stored price. */
  usd: number;
  /**
   * How much of the position counts towards liquidation: for a deposit, the liquidation threshold
   * (0 to 1); for a loan, the borrow factor (1 or more). The account is liquidated when its loans
   * times their factors exceed its deposits times their thresholds.
   */
  weight: number;
}

/** Offset of `owner` in an Obligation: discriminator, tag, last update and lending market come first. */
const OBLIGATION_OWNER_OFFSET = 64;

/** A "Bsf" big fraction: four little-endian u64 limbs, 60 fractional bits. */
function fromBigFraction(value: { value: { toString(): string }[] }): number {
  let raw = 0n;
  value.value.forEach((limb, i) => {
    raw += BigInt(limb.toString()) << BigInt(64 * i);
  });
  return Number(raw) / SF_SCALE;
}

/** What turns an obligation's raw amounts into tokens and dollars now. */
interface ReserveRates {
  decimals: number;
  price: number;
  /** Underlying tokens per collateral (cToken) unit, both in raw units. */
  exchangeRate: number;
  cumulativeBorrowRate: number;
  liquidationThreshold: number;
  borrowFactor: number;
}

function reserveRates(data: Buffer): ReserveRates {
  const reserve = Reserve.decode(data);
  const l = reserve.liquidity;
  const sf = (v: { toString(): string }) => Number(v.toString()) / SF_SCALE;
  // What the collateral is a claim on: the tokens lent out and in the vault, less the fees owed.
  const liquidity =
    Number(l.totalAvailableAmount.toString()) + sf(l.borrowedAmountSf) - sf(l.accumulatedProtocolFeesSf) - sf(l.accumulatedReferrerFeesSf) - sf(l.pendingReferrerFeesSf);
  const collateral = Number(reserve.collateral.mintTotalSupply.toString());
  return {
    decimals: l.mintDecimals.toNumber(),
    price: sf(l.marketPriceSf),
    exchangeRate: collateral > 0 ? liquidity / collateral : 1,
    cumulativeBorrowRate: fromBigFraction(l.cumulativeBorrowRateBsf),
    liquidationThreshold: reserve.config.liquidationThresholdPct / 100,
    // Stored as a percentage; 0 means unset, which Kamino treats as 100%.
    borrowFactor: Math.max(100, Number(reserve.config.borrowFactorPct.toString())) / 100,
  };
}

/**
 * Every Kamino obligation a wallet owns, in any market, with its deposits and loans. Read-only.
 *
 * Valued from the reserves' current state: an obligation's own stored values are only written when
 * it is refreshed, which can be months ago for an idle loan. Deposits are collateral tokens times
 * the reserve's exchange rate; loans grow with the reserve's cumulative borrow rate since the
 * obligation last recorded it.
 */
export async function fetchKaminoPositions(connection: Connection, wallet: PublicKey): Promise<KaminoPosition[]> {
  const accounts = await connection.getProgramAccounts(KLEND_PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(Obligation.discriminator) } },
      { memcmp: { offset: OBLIGATION_OWNER_OFFSET, bytes: wallet.toBase58() } },
    ],
  });

  type Raw = { account: string; market: string; reserve: string; elevationGroup: number } & (
    | { side: 'deposit'; collateral: number }
    | { side: 'borrow'; borrowedSf: number; obligationRate: number }
  );
  const raw: Raw[] = [];
  for (const { pubkey, account } of accounts) {
    // One account the decoder cannot read must not hide the wallet's other positions.
    try {
      const obligation = Obligation.decode(account.data);
      const base = { account: pubkey.toBase58(), market: obligation.lendingMarket.toString(), elevationGroup: obligation.elevationGroup };
      for (const d of obligation.deposits) {
        if (d.depositedAmount.toString() === '0') continue;
        raw.push({ ...base, reserve: d.depositReserve.toString(), side: 'deposit', collateral: Number(d.depositedAmount.toString()) });
      }
      for (const b of obligation.borrows) {
        if (b.borrowedAmountSf.toString() === '0') continue;
        raw.push({
          ...base,
          reserve: b.borrowReserve.toString(),
          side: 'borrow',
          borrowedSf: Number(b.borrowedAmountSf.toString()) / SF_SCALE,
          obligationRate: fromBigFraction(b.cumulativeBorrowRateBsf),
        });
      }
    } catch (e) {
      console.warn(`Skipping Kamino obligation ${pubkey.toBase58()}: ${(e as Error).message}`);
    }
  }
  if (!raw.length) return [];

  const reserveKeys = [...new Set(raw.map((r) => r.reserve))];
  const infos = await connection.getMultipleAccountsInfo(reserveKeys.map((k) => new PublicKey(k)));
  const rates = new Map<string, ReserveRates>();
  infos.forEach((info, i) => {
    if (!info) return;
    try {
      rates.set(reserveKeys[i], reserveRates(info.data));
    } catch (e) {
      console.warn(`Skipping Kamino reserve ${reserveKeys[i]}: ${(e as Error).message}`);
    }
  });

  // Loans in an elevation group (e.g. a SOL/LST mode) use the group's liquidation threshold for
  // every deposit, and no borrow factor.
  const groupMarkets = [...new Set(raw.filter((r) => r.elevationGroup > 0).map((r) => r.market))];
  const groupThresholds = new Map<string, number>();
  if (groupMarkets.length) {
    const marketInfos = await connection.getMultipleAccountsInfo(groupMarkets.map((k) => new PublicKey(k)));
    marketInfos.forEach((info, i) => {
      if (!info) return;
      try {
        for (const g of LendingMarket.decode(info.data).elevationGroups) {
          if (g.id > 0) groupThresholds.set(`${groupMarkets[i]}:${g.id}`, g.liquidationThresholdPct / 100);
        }
      } catch (e) {
        console.warn(`Skipping Kamino market ${groupMarkets[i]}: ${(e as Error).message}`);
      }
    });
  }

  const positions: KaminoPosition[] = [];
  for (const r of raw) {
    const rate = rates.get(r.reserve);
    if (!rate) continue;
    const scale = 10 ** rate.decimals;
    const tokens =
      r.side === 'deposit'
        ? (r.collateral * rate.exchangeRate) / scale
        : (r.borrowedSf * (r.obligationRate > 0 ? rate.cumulativeBorrowRate / r.obligationRate : 1)) / scale;
    const group = r.elevationGroup > 0 ? groupThresholds.get(`${r.market}:${r.elevationGroup}`) : undefined;
    const weight = r.side === 'deposit' ? (group ?? rate.liquidationThreshold) : group !== undefined ? 1 : rate.borrowFactor;
    positions.push({ account: r.account, market: r.market, reserve: r.reserve, side: r.side, tokens, usd: tokens * rate.price, weight });
  }
  return positions;
}
