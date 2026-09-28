import type { MarketPrice } from '../oracles/marketPrice.js';
import type { MarketOracleConfig } from '../types.js';

/**
 * Kamino curator vaults (kVaults): each lends its deposits across several Kamino reserves chosen by
 * its curator. Mapping those allocations onto reserve health answers the question a curator or a
 * depositor asks: how much of this vault sits in reserves whose oracle is unhealthy?
 *
 * The vault list comes from Kamino's public API, which serves each vault's on-chain state.
 */

const VAULTS_API = 'https://api.kamino.finance/kvaults/vaults';
const API_TIMEOUT_MS = 30_000;
const UNUSED_RESERVE = '11111111111111111111111111111111';

/** Curators recognised in vault names, which Kamino shows as e.g. "Steakhouse USDC". */
const CURATORS = [
  'Steakhouse', 'Sentora', 'Allez', 'Gauntlet', 'Re7', 'MEV Capital', 'Elemental', 'RockawayX', 'Galaxy', 'Neutral Trade', 'Kamino',
  'Apollo',
];

/** The part of a vault's state this module reads, as the API serves it. */
export interface ApiVault {
  address: string;
  state: {
    /** The account that manages the vault: a curator uses one for all its vaults. */
    vaultAdminAuthority: string;
    name: number[];
    tokenMint: string;
    tokenMintDecimals: number;
    tokenAvailable: string;
    vaultAllocationStrategy: { reserve: string; ctokenAllocation: string }[];
  };
}

export interface VaultAllocation {
  reserve: string;
  /** Value the vault has in this reserve, in USD. */
  usd: number;
}

export interface CuratorVault {
  address: string;
  name: string;
  /** Curator recognised in the name, if any. */
  curator: string | null;
  tokenMint: string;
  /** Symbol of the deposit token, from the reserves it lends to. */
  token: string | null;
  /** Deposits not lent out, in USD. */
  idleUsd: number;
  /** Allocations with value, largest first. */
  allocations: VaultAllocation[];
  totalUsd: number;
}

export async function fetchVaults(): Promise<ApiVault[]> {
  const response = await fetch(VAULTS_API, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Kamino vaults API returned ${response.status}`);
  return (await response.json()) as ApiVault[];
}

const decodeName = (bytes: number[]) => Buffer.from(bytes).toString('utf8').replace(/\0+$/, '').trim();

/** The curator named in a vault's name, e.g. "Re7" in "Plume x Re7 USDC". */
export function curatorOf(name: string): string | null {
  // A space in a curator's name is optional: vaults are named "Neutral Trade …" as well as "NeutralTrade …".
  return CURATORS.find((c) => new RegExp(`(^|\\W)${c.replace(' ', '\\s?')}(\\W|$)`, 'i').test(name)) ?? null;
}

/**
 * Curators by vault address. A name can name a partner rather than the curator ("Ethena PYUSD Prime"
 * is run by Sentora) or no one, so the curator most named among the vaults sharing an admin account
 * is used for all of them; a vault whose admin runs no named vault has none.
 */
export function curatorsByVault(vaults: ApiVault[]): Map<string, string | null> {
  const named = new Map<string, Map<string, number>>();
  for (const v of vaults) {
    const curator = curatorOf(decodeName(v.state.name));
    if (!curator) continue;
    const counts = named.get(v.state.vaultAdminAuthority) ?? new Map<string, number>();
    counts.set(curator, (counts.get(curator) ?? 0) + 1);
    named.set(v.state.vaultAdminAuthority, counts);
  }
  const byAdmin = new Map([...named].map(([admin, counts]) => [admin, [...counts].sort((a, b) => b[1] - a[1])[0][0]]));
  return new Map(vaults.map((v) => [v.address, byAdmin.get(v.state.vaultAdminAuthority) ?? null]));
}

/**
 * Values each vault's allocations from the reserves just read: a vault holding `ctokenAllocation` of
 * a reserve's `ctokenSupply` collateral tokens owns that share of the reserve's supply. Reserves not
 * read this run (or unlisted) are left out; vaults worth nothing are dropped.
 */
/**
 * A token's USD price: from a listed reserve of that token (the price the protocol itself uses, and
 * available even when Jupiter is not), else from the market.
 */
function tokenPrice(mint: string, reserves: Map<string, MarketOracleConfig>, prices: Map<string, MarketPrice>): number | undefined {
  for (const r of reserves.values()) {
    if (r.mint === mint && r.marketName && r.supplyTokens && r.totalSupplyUsd > 0) return r.totalSupplyUsd / r.supplyTokens;
  }
  return prices.get(mint)?.usdPrice;
}

export function valueVaults(vaults: ApiVault[], reserves: Map<string, MarketOracleConfig>, prices: Map<string, MarketPrice>): CuratorVault[] {
  const curators = curatorsByVault(vaults);
  return vaults.flatMap((vault) => {
    const s = vault.state;
    const allocations = s.vaultAllocationStrategy.flatMap(({ reserve, ctokenAllocation }) => {
      const r = reserves.get(reserve);
      const held = Number(ctokenAllocation);
      if (reserve === UNUSED_RESERVE || !r || !r.ctokenSupply || !(held > 0)) return [];
      return [{ reserve, usd: (r.totalSupplyUsd * held) / r.ctokenSupply }];
    });
    allocations.sort((a, b) => b.usd - a.usd);

    const idleUsd = (Number(s.tokenAvailable) / 10 ** s.tokenMintDecimals) * (tokenPrice(s.tokenMint, reserves, prices) ?? 0);
    const totalUsd = idleUsd + allocations.reduce((sum, a) => sum + a.usd, 0);
    if (!(totalUsd >= 1)) return [];

    const name = decodeName(s.name) || vault.address;
    const token = allocations.map((a) => reserves.get(a.reserve)!).find((r) => r.mint === s.tokenMint)?.asset ?? null;
    return [{ address: vault.address, name, curator: curators.get(vault.address) ?? null, tokenMint: s.tokenMint, token, idleUsd, allocations, totalUsd }];
  });
}
