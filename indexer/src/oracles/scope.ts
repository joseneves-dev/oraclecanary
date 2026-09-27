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
  /** Other Scope entries this one is computed from (fallbacks, caps, multiplications). */
  dependsOn: number[];
  /** For fallback types (MostRecentOf): the maximum allowed divergence between sources, in bps. */
  maxDivergenceBps: number | null;
}

export interface ScopeFeed {
  pricesAccount: string;
  mappingsAccount: string;
  entries: Map<number, ScopeEntry>;
}

const UNSET = PublicKey.default.toBase58();
// Scope marks "no reference price" with the max u16 value.
const NO_REF_PRICE = 65535;

/** Reads which other entries a composite entry is computed from, using Scope's own parameter layouts. */
function parseComposite(type: string, generic: Uint8Array, entryCount: number) {
  const valid = (i: number) => i < entryCount; // unused source slots hold an out-of-range index
  switch (type) {
    case 'MostRecentOf': {
      const d = getMostRecentOfDataDecoder().decode(generic);
      return { dependsOn: d.sourceEntries.filter(valid), maxDivergenceBps: d.maxDivergenceBps };
    }
    case 'CappedMostRecentOf': {
      const d = getCappedMostRecentOfDataDecoder().decode(generic);
      return { dependsOn: [...d.sourceEntries, d.capEntry].filter(valid), maxDivergenceBps: d.maxDivergenceBps };
    }
    case 'CappedFloored': {
      const d = getCappedFlooredDataDecoder().decode(generic);
      const optional = [d.capEntry, d.floorEntry].flatMap((o) => (o.__option === 'Some' ? [o.value] : []));
      return { dependsOn: [d.sourceEntry, ...optional].filter(valid), maxDivergenceBps: null };
    }
    case 'MultiplicationChain':
      return { dependsOn: getMultiplicationChainDataDecoder().decode(generic).sourceEntries.filter(valid), maxDivergenceBps: null };
    case 'Conditional':
      return { dependsOn: getConditionalDataDecoder().decode(generic).sources.filter(valid), maxDivergenceBps: null };
    default:
      return { dependsOn: [], maxDivergenceBps: null };
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
    entries.set(index, {
      index,
      type,
      source: source === UNSET ? null : source,
      price: Number(dated.price.value) / 10 ** Number(dated.price.exp),
      unixTimestamp: Number(dated.unixTimestamp),
      lastUpdatedSlot: Number(dated.lastUpdatedSlot),
      refPrice: mappings.refPrice[index] === NO_REF_PRICE ? null : mappings.refPrice[index],
      ...parseComposite(type, Uint8Array.from(mappings.generic[index]), mappings.priceTypes.length),
    });
  });

  return { pricesAccount, mappingsAccount, entries };
}
