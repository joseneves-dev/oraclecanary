/**
 * One-call integration of the oracle guard for a client building a transaction:
 *
 *   const instructions = await withOracleGuard([myBorrowIx], { reserves: [solReserve, usdcReserve] });
 *
 * For each reserve it fetches OracleCanary's latest signed attestation, checks the signature, and
 * puts the Ed25519 instruction carrying it and an `assert_oracle_healthy` check in front of the
 * caller's instructions. The transaction then fails on-chain, before the caller's instructions run,
 * if any of those prices is worse than allowed or the attestation is too old. A program can make the
 * same check itself through CPI, as programs/demo_vault does.
 */
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

import {
  SEVERITIES,
  assertOracleHealthyInstruction,
  decodeAttestation,
  ed25519Instruction,
  ORACLE_GUARD_PROGRAM_ID,
  verifyAttestation,
  type Attestation,
  type Severity,
  type SignedAttestation,
} from './attestation.js';

export const DEFAULT_API_URL = 'https://oraclecanary.com';
/** The key OracleCanary signs attestations with (the guard's configured authority on devnet). */
export const ORACLE_CANARY_SIGNER = new PublicKey('3MB4DxhySyKrywoNZfvLZeUPqkUpFCmDBmLRgnTjxAaH');

export interface GuardOptions {
  /** Reserves (Kamino reserve, marginfi bank, Jupiter Lend vault) whose price the instructions rely on. */
  reserves: (PublicKey | string)[];
  /** Worst health accepted; "warning" lets single-source prices through but refuses any critical issue. */
  maxSeverity?: Severity;
  /**
   * Oldest attestation accepted, in seconds, counted from when the health was measured; 900 by
   * default. The indexer measures every 5 minutes, so much below 600 fails often. It is also how long
   * an older "healthy" attestation can still be presented after a newer one says otherwise.
   */
  maxAttestationAgeSeconds?: number;
  apiUrl?: string;
  programId?: PublicKey;
  /** The attestation signer to trust; anything else is refused before a transaction is built. */
  signer?: PublicKey;
  fetch?: typeof fetch;
}

interface ApiAttestation {
  message: string;
  signature: string;
  publicKey: string;
}

/** The latest signed attestation for a reserve, checked: right signer, valid signature, right reserve. */
export async function fetchAttestation(
  reserve: PublicKey | string,
  options: Pick<GuardOptions, 'apiUrl' | 'signer' | 'fetch'> = {},
): Promise<{ signed: SignedAttestation; attestation: Attestation }> {
  const address = new PublicKey(reserve);
  const get = options.fetch ?? fetch;
  const response = await get(`${(options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '')}/api/reserves/${address.toBase58()}/attestation`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`No attestation for ${address.toBase58()}: the API answered ${response.status}`);
  const body = (await response.json()) as Partial<ApiAttestation>;
  if (typeof body.message !== 'string' || typeof body.signature !== 'string' || typeof body.publicKey !== 'string') {
    throw new Error(`The API answered without a signed attestation for ${address.toBase58()}`);
  }
  const signed: SignedAttestation = {
    message: Buffer.from(body.message, 'base64'),
    signature: Buffer.from(body.signature, 'base64'),
    publicKey: new PublicKey(body.publicKey),
  };
  const signer = options.signer ?? ORACLE_CANARY_SIGNER;
  if (!signed.publicKey.equals(signer)) throw new Error(`Attestation signed by ${signed.publicKey.toBase58()}, not ${signer.toBase58()}`);
  if (!verifyAttestation(signed)) throw new Error('Attestation signature does not verify');
  const attestation = decodeAttestation(signed.message);
  if (!attestation.reserve.equals(address)) throw new Error(`Attestation is for ${attestation.reserve.toBase58()}, not ${address.toBase58()}`);
  return { signed, attestation };
}

/**
 * The caller's instructions, preceded by an Ed25519 instruction and an oracle guard check per
 * reserve. The first reserve adds about 350 bytes to the transaction (its accounts included), each
 * further one about 220: with a lending instruction's own accounts, two reserves is close to the
 * 1232-byte limit.
 *
 * Throws, before anything is sent, when an attestation already fails the check the program would
 * make (too unhealthy, or too old), so no fee is paid for a transaction certain to fail.
 */
export async function withOracleGuard(instructions: TransactionInstruction[], options: GuardOptions): Promise<TransactionInstruction[]> {
  const maxSeverity = options.maxSeverity ?? 'warning';
  const maxAttestationAgeSeconds = options.maxAttestationAgeSeconds ?? 900;
  const programId = options.programId ?? ORACLE_GUARD_PROGRAM_ID;
  // A reserve listed twice would only cost another 220 bytes.
  const reserves = [...new Map(options.reserves.map((r) => [new PublicKey(r).toBase58(), new PublicKey(r)])).values()];
  const fetched = await Promise.all(reserves.map((reserve) => fetchAttestation(reserve, options)));
  const now = Math.floor(Date.now() / 1000);
  for (const { attestation: a } of fetched) {
    if (SEVERITIES.indexOf(a.severity) > SEVERITIES.indexOf(maxSeverity)) {
      throw new Error(`${a.reserve.toBase58()} is ${a.severity} (score ${a.score}), worse than the ${maxSeverity} allowed`);
    }
    if (now - a.issuedAt > maxAttestationAgeSeconds) {
      throw new Error(`The attestation for ${a.reserve.toBase58()} is ${now - a.issuedAt}s old, over the ${maxAttestationAgeSeconds}s allowed`);
    }
  }
  return [
    ...fetched.map(({ signed }) => ed25519Instruction(signed)),
    ...fetched.map(({ attestation }) => assertOracleHealthyInstruction({ reserve: attestation.reserve, maxSeverity, maxAttestationAgeSeconds, programId })),
    ...instructions,
  ];
}
