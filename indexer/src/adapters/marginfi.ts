import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// marginfi's IDL 0.1.11, taken from the @0dotxyz/p0-ts-sdk package (MIT). The IDL published
// on-chain is older and cannot decode banks that use newer oracle setups or bank states.
import marginfiIdl from '../idl/marginfi.json' with { type: 'json' };
import type { MarketOracleConfig } from '../types.js';

const idl = marginfiIdl as unknown as Idl;
const coder = new BorshAccountsCoder(idl);
const PROGRAM = new PublicKey(idl.address);

// The group behind marginfi's own app; banks in any other group are permissionless.
const MAIN_GROUP = '4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8';
const MAIN_GROUP_NAME = 'marginfi Main';

// marginfi uses this limit when a bank's own oracle_max_age is 0.
const DEFAULT_MAX_AGE_SECONDS = 60;

/** Operational states in which a bank still holds and prices deposits. */
const LIVE_STATES = new Set(['Operational', 'ReduceOnly', 'ReduceOnlyWithBorrowingPower', 'CircuitBroken']);

/** Oracle setups whose first oracle key is a Switchboard feed. */
export const SWITCHBOARD_SETUPS = new Set([
  'SwitchboardV2',
  'SwitchboardPull',
  'KaminoSwitchboardPull',
  'DriftSwitchboardPull',
  'SolendSwitchboardPull',
  'JuplendSwitchboardPull',
]);

function discriminator(account: string): string {
  const entry = idl.accounts?.find((a) => a.name === account);
  if (!entry) throw new Error(`Account ${account} is not in the marginfi IDL`);
  return bs58.encode(Buffer.from(entry.discriminator));
}

