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
  /** Worst health accepted; "warning" lets single-source prices through but stops broken ones. */
  maxSeverity?: Severity;
  /** Oldest attestation accepted, in seconds, counted from when the health was measured. */
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
  const body = (await response.json()) as ApiAttestation;
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
 * reserve. Each reserve costs about 250 bytes of transaction size.
 */
export async function withOracleGuard(instructions: TransactionInstruction[], options: GuardOptions): Promise<TransactionInstruction[]> {
  const maxSeverity = options.maxSeverity ?? 'warning';
  const maxAttestationAgeSeconds = options.maxAttestationAgeSeconds ?? 600;
  const programId = options.programId ?? ORACLE_GUARD_PROGRAM_ID;
  const fetched = await Promise.all(options.reserves.map((reserve) => fetchAttestation(reserve, options)));
  return [
    ...fetched.map(({ signed }) => ed25519Instruction(signed)),
    ...fetched.map(({ attestation }) => assertOracleHealthyInstruction({ reserve: attestation.reserve, maxSeverity, maxAttestationAgeSeconds, programId })),
    ...instructions,
  ];
}
