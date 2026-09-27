import { Connection, PublicKey } from '@solana/web3.js';

/** Latest price stored in a Pyth `PriceUpdateV2` account. */
export interface PythPrice {
  price: number;
  publishTime: number;
}

// PriceUpdateV2 is 133 bytes with a "Full" verification level and 134 with "Partial"; sponsored
// feeds are allocated at 134 either way.
const PRICE_UPDATE_SIZES = new Set([133, 134]);
const VERIFICATION_PARTIAL = 0;
const VERIFICATION_FULL = 1;

/**
 * Decodes a Pyth receiver `PriceUpdateV2` account:
 * discriminator (8) · write authority (32) · verification level (1 or 2) · feed id (32) ·
 * price i64 · conf u64 · exponent i32 · publish time i64 · ...
 * Returns null for data that does not have that shape.
 */
export function decodePriceUpdate(data: Buffer): PythPrice | null {
  if (!PRICE_UPDATE_SIZES.has(data.length)) return null;
  const level = data[40];
  if (level !== VERIFICATION_PARTIAL && level !== VERIFICATION_FULL) return null;

  let offset = 40 + (level === VERIFICATION_PARTIAL ? 2 : 1) + 32;
  const price = data.readBigInt64LE(offset);
  offset += 8 + 8; // price, confidence
  const exponent = data.readInt32LE(offset);
  offset += 4;
  const publishTime = Number(data.readBigInt64LE(offset));
  return { price: Number(price) * 10 ** exponent, publishTime };
}

const BATCH = 100; // getMultipleAccounts limit

/** Reads Pyth price accounts; accounts that are missing or not price updates are left out. */
export async function fetchPythPrices(connection: Connection, addresses: string[]): Promise<Map<string, PythPrice>> {
  const unique = [...new Set(addresses)];
  const prices = new Map<string, PythPrice>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const infos = await connection.getMultipleAccountsInfo(batch.map((a) => new PublicKey(a)));
    infos.forEach((info, k) => {
      const decoded = info ? decodePriceUpdate(Buffer.from(info.data)) : null;
      if (decoded) prices.set(batch[k], decoded);
    });
  }
  return prices;
}
