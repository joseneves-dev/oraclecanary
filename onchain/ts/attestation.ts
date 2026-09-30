/**
 * Builds and signs OracleCanary health attestations for the oracle_guard program, and the
 * instructions a transaction needs to present one.
 *
 * Wire format (54 bytes, little-endian):
 *   0..8    domain tag "OCANARY1"
 *   8..40   reserve public key
 *   40      score u8 (0-100)
 *   41      severity u8 (0 ok, 1 info, 2 warning, 3 critical)
 *   42..46  price_age_seconds u32 (0xFFFFFFFF = unknown)
 *   46..54  issued_at i64, unix seconds when the health was measured (not when it was signed)
 */
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction } from '@solana/web3.js';
import nacl from 'tweetnacl';

export const ORACLE_GUARD_PROGRAM_ID = new PublicKey('444eBJsPgQGT6QfKtESvd21vZQa4YFsuKTodCokTasTT');
export const DOMAIN_TAG = new TextEncoder().encode('OCANARY1');
export const ATTESTATION_LEN = 54;
export const PRICE_AGE_UNKNOWN = 0xffffffff;

export const SEVERITIES = ['ok', 'info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Attestation {
  reserve: PublicKey;
  score: number;
  severity: Severity;
  /** Age of the oldest price in the reserve's price chain; null if it could not be read. */
  priceAgeSeconds: number | null;
  /** Unix seconds. */
  issuedAt: number;
}

export interface SignedAttestation {
  message: Uint8Array;
  signature: Uint8Array;
  publicKey: PublicKey;
}

/** The subset of the indexer's HealthResult an attestation needs. */
export interface HealthLike {
  score: number;
  checks: { severity: 'critical' | 'warning' | 'info' }[];
  priceAgeSeconds: number | null;
}

/** Attestation for a reserve from a health result: severity is the worst open check, ok if none. */
export function attestationFromHealth(reserve: PublicKey | string, health: HealthLike, issuedAt: number): Attestation {
  const worst = health.checks.reduce((max, c) => Math.max(max, SEVERITIES.indexOf(c.severity)), 0);
  return {
    reserve: new PublicKey(reserve),
    score: health.score,
    severity: SEVERITIES[worst],
    priceAgeSeconds: health.priceAgeSeconds,
    issuedAt,
  };
}

export function encodeAttestation(a: Attestation): Uint8Array {
  if (!Number.isInteger(a.score) || a.score < 0 || a.score > 100) throw new RangeError(`score out of range: ${a.score}`);
  if (!Number.isSafeInteger(a.issuedAt)) throw new RangeError(`issuedAt must be integer unix seconds: ${a.issuedAt}`);
  const severity = SEVERITIES.indexOf(a.severity);
  if (severity < 0) throw new RangeError(`unknown severity: ${a.severity}`);
  const priceAge =
    a.priceAgeSeconds === null ? PRICE_AGE_UNKNOWN : Math.min(Math.max(0, Math.floor(a.priceAgeSeconds)), PRICE_AGE_UNKNOWN - 1);

  const out = new Uint8Array(ATTESTATION_LEN);
  const view = new DataView(out.buffer);
  out.set(DOMAIN_TAG, 0);
  out.set(a.reserve.toBytes(), 8);
  out[40] = a.score;
  out[41] = severity;
  view.setUint32(42, priceAge, true);
  view.setBigInt64(46, BigInt(a.issuedAt), true);
  return out;
}

export function decodeAttestation(bytes: Uint8Array): Attestation {
  if (bytes.length !== ATTESTATION_LEN) throw new RangeError(`attestation must be ${ATTESTATION_LEN} bytes`);
  if (!DOMAIN_TAG.every((b, i) => bytes[i] === b)) throw new Error('not an OracleCanary attestation');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const severity = SEVERITIES[bytes[41]];
  if (severity === undefined || bytes[40] > 100) throw new RangeError('score or severity out of range');
  const priceAge = view.getUint32(42, true);
  return {
    reserve: new PublicKey(bytes.subarray(8, 40)),
    score: bytes[40],
    severity,
    priceAgeSeconds: priceAge === PRICE_AGE_UNKNOWN ? null : priceAge,
    issuedAt: Number(view.getBigInt64(46, true)),
  };
}

/** Signs with a 64-byte Ed25519 secret key (the `secretKey` of a web3.js Keypair). */
export function signAttestation(a: Attestation, secretKey: Uint8Array): SignedAttestation {
  const message = encodeAttestation(a);
  const { publicKey } = nacl.sign.keyPair.fromSecretKey(secretKey);
  return { message, signature: nacl.sign.detached(message, secretKey), publicKey: new PublicKey(publicKey) };
}

export function verifyAttestation(s: SignedAttestation): boolean {
  return nacl.sign.detached.verify(s.message, s.signature, s.publicKey.toBytes());
}

/**
 * Ed25519 precompile instruction carrying the signature. Its offsets all point into itself
 * (instruction index 0xFFFF), which is what oracle_guard requires.
 */
export function ed25519Instruction(s: SignedAttestation): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: s.publicKey.toBytes(),
    message: s.message,
    signature: s.signature,
  });
}

/**
 * Anchor's discriminator of `assert_oracle_healthy`: the first 8 bytes of sha256("global:assert_oracle_healthy").
 * A constant rather than computed, so this file also runs in a browser bundle (no node:crypto).
 */
export const ASSERT_ORACLE_HEALTHY_DISCRIMINATOR = new Uint8Array([187, 112, 238, 135, 86, 66, 118, 103]);

export function configAddress(programId: PublicKey = ORACLE_GUARD_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}

/** oracle_guard `assert_oracle_healthy` instruction; send it after `ed25519Instruction` in one transaction. */
export function assertOracleHealthyInstruction(params: {
  reserve: PublicKey;
  maxSeverity: Severity;
  maxAttestationAgeSeconds: number;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? ORACLE_GUARD_PROGRAM_ID;
  const data = Buffer.alloc(8 + 32 + 1 + 4);
  data.set(ASSERT_ORACLE_HEALTHY_DISCRIMINATOR, 0);
  params.reserve.toBuffer().copy(data, 8);
  data.writeUInt8(SEVERITIES.indexOf(params.maxSeverity), 40);
  data.writeUInt32LE(params.maxAttestationAgeSeconds, 41);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configAddress(programId), isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}