/** I80F48 fixed-point number: a little-endian signed 128-bit integer with 48 fractional bits. */
function fromI80F48(wrapped: { value: number[] }): number {
  const bytes = Buffer.from(wrapped.value);
  let value = 0n;
  for (let i = 15; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
  if (bytes[15] & 0x80) value -= 1n << 128n;
  return Number(value) / 2 ** 48;
}

const variant = (enumValue: object) => Object.keys(enumValue)[0] ?? 'Unknown';

/**
 * Integration banks hold another protocol's receipt token (Kamino, Drift, Solend or Jupiter Lend);
 * their oracle prices the underlying token, and `cache.price_multiplier` is the exchange rate.
 */
const INTEGRATION_SETUP = /^(Fixed)?(Kamino|Drift|Solend|Juplend)/;

/**
 * The price of one deposited token, as marginfi last used it: the fixed price or the cached oracle
 * price, times the exchange rate for integration banks. Zero when the bank never cached a price.
 */
function bankPrice(
  bank: { config: { fixed_price: { value: number[] } }; cache: { last_oracle_price: { value: number[] }; price_multiplier: { value: number[] } } },
  setup: string,
): number {
  const base = setup.startsWith('Fixed') ? fromI80F48(bank.config.fixed_price) : fromI80F48(bank.cache.last_oracle_price);
  const multiplier = fromI80F48(bank.cache.price_multiplier);
  return INTEGRATION_SETUP.test(setup) && multiplier > 0 ? base * multiplier : base;
}

/** Tickers such as "SOL | Wrapped SOL" from BankMetadata accounts, keyed by bank address. */
async function fetchTickers(connection: Connection): Promise<Map<string, string>> {
  const accounts = await connection.getProgramAccounts(PROGRAM, {
    filters: [{ memcmp: { offset: 0, bytes: discriminator('BankMetadata') } }],
  });
  const tickers = new Map<string, string>();
  for (const { account } of accounts) {
    try {
      const meta = coder.decode('BankMetadata', Buffer.from(account.data));
      const raw = Buffer.from(meta.ticker.slice(0, meta.end_ticker_byte + 1)).toString('utf8').replaceAll('\0', '');
      tickers.set(meta.bank.toBase58(), raw.split(' | ')[0].trim());
    } catch {
      // A malformed metadata account only costs that bank its symbol.
    }
  }
  return tickers;
}

function toMarketOracleConfig(address: string, data: Buffer, tickers: Map<string, string>): MarketOracleConfig {
  const bank = coder.decode('Bank', data);
  const config = bank.config;
  const setup = variant(config.oracle_setup);
  const oracleKey: string = config.oracle_keys[0].toBase58();
  const group: string = bank.group.toBase58();

  const assets = (fromI80F48(bank.asset_share_value) * fromI80F48(bank.total_asset_shares)) / 10 ** bank.mint_decimals;
  const price = bankPrice(bank, setup);
  const maxAge: number = config.oracle_max_age;
  const state = variant(config.operational_state);
  // Weight 0 at opening and at liquidation: deposits give no borrowing power at all.
  const noCollateral = fromI80F48(config.asset_weight_init) === 0 && fromI80F48(config.asset_weight_maint) === 0;

  return {
    protocol: 'marginfi',
    market: group,
    marketName: group === MAIN_GROUP ? MAIN_GROUP_NAME : null,
    reserve: address,
    asset: tickers.get(address) ?? '',
    mint: bank.mint.toBase58(),
    status: LIVE_STATES.has(state) ? 'active' : 'obsolete',
    maxAgePriceSeconds: maxAge === 0 ? DEFAULT_MAX_AGE_SECONDS : maxAge,
    feeds: {
      // Every other setup prices from a Pyth account (possibly times an exchange rate); the
      // indexer confirms it by decoding the account.
      pyth: SWITCHBOARD_SETUPS.has(setup) || setup === 'Scope' || setup === 'None' || setup.startsWith('Fixed') ? null : oracleKey,
      switchboard: SWITCHBOARD_SETUPS.has(setup) ? oracleKey : null,
      switchboardTwap: null,
      scope: setup === 'Scope' ? oracleKey : null,
    },
    scopeChain: [],
    oracleSetup: setup,
    lastPriceUpdateTs: Number(bank.cache.last_oracle_price_timestamp.toString()),
    totalSupplyUsd: assets * price,
    supplyTokens: assets,
    // Only `Fixed` is the price itself; FixedKamino, FixedDrift... multiply it by an exchange rate.
    ...(setup === 'Fixed' ? { fixedPrice: fromI80F48(config.fixed_price) } : {}),
    ...(state === 'ReduceOnly' && noCollateral ? { windingDown: true } : {}),
  };
}

export async function fetchMarginfiBanks(connection: Connection): Promise<MarketOracleConfig[]> {
  const [tickers, accounts] = await Promise.all([
    fetchTickers(connection),
    connection.getProgramAccounts(PROGRAM, { filters: [{ memcmp: { offset: 0, bytes: discriminator('Bank') } }] }),
  ]);

  const banks: MarketOracleConfig[] = [];
  for (const { pubkey, account } of accounts) {
    // One bank the decoder cannot read must not stop every other bank from being checked.
    try {
      banks.push(toMarketOracleConfig(pubkey.toBase58(), Buffer.from(account.data), tickers));
    } catch (e) {
      console.warn(`Skipping marginfi bank ${pubkey.toBase58()}: ${(e as Error).message}`);
    }
  }
  return banks;
}

/** A wallet's deposit in or loan from one marginfi bank. */
export interface MarginfiPosition {
  /** The marginfi account holding it; a wallet can have several. */
  account: string;
  bank: string;
  side: 'deposit' | 'borrow';
  tokens: number;
  /** At the bank's last stored price (or its fixed price). */
  usd: number;
  /**
   * The bank's maintenance weight: for a deposit, the share that counts as collateral (0 to 1); for
   * a loan, the multiple it counts as debt. The account is liquidated when weighted loans exceed
   * weighted deposits.
   */
  weight: number;
  /** The bank could not be read, or never cached a price: the value is unknown (0 here). */
  unpriced?: true;
}

/** Offset of `authority` in a MarginfiAccount: after the discriminator and `group`. */
const AUTHORITY_OFFSET = 8 + 32;

/**
 * The deposits and loans of every marginfi account a wallet owns, in any group. Read-only: shares
 * are converted with each bank's share values, and priced at the price the bank last stored.
 */
export async function fetchMarginfiPositions(connection: Connection, wallet: PublicKey): Promise<MarginfiPosition[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: discriminator('MarginfiAccount') } },
      { memcmp: { offset: AUTHORITY_OFFSET, bytes: wallet.toBase58() } },
    ],
  });

  const balances: { account: string; bank: string; assetShares: number; liabilityShares: number }[] = [];
  for (const { pubkey, account } of accounts) {
    // One account the decoder cannot read must not hide the wallet's other positions.
    try {
      const decoded = coder.decode('MarginfiAccount', Buffer.from(account.data));
      for (const balance of decoded.lending_account.balances) {
        if (!balance.active) continue;
        balances.push({
          account: pubkey.toBase58(),
          bank: balance.bank_pk.toBase58(),
          assetShares: fromI80F48(balance.asset_shares),
          liabilityShares: fromI80F48(balance.liability_shares),
        });
      }
    } catch (e) {
      console.warn(`Skipping marginfi account ${pubkey.toBase58()}: ${(e as Error).message}`);
    }
  }
  if (!balances.length) return [];

  const bankKeys = [...new Set(balances.map((b) => b.bank))];
  const bankInfos = await connection.getMultipleAccountsInfo(bankKeys.map((k) => new PublicKey(k)));
  const banks = new Map<string, { assetValue: number; liabilityValue: number; decimals: number; price: number; assetWeight: number; liabilityWeight: number }>();
  bankInfos.forEach((info, i) => {
    if (!info) return;
    try {
      const bank = coder.decode('Bank', Buffer.from(info.data));
      banks.set(bankKeys[i], {
        assetValue: fromI80F48(bank.asset_share_value),
        liabilityValue: fromI80F48(bank.liability_share_value),
        decimals: bank.mint_decimals,
        price: bankPrice(bank, variant(bank.config.oracle_setup)),
        assetWeight: fromI80F48(bank.config.asset_weight_maint),
        liabilityWeight: fromI80F48(bank.config.liability_weight_maint),
      });
    } catch (e) {
      console.warn(`Skipping marginfi bank ${bankKeys[i]}: ${(e as Error).message}`);
    }
  });

  const positions: MarginfiPosition[] = [];
  for (const b of balances) {
    const bank = banks.get(b.bank);
    // Kept rather than dropped: a missing loan would make the account look safer than it is.
    if (!bank) {
      if (b.assetShares > 0) positions.push({ account: b.account, bank: b.bank, side: 'deposit', tokens: 0, usd: 0, weight: 0, unpriced: true });
      if (b.liabilityShares > 0) positions.push({ account: b.account, bank: b.bank, side: 'borrow', tokens: 0, usd: 0, weight: 0, unpriced: true });
      continue;
    }
    const scale = 10 ** bank.decimals;
    const sides: [MarginfiPosition['side'], number][] = [
      ['deposit', (b.assetShares * bank.assetValue) / scale],
      ['borrow', (b.liabilityShares * bank.liabilityValue) / scale],
    ];
    for (const [side, tokens] of sides) {
      // Rounding leaves dust shares behind on closed positions; judged in tokens, so a position whose
      // bank never cached a price is still listed (at $0) rather than hidden.
      if (tokens * 10 ** bank.decimals < 1) continue;
      positions.push({
        account: b.account,
        bank: b.bank,
        side,
        tokens,
        usd: tokens * bank.price,
        weight: side === 'deposit' ? bank.assetWeight : bank.liabilityWeight,
        ...(bank.price > 0 ? {} : { unpriced: true as const }),
      });
    }
  }
  return positions;
}
