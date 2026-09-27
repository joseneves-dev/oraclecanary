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
  const price = setup.startsWith('Fixed') ? fromI80F48(config.fixed_price) : fromI80F48(bank.cache.last_oracle_price);
  const maxAge: number = config.oracle_max_age;

  return {
    protocol: 'marginfi',
    market: group,
    marketName: group === MAIN_GROUP ? MAIN_GROUP_NAME : null,
    reserve: address,
    asset: tickers.get(address) ?? '',
    mint: bank.mint.toBase58(),
    status: LIVE_STATES.has(variant(config.operational_state)) ? 'active' : 'obsolete',
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
