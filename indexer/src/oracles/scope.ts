import { Connection, PublicKey } from '@solana/web3.js';
import {
  getOracleMappingsDecoder,
  getOracleMappingsSize,
} from '@kamino-finance/scope-sdk/dist/@codegen/scope/accounts/oracleMappings.js';
import {
  getOraclePricesDecoder,
  getOraclePricesSize,
} from '@kamino-finance/scope-sdk/dist/@codegen/scope/accounts/oraclePrices.js';
import { OracleType } from '@kamino-finance/scope-sdk/dist/@codegen/scope/types/oracleType.js';
import { getCappedFlooredDataDecoder } from '@kamino-finance/scope-sdk/dist/@codegen/scope/types/cappedFlooredData.js';
import { getCappedMostRecentOfDataDecoder } from '@kamino-finance/scope-sdk/dist/@codegen/scope/types/cappedMostRecentOfData.js';
import { getConditionalDataDecoder } from '@kamino-finance/scope-sdk/dist/@codegen/scope/types/conditionalData.js';
import { getMostRecentOfDataDecoder } from '@kamino-finance/scope-sdk/dist/@codegen/scope/types/mostRecentOfData.js';
import { getMultiplicationChainDataDecoder } from '@kamino-finance/scope-sdk/dist/@codegen/scope/types/multiplicationChainData.js';

/** One entry of a Scope price account: where the price comes from and when it was last written. */
export interface ScopeEntry {
  index: number;
  /** Scope oracle type name, e.g. "PythPull", "SwitchboardOnDemand", "RedStone". */
  type: string;
  /** Upstream account the price is read from (Pyth feed, Switchboard aggregator, pool...). */
  source: string | null;
  price: number;
  unixTimestamp: number;
  lastUpdatedSlot: number;
  /** Index of the reference price Scope compares this entry against, if any. */
  refPrice: number | null;
  /**
   * How `sources` produce this entry's price: `all` when every source is needed (multiplied),
   * `any` when each is an alternative (the most recent valid one wins), null for a leaf that reads
   * an external account.
   */
  combine: 'all' | 'any' | null;
  /** Entries this price is computed from. */
  sources: number[];
  /** Entries that only cap or floor the price; they are neither a price source nor a fallback. */
  bounds: number[];
  /** Every entry this one reads: sources and bounds. */
  dependsOn: number[];
  /** For fallback types (MostRecentOf): the maximum allowed divergence between sources, in bps. */
  maxDivergenceBps: number | null;
  /** Sources older than this many seconds are ignored by Scope when computing this entry. */
  sourcesMaxAgeS: number | null;
}

export interface ScopeFeed {
  pricesAccount: string;
  mappingsAccount: string;
  entries: Map<number, ScopeEntry>;
}

const UNSET = PublicKey.default.toBase58();
// Scope marks "no reference price" with the max u16 value.
const NO_REF_PRICE = 65535;

type Composite = Pick<ScopeEntry, 'combine' | 'sources' | 'bounds' | 'maxDivergenceBps' | 'sourcesMaxAgeS'>;

const TWAP_TYPES = new Set(['ScopeTwap1h', 'ScopeTwap8h', 'ScopeTwap24h', 'ScopeTwap7d']);

const LEAF: Composite = { combine: null, sources: [], bounds: [], maxDivergenceBps: null, sourcesMaxAgeS: null };

/**
 * Reads how a composite entry is computed from other entries, using Scope's own parameter layouts.
 * `twapSource` is the mapping's twap/ref-price field, which holds the source entry for TWAP types.
 */
