import { Connection, PublicKey } from '@solana/web3.js';

/**
 * What a token's issuer can do to holders' balances, read from its mint: freeze any account holding
 * it, and (Token-2022) move or burn it from any account through a permanent delegate.
 */
export interface TokenControls {
  freezeAuthority: string | null;
  permanentDelegate: string | null;
}

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

// Mint: mint authority option u32 · authority (32) · supply u64 · decimals u8 · initialized u8 ·
// freeze authority option u32 · authority (32). Token-2022 extensions follow the base account,
// padded to the size of a token account (165), then an account type byte (1 = mint).
const MINT_SIZE = 82;
const FREEZE_OPTION_OFFSET = 46;
const FREEZE_AUTHORITY_OFFSET = 50;
const EXTENSIONS_OFFSET = 166;
const ACCOUNT_TYPE_MINT = 1;
const EXTENSION_PERMANENT_DELEGATE = 12;

// Token account: mint (32) · owner (32) · amount u64 · delegate option u32 · delegate (32) · state u8.
const TOKEN_ACCOUNT_SIZE = 165;
const STATE_OFFSET = 108;
const STATE_FROZEN = 2;

const pubkey = (data: Buffer, offset: number) => new PublicKey(data.subarray(offset, offset + 32)).toBase58();

/** A Token-2022 extension's data, or null when the mint does not have it. */
function extension(data: Buffer, type: number): Buffer | null {
  if (data.length <= EXTENSIONS_OFFSET || data[EXTENSIONS_OFFSET - 1] !== ACCOUNT_TYPE_MINT) return null;
  for (let offset = EXTENSIONS_OFFSET; offset + 4 <= data.length; ) {
    const kind = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    if (kind === type) return data.subarray(offset + 4, offset + 4 + length);
    offset += 4 + length;
  }
  return null;
}

/** Decodes an SPL Token or Token-2022 mint; null for data that is not a mint. */
export function decodeTokenControls(data: Buffer): TokenControls | null {
  if (data.length < MINT_SIZE) return null;
  const freezeAuthority = data.readUInt32LE(FREEZE_OPTION_OFFSET) === 1 ? pubkey(data, FREEZE_AUTHORITY_OFFSET) : null;
  const delegate = extension(data, EXTENSION_PERMANENT_DELEGATE);
  // An unset permanent delegate is stored as the all-zero key.
  const delegateKey = delegate?.length === 32 ? pubkey(delegate, 0) : null;
  const permanentDelegate = delegateKey && delegateKey !== PublicKey.default.toBase58() ? delegateKey : null;
  return { freezeAuthority, permanentDelegate };
}

/** Whether a token account (SPL Token or Token-2022) is frozen; null for data that is not one. */
export function decodeFrozen(data: Buffer): boolean | null {
  if (data.length < TOKEN_ACCOUNT_SIZE) return null;
  return data[STATE_OFFSET] === STATE_FROZEN;
}

const BATCH = 100; // getMultipleAccounts limit

/** Reads token program accounts and decodes those that are readable; others are left out. */
async function readTokenAccounts<T>(connection: Connection, addresses: string[], decode: (data: Buffer) => T | null): Promise<Map<string, T>> {
  const unique = [...new Set(addresses)];
  const decoded = new Map<string, T>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const infos = await connection.getMultipleAccountsInfo(batch.map((a) => new PublicKey(a)));
    infos.forEach((info, k) => {
      if (!info || !TOKEN_PROGRAMS.has(info.owner.toBase58())) return;
      const value = decode(Buffer.from(info.data));
      if (value !== null) decoded.set(batch[k], value);
    });
  }
  return decoded;
}

export const fetchTokenControls = (connection: Connection, mints: string[]) => readTokenAccounts(connection, mints, decodeTokenControls);

/** Whether each readable token account is frozen. */
export const fetchFrozen = (connection: Connection, accounts: string[]) => readTokenAccounts(connection, accounts, decodeFrozen);
