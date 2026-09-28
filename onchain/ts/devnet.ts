/**
 * Devnet operations for oracle_guard and the demo vault.
 *
 *   npx tsx ts/devnet.ts init <attestation public key>   point the guard at the API's signing key
 *   npx tsx ts/devnet.ts rotate <attestation public key> replace that key (set_authority)
 *   npx tsx ts/devnet.ts demo <reserve address> [amount]  try a demo_vault deposit with the API's
 *                                                         current attestation for that reserve
 *
 * Environment: KEYPAIR (default ~/.config/solana/oraclecanary-devnet.json, the upgrade authority),
 * RPC_URL (default devnet), API_URL (default https://oraclecanary.com).
 *
 * Transactions skip preflight, so a refused deposit still lands on-chain as a failed transaction that
 * anyone can inspect on the explorer.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

import { configAddress, decodeAttestation, ed25519Instruction, ORACLE_GUARD_PROGRAM_ID, verifyAttestation } from './attestation.js';

const DEMO_VAULT_PROGRAM_ID = new PublicKey('HGjvgPmovhBCeXVUrtNkrdQn1LadW6dyKo52A6MnhMi4');
const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const API_URL = (process.env.API_URL ?? 'https://oraclecanary.com').replace(/\/$/, '');
const KEYPAIR = process.env.KEYPAIR ?? join(homedir(), '.config', 'solana', 'oraclecanary-devnet.json');

/** oracle_guard errors (Anchor custom codes), from onchain/README.md. */
const GUARD_ERRORS: Record<number, string> = {
  6000: 'MissingSignature: no usable attestation signature in the transaction',
  6001: 'WrongSigner: the attestation is not signed by the configured OracleCanary key',
  6002: 'InvalidAttestation',
  6003: 'ReserveMismatch: the attestation is about another reserve',
  6004: 'StaleAttestation: the attestation is older than the vault accepts',
  6005: 'AttestationFromFuture',
  6006: 'Unhealthy: the reserve\'s oracle is worse than the vault accepts',
  6007: 'NotUpgradeAuthority',
  6008: 'NotAdmin',
};

const connection = new Connection(RPC_URL, 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, 'utf8'))));
const discriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends without preflight and reports how the transaction ended, with the guard's error if any.
 * Returns true only for a transaction seen to succeed; an outcome it cannot read is a failure.
 */
async function send(instructions: TransactionInstruction[]): Promise<boolean> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: payer.publicKey }).add(...instructions);
  // Signed here rather than by sendTransaction, which would swap in its own blockhash.
  tx.sign(payer);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  console.log(explorer(signature));
  const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  // Load-balanced RPCs can briefly answer null for a transaction they just confirmed.
  let result = null;
  for (let attempt = 0; attempt < 10 && !result; attempt++) {
    result = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!result) await sleep(1000);
  }
  const err = result?.meta ? result.meta.err : confirmation.value.err;
  if (!result && !err) {
    console.log('  UNKNOWN: confirmed, but the RPC did not return the transaction; check the explorer link');
    return false;
  }

  if (!err) {
    (result?.meta?.logMessages ?? []).filter((l) => l.startsWith('Program log: ')).forEach((l) => console.log(`  ${l.slice(13)}`));
    return true;
  }
  const custom = JSON.stringify(err).match(/"Custom":(\d+)/);
  const code = custom ? Number(custom[1]) : null;
  console.log(`  REFUSED: ${code !== null ? (GUARD_ERRORS[code] ?? `custom error ${code}`) : JSON.stringify(err)}`);
  return false;
}

async function init(authority: PublicKey): Promise<boolean> {
  const [programData] = PublicKey.findProgramAddressSync([ORACLE_GUARD_PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE);
  const data = Buffer.concat([discriminator('initialize'), authority.toBuffer()]);
  const ok = await send([
    new TransactionInstruction({
      programId: ORACLE_GUARD_PROGRAM_ID,
      keys: [
        { pubkey: configAddress(), isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: ORACLE_GUARD_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: programData, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  ]);
  console.log(ok ? `oracle_guard now accepts attestations signed by ${authority.toBase58()}` : 'initialize failed');
  return ok;
}

/** Replaces the accepted signing key (after the API's key changed or leaked); signed by the config admin. */
async function rotate(authority: PublicKey): Promise<boolean> {
  const ok = await send([
    new TransactionInstruction({
      programId: ORACLE_GUARD_PROGRAM_ID,
      keys: [
        { pubkey: configAddress(), isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([discriminator('set_authority'), authority.toBuffer()]),
    }),
  ]);
  console.log(ok ? `oracle_guard now accepts attestations signed by ${authority.toBase58()} only` : 'set_authority failed');
  return ok;
}

interface ApiAttestation {
  score: number;
  severity: string;
  priceAgeSeconds: number | null;
  issuedAt: string;
  message: string;
  signature: string;
  publicKey: string;
}

async function demo(reserve: PublicKey, amount: bigint): Promise<boolean> {
  const response = await fetch(`${API_URL}/api/reserves/${reserve.toBase58()}/attestation`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`The API answered ${response.status} for the attestation`);
  const body = (await response.json()) as ApiAttestation;

  const signed = {
    message: Buffer.from(body.message, 'base64'),
    signature: Buffer.from(body.signature, 'base64'),
    publicKey: new PublicKey(body.publicKey),
  };
  if (!verifyAttestation(signed)) throw new Error('The API returned a signature that does not verify');
  const attestation = decodeAttestation(signed.message);
  const ageSeconds = Math.floor(Date.now() / 1000) - attestation.issuedAt;
  console.log(`Attestation for ${reserve.toBase58()}: score ${attestation.score}, ${attestation.severity}, measured ${ageSeconds}s ago`);

  const [position] = PublicKey.findProgramAddressSync([Buffer.from('position'), reserve.toBuffer(), payer.publicKey.toBuffer()], DEMO_VAULT_PROGRAM_ID);
  const data = Buffer.alloc(16);
  discriminator('deposit').copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  console.log(`Depositing ${amount} into the demo vault (accepts severity up to "warning", attestations up to 600s old):`);
  return send([
    ed25519Instruction(signed),
    new TransactionInstruction({
      programId: DEMO_VAULT_PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: reserve, isSigner: false, isWritable: false },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: configAddress(), isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: ORACLE_GUARD_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  ]);
}

const [command, arg, amount] = process.argv.slice(2);
let ok: boolean;
if (command === 'init' && arg) ok = await init(new PublicKey(arg));
else if (command === 'rotate' && arg) ok = await rotate(new PublicKey(arg));
else if (command === 'demo' && arg) ok = await demo(new PublicKey(arg), BigInt(amount ?? 1000));
else {
  console.error('Usage: npx tsx ts/devnet.ts init <attestation public key> | rotate <attestation public key> | demo <reserve address> [amount]');
  ok = false;
}
// A refused deposit is the demo working as intended, but still a failed transaction: exit 1 either way.
if (!ok) process.exitCode = 1;