function parseComposite(type: string, generic: Uint8Array, twapSource: number, entryCount: number): Composite {
  const valid = (i: number) => i < entryCount; // unused source slots hold an out-of-range index
  if (TWAP_TYPES.has(type)) return { ...LEAF, combine: 'all', sources: [twapSource].filter(valid) };

  switch (type) {
    case 'MostRecentOf': {
      const d = getMostRecentOfDataDecoder().decode(generic);
      return { ...LEAF, combine: 'any', sources: d.sourceEntries.filter(valid), maxDivergenceBps: d.maxDivergenceBps, sourcesMaxAgeS: Number(d.sourcesMaxAgeS) };
    }
    case 'CappedMostRecentOf': {
      const d = getCappedMostRecentOfDataDecoder().decode(generic);
      return {
        combine: 'any',
        sources: d.sourceEntries.filter(valid),
        bounds: [d.capEntry].filter(valid),
        maxDivergenceBps: d.maxDivergenceBps,
        sourcesMaxAgeS: Number(d.sourcesMaxAgeS),
      };
    }
    case 'CappedFloored': {
      const d = getCappedFlooredDataDecoder().decode(generic);
      const bounds = [d.capEntry, d.floorEntry].flatMap((o) => (o.__option === 'Some' ? [o.value] : []));
      return { ...LEAF, combine: 'all', sources: [d.sourceEntry].filter(valid), bounds: bounds.filter(valid) };
    }
    case 'MultiplicationChain': {
      const d = getMultiplicationChainDataDecoder().decode(generic);
      return { ...LEAF, combine: 'all', sources: d.sourceEntries.filter(valid), sourcesMaxAgeS: Number(d.sourcesMaxAgeS) };
    }
    case 'Conditional':
      // The condition picks one of the sources, so each is an alternative.
      return { ...LEAF, combine: 'any', sources: getConditionalDataDecoder().decode(generic).sources.filter(valid) };
    default:
      return LEAF;
  }
}

/**
 * Follows composite entries down to the entries that read an external source.
 * Returns each leaf once, even when several branches reach it.
 */
export function resolveLeaves(feed: ScopeFeed, index: number, seen = new Set<number>()): ScopeEntry[] {
  if (seen.has(index)) return [];
  seen.add(index);
  const entry = feed.entries.get(index);
  if (!entry) return [];
  if (entry.dependsOn.length === 0) return [entry];
  return entry.dependsOn.flatMap((i) => resolveLeaves(feed, i, seen));
}

async function fetchData(connection: Connection, address: string, expectedSize: number): Promise<Uint8Array> {
  const info = await connection.getAccountInfo(new PublicKey(address));
  if (!info) throw new Error(`Scope account not found: ${address}`);
  if (info.data.length !== expectedSize) {
    throw new Error(`Unexpected Scope account size ${info.data.length} (expected ${expectedSize}) for ${address}`);
  }
  return info.data;
}

export async function fetchScopeFeed(connection: Connection, pricesAccount: string): Promise<ScopeFeed> {
  const prices = getOraclePricesDecoder().decode(await fetchData(connection, pricesAccount, getOraclePricesSize()));
  const mappingsAccount = prices.oracleMappings.toString();
  const mappings = getOracleMappingsDecoder().decode(
    await fetchData(connection, mappingsAccount, getOracleMappingsSize()),
  );

  const entries = new Map<number, ScopeEntry>();
  mappings.priceTypes.forEach((typeId, index) => {
    const source = mappings.priceInfoAccounts[index].toString();
    const dated = prices.prices[index];
    // Unused slots have no source account and have never been written.
    if (source === UNSET && dated.unixTimestamp === 0n) return;

    const type = OracleType[typeId] ?? `Unknown(${typeId})`;
    const composite = parseComposite(
      type,
      Uint8Array.from(mappings.generic[index]),
      mappings.twapSourceOrRefPriceToleranceBps[index],
      mappings.priceTypes.length,
    );
    entries.set(index, {
      index,
      type,
      source: source === UNSET ? null : source,
      price: Number(dated.price.value) / 10 ** Number(dated.price.exp),
      unixTimestamp: Number(dated.unixTimestamp),
      lastUpdatedSlot: Number(dated.lastUpdatedSlot),
      refPrice: mappings.refPrice[index] === NO_REF_PRICE ? null : mappings.refPrice[index],
      ...composite,
      dependsOn: [...composite.sources, ...composite.bounds],
    });
  });

  return { pricesAccount, mappingsAccount, entries };
}
