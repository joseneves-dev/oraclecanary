import { Connection, PublicKey } from '@solana/web3.js';

import { fetchKaminoPositions } from './adapters/kamino.js';
import { fetchVaults, type ApiVault } from './adapters/kaminoVaults.js';
import { fetchMarginfiPositions } from './adapters/marginfi.js';

/**
 * What a wallet has in the lending protocols OracleCanary monitors, read straight from the chain:
 * Kamino deposits and loans, marginfi deposits and loans, and Kamino curator vault shares. Only the
 * amounts; the web app joins each position with its reserve's or vault's health from the API.
 *
 * Nothing here signs or sends anything: a wallet is only an address to look up.
 */

export type WalletPosition =
  | {
      protocol: 'kamino' | 'marginfi';
      side: 'deposit' | 'borrow';
      /** Reserve (Kamino) or bank (marginfi): the key into /api/reserves/{address}. */
      reserve: string;
      /** Obligation (Kamino) or marginfi account holding it. */
      account: string;
      tokens: number;
      /** At the price the protocol last stored for the reserve or bank. */
      usd: number;
      /** Liquidation weight: a deposit's threshold (0 to 1), a loan's factor (1 or more). */
      weight: number;
    }
  | {
      protocol: 'kamino-vault';
      side: 'deposit';
      /** The key into /api/vaults/{address}. */
      vault: string;
      /** The wallet's share of the vault, 0 to 1; its value is this times the vault's deposits. */
      share: number;
    };

export interface WalletPositions {
  wallet: string;
  positions: WalletPosition[];
  /** Protocols whose positions are not read yet. */
  notCovered: string[];
  /** Sources that could not be read this time (kamino, marginfi, kamino-vault); the rest is still shown. */
  failed: string[];
  checkedAt: string;
}

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
/** How long the vault list is reused: shares issued change slowly, and the API is slow to answer. */
const VAULTS_TTL_MS = 10 * 60_000;

type SharesVault = ApiVault & { state: { sharesMint: string; sharesIssued: string } };
let vaultCache: { at: number; bySharesMint: Map<string, SharesVault> } | null = null;
let vaultRefresh: Promise<Map<string, SharesVault>> | null = null;

/**
 * Vaults by share mint, refreshed at most every VAULTS_TTL_MS by a single request at a time. When the
 * Kamino API fails, the last list is reused: shares issued move slowly.
 */
async function vaultsBySharesMint(): Promise<Map<string, SharesVault>> {
  if (vaultCache && Date.now() - vaultCache.at < VAULTS_TTL_MS) return vaultCache.bySharesMint;
  vaultRefresh ??= fetchVaults()
    .then((vaults) => {
      vaultCache = { at: Date.now(), bySharesMint: new Map((vaults as SharesVault[]).map((v) => [v.state.sharesMint, v])) };
      return vaultCache.bySharesMint;
    })
    .catch((e) => {
      if (!vaultCache) throw e;
      console.warn(`Kamino vaults API unavailable, reusing the last list: ${(e as Error).message}`);
      return vaultCache.bySharesMint;
    })
    .finally(() => {
      vaultRefresh = null;
    });
  return vaultRefresh;
}

/** Loads the vault list ahead of the first lookup, which would otherwise wait for the slow API. */
export function prewarmVaults(): void {
  vaultsBySharesMint().catch((e) => console.warn(`Could not load the Kamino vaults yet: ${(e as Error).message}`));
}

/** Vault shares held directly in the wallet (shares staked in a vault's farm are not seen). */
async function fetchVaultShares(connection: Connection, wallet: PublicKey): Promise<WalletPosition[]> {
  const [vaults, tokenAccounts] = await Promise.all([
    vaultsBySharesMint(),
    connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_PROGRAM }),
  ]);
  const holdings = tokenAccounts.value.flatMap(({ account }) => {
    const info = account.data.parsed?.info as { mint: string; tokenAmount: { amount: string } } | undefined;
    return info ? [{ mint: info.mint, amount: info.tokenAmount.amount }] : [];
  });
  return vaultSharePositions(holdings, vaults);
}

/** The wallet's share of each vault whose share token it holds, from raw token amounts. */
export function vaultSharePositions(
  holdings: { mint: string; amount: string }[],
  vaults: Map<string, { address: string; state: { sharesIssued: string } }>,
): WalletPosition[] {
  const positions: WalletPosition[] = [];
  for (const { mint, amount } of holdings) {
    const vault = vaults.get(mint);
    const issued = Number(vault?.state.sharesIssued);
    if (!vault || amount === '0' || !(issued > 0)) continue;
    positions.push({ protocol: 'kamino-vault', side: 'deposit', vault: vault.address, share: Math.min(1, Number(amount) / issued) });
  }
  return positions;
}

/**
 * Reads every source at once. A source that fails is named in `failed` instead of failing the whole
 * lookup, so an outage of one protocol's accounts does not hide the others.
 */
export async function fetchWalletPositions(connection: Connection, wallet: PublicKey): Promise<WalletPositions> {
  const sources = [
    ['kamino', () => fetchKaminoPositions(connection, wallet).then((list) => list.map((p) => ({ protocol: 'kamino' as const, side: p.side, reserve: p.reserve, account: p.account, tokens: p.tokens, usd: p.usd, weight: p.weight })))],
    ['marginfi', () => fetchMarginfiPositions(connection, wallet).then((list) => list.map((p) => ({ protocol: 'marginfi' as const, side: p.side, reserve: p.bank, account: p.account, tokens: p.tokens, usd: p.usd, weight: p.weight })))],
    ['kamino-vault', () => fetchVaultShares(connection, wallet)],
  ] as const satisfies readonly (readonly [string, () => Promise<WalletPosition[]>])[];

  const results = await Promise.allSettled(sources.map(([, read]) => read()));
  const positions: WalletPosition[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') positions.push(...result.value);
    else {
      failed.push(sources[i][0]);
      console.warn(`Positions of ${wallet.toBase58()} from ${sources[i][0]}: ${(result.reason as Error)?.message}`);
    }
  });
  // Nothing could be read at all: an error, not an empty wallet.
  if (failed.length === sources.length) throw new Error(`no source could be read (${failed.join(', ')})`);
  return { wallet: wallet.toBase58(), positions, notCovered: ['jupiter-lend'], failed, checkedAt: new Date().toISOString() };
}
