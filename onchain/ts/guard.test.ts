import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ed25519Program, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';

import { ORACLE_GUARD_PROGRAM_ID, signAttestation } from './attestation.js';
import { fetchAttestation, withOracleGuard } from './guard.js';

const signer = Keypair.fromSeed(new Uint8Array(32).fill(1));
const reserveA = new PublicKey('2ZdH2K1J6WHGvfjfjX73VbcSh1cGUeTjFfNkYQXpcEHn');
const reserveB = new PublicKey('d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q');

/** A stand-in for the API: serves attestations signed by `key`, for the reserve asked or `servedFor`. */
function api(key = signer, servedFor?: PublicKey, severity: 'warning' | 'critical' = 'warning', ageSeconds = 30): typeof fetch {
  return (async (url: string | URL | Request) => {
    const reserve = servedFor ?? new PublicKey(String(url).split('/reserves/')[1].split('/')[0]);
    const issuedAt = Math.floor(Date.now() / 1000) - ageSeconds;
    const signed = signAttestation({ reserve, score: severity === 'critical' ? 35 : 85, severity, priceAgeSeconds: 12, issuedAt }, key.secretKey);
    return new Response(
      JSON.stringify({
        message: Buffer.from(signed.message).toString('base64'),
        signature: Buffer.from(signed.signature).toString('base64'),
        publicKey: signed.publicKey.toBase58(),
      }),
    );
  }) as typeof fetch;
}

describe('withOracleGuard', () => {
  it('puts a signature and a guard check per reserve in front of the caller’s instructions', async () => {
    const mine = SystemProgram.transfer({ fromPubkey: reserveA, toPubkey: reserveB, lamports: 1 });
    const out = await withOracleGuard([mine], { reserves: [reserveA, reserveB], signer: signer.publicKey, fetch: api() });

    assert.equal(out.length, 5);
    assert.ok(out[0].programId.equals(Ed25519Program.programId));
    assert.ok(out[1].programId.equals(Ed25519Program.programId));
    assert.ok(out[2].programId.equals(ORACLE_GUARD_PROGRAM_ID));
    assert.ok(out[3].programId.equals(ORACLE_GUARD_PROGRAM_ID));
    assert.equal(out[4], mine);
    // max severity "warning" (2) and a 900 s window, after the discriminator and the reserve.
    assert.equal(out[2].data[40], 2);
    assert.equal(out[2].data.readUInt32LE(41), 900);
  });

  it('lists a reserve given twice once', async () => {
    const out = await withOracleGuard([], { reserves: [reserveA, reserveA.toBase58()], signer: signer.publicKey, fetch: api() });
    assert.equal(out.length, 2);
  });

  it('refuses before sending when a price is already worse than allowed, or the attestation too old', async () => {
    await assert.rejects(withOracleGuard([], { reserves: [reserveA], signer: signer.publicKey, fetch: api(signer, undefined, 'critical') }), /critical .*worse than the warning allowed/);
    await assert.rejects(withOracleGuard([], { reserves: [reserveA], signer: signer.publicKey, fetch: api(signer, undefined, 'warning', 2_000) }), /over the 900s allowed/);
  });

  it('refuses an attestation from another signer, or about another reserve', async () => {
    await assert.rejects(fetchAttestation(reserveA, { signer: signer.publicKey, fetch: api(Keypair.generate()) }), /not /);
    await assert.rejects(fetchAttestation(reserveA, { signer: signer.publicKey, fetch: api(signer, reserveB) }), /is for/);
  });
});
