export type Protocol = 'kamino' | 'marginfi' | 'jupiter-lend';

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
  /**
   * Unix timestamp of the last price the protocol stored on the reserve. Protocols only refresh
   * this when someone transacts, so it is not a measure of oracle staleness.
   */
  lastPriceUpdateTs: number;
  /** Deposited value (available + borrowed) at the protocol's last stored price, in USD. */
  totalSupplyUsd: number;
}
