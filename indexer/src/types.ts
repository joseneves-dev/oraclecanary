export type Protocol = 'kamino' | 'marginfi' | 'jupiter-lend';

/** One input of a Jupiter Lend oracle; every source is multiplied or divided into the price. */
export interface OracleSource {
  account: string;
  /** Source type as named by the oracle program, e.g. "Chainlink", "Pyth", "StakePool". */
  type: string;
}

/** Which oracle feeds one lending market (reserve/bank) is configured to read. */
export interface MarketOracleConfig {
  protocol: Protocol;
  /** Lending market (group) the reserve belongs to. */
  market: string;
  /** Name shown by the protocol's own app; null for unlisted (permissionless) markets. */
  marketName: string | null;
  /** Reserve / bank account address. */
  reserve: string;
  /** Human-readable asset name as configured by the protocol, e.g. "SOL". */
  asset: string;
  mint: string;
  status: 'active' | 'obsolete' | 'hidden' | 'unknown';
  /** The protocol's own staleness limit for this reserve, in seconds. */
  maxAgePriceSeconds: number;
  /** Configured feed accounts; null when a slot is not used. */
  feeds: {
    pyth: string | null;
    switchboard: string | null;
    switchboardTwap: string | null;
    scope: string | null;
  };
  /** Kamino only: indices into the Scope price account that make up the price chain. */
  scopeChain: number[];
  /** marginfi only: the bank's OracleSetup, which says how `feeds` are combined into a price. */
  oracleSetup: string | null;
  /** Jupiter Lend only: the vault's oracle account and the sources it chains. */
  oracle?: { account: string; sources: OracleSource[] };
  /**
   * Unix timestamp of the last price the protocol stored on the reserve. Protocols only refresh
   * this when someone transacts, so it is not a measure of oracle staleness.
   */
  lastPriceUpdateTs: number;
  /**
   * Deposited value (available + borrowed) in USD: at the protocol's last stored price in listed
   * markets, and at the market price in unlisted ones (see run.ts), whose own price anyone can set.
   */
  totalSupplyUsd: number;
  /** Deposited amount (available + borrowed) in tokens, when known. */
  supplyTokens?: number;
  /** marginfi only: the price a Fixed oracle setup uses. */
  fixedPrice?: number;
  /** Kamino only: collateral tokens (cTokens) in circulation, in raw units. */
  ctokenSupply?: number;
}
