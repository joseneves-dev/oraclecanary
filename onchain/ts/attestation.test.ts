import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ed25519Program, Keypair, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import nacl from 'tweetnacl';
import {
  ORACLE_GUARD_PROGRAM_ID,
  assertOracleHealthyInstruction,
  attestationFromHealth,
  configAddress,
  decodeAttestation,
  ed25519Instruction,
  encodeAttestation,
  signAttestation,
  verifyAttestation,
  type Attestation,
} from './attestation.js';

/** Same vector as `golden_vector_matches_typescript_helper` in programs/oracle_guard/src/lib.rs. */
const GOLDEN: Attestation = {
  reserve: new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => i + 1)),
  score: 85,
  severity: 'warning',
  priceAgeSeconds: 12,
  issuedAt: 1_790_000_000,
};
const GOLDEN_HEX =
  '4f43414e41525931' +
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20' +
  '55' +
  '02' +
  '0c000000' +
  '803bb16a00000000';

test('encodes the documented wire format', () => {
  assert.equal(Buffer.from(encodeAttestation(GOLDEN)).toString('hex'), GOLDEN_HEX);
});

test('round-trips, with unknown price age as u32::MAX', () => {
  const a = { ...GOLDEN, priceAgeSeconds: null };
  const bytes = encodeAttestation(a);
  assert.equal(Buffer.from(bytes.subarray(42, 46)).toString('hex'), 'ffffffff');
  assert.deepEqual(decodeAttestation(bytes), a);
});

test('rejects out-of-range values', () => {
  assert.throws(() => encodeAttestation({ ...GOLDEN, score: 101 }));
  assert.throws(() => encodeAttestation({ ...GOLDEN, issuedAt: 1.5 }));
  const bytes = encodeAttestation(GOLDEN);
  bytes[41] = 4;
  assert.throws(() => decodeAttestation(bytes));
});

test('severity is the worst open check', () => {
  const reserve = Keypair.generate().publicKey;
  const health = {
    score: 35,
    checks: [{ severity: 'warning' as const }, { severity: 'critical' as const }],
    priceAgeSeconds: 900,
  };
  assert.equal(attestationFromHealth(reserve, health, 1).severity, 'critical');
  assert.equal(attestationFromHealth(reserve, { ...health, checks: [] }, 1).severity, 'ok');
});

test('Ed25519 instruction is self-contained and carries a valid signature', () => {
  const signer = Keypair.generate();
  const signed = signAttestation(GOLDEN, signer.secretKey);
  assert.ok(signed.publicKey.equals(signer.publicKey));
  assert.ok(verifyAttestation(signed));

  const ix = ed25519Instruction(signed);
  assert.ok(ix.programId.equals(Ed25519Program.programId));
  const d = ix.data;
  assert.equal(d[0], 1);
  const [sigOff, sigIx, pkOff, pkIx, msgOff, msgLen, msgIx] = [0, 1, 2, 3, 4, 5, 6].map((i) => d.readUInt16LE(2 + i * 2));
  assert.deepEqual([sigIx, pkIx, msgIx], [0xffff, 0xffff, 0xffff]);
  const msg = d.subarray(msgOff, msgOff + msgLen);
  assert.equal(msg.toString('hex'), GOLDEN_HEX);
  assert.ok(nacl.sign.detached.verify(msg, d.subarray(sigOff, sigOff + 64), d.subarray(pkOff, pkOff + 32)));
  assert.ok(new PublicKey(d.subarray(pkOff, pkOff + 32)).equals(signer.publicKey));
});

test('assert_oracle_healthy instruction layout', () => {
  const ix = assertOracleHealthyInstruction({ reserve: GOLDEN.reserve, maxSeverity: 'warning', maxAttestationAgeSeconds: 120 });
  assert.ok(ix.programId.equals(ORACLE_GUARD_PROGRAM_ID));
  assert.ok(ix.keys[0].pubkey.equals(configAddress()));
  assert.ok(ix.keys[1].pubkey.equals(SYSVAR_INSTRUCTIONS_PUBKEY));
  assert.equal(ix.data.length, 45);
  assert.ok(ix.data.subarray(8, 40).equals(GOLDEN.reserve.toBuffer()));
  assert.equal(ix.data[40], 2);
  assert.equal(ix.data.readUInt32LE(41), 120);
});
