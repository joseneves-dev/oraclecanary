import { Connection, PublicKey } from '@solana/web3.js';

/** Latest round stored in a Chainlink OCR2 feed account on Solana. */
export interface ChainlinkPrice {
  price: number;
  /** Unix time of the latest transmission. */
  timestamp: number;
  description: string;
}

/** Program that owns Chainlink's Solana data feed accounts. */
export const CHAINLINK_STORE_PROGRAM = 'HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny';

// Feed account layout: discriminator (8) · version (1) · state (1) · owner, proposed owner, writer (3 × 32)
// · description (32) · decimals (1) · ... header padded to 200 bytes, then the latest transmission:
// slot u64 · timestamp u32 · padding u32 · answer i128.
const DESCRIPTION_OFFSET = 106;
const DECIMALS_OFFSET = 138;
const TRANSMISSION_OFFSET = 200;
const MIN_SIZE = TRANSMISSION_OFFSET + 32;

function readI128(data: Buffer, offset: number): bigint {
  let value = 0n;
  for (let i = 15; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]);
  return data[offset + 15] & 0x80 ? value - (1n << 128n) : value;
}

export function decodeChainlinkFeed(data: Buffer): ChainlinkPrice | null {
  if (data.length < MIN_SIZE) return null;
  const decimals = data[DECIMALS_OFFSET];
  return {
    description: data.subarray(DESCRIPTION_OFFSET, DECIMALS_OFFSET).toString('utf8').replaceAll('\0', '').trim(),
    timestamp: data.readUInt32LE(TRANSMISSION_OFFSET + 8),
    price: Number(readI128(data, TRANSMISSION_OFFSET + 16)) / 10 ** decimals,
  };
}

const BATCH = 100;

/** Reads Chainlink feed accounts; accounts not owned by the Chainlink store program are left out. */
export async function fetchChainlinkPrices(connection: Connection, addresses: string[]): Promise<Map<string, ChainlinkPrice>> {
  const unique = [...new Set(addresses)];
  const prices = new Map<string, ChainlinkPrice>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const infos = await connection.getMultipleAccountsInfo(batch.map((a) => new PublicKey(a)));
    infos.forEach((info, k) => {
      if (!info || info.owner.toBase58() !== CHAINLINK_STORE_PROGRAM) return;
      const decoded = decodeChainlinkFeed(Buffer.from(info.data));
      if (decoded) prices.set(batch[k], decoded);
    });
  }
  return prices;
}
