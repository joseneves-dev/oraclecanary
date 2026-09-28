//! End-to-end tests of oracle_guard and demo_vault on LiteSVM, using the programs built by
//! `anchor build` in ../target/deploy.

use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::error::InstructionError;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_address::Address as Pubkey;
use solana_sdk_ids::{bpf_loader_upgradeable, ed25519_program, system_program, sysvar};
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

const ORACLE_GUARD_ID: Pubkey = Pubkey::from_str_const("444eBJsPgQGT6QfKtESvd21vZQa4YFsuKTodCokTasTT");
const DEMO_VAULT_ID: Pubkey = Pubkey::from_str_const("HGjvgPmovhBCeXVUrtNkrdQn1LadW6dyKo52A6MnhMi4");
const NOW: i64 = 1_790_000_000;

const MISSING_SIGNATURE: u32 = 6000;
const WRONG_SIGNER: u32 = 6001;
const INVALID_ATTESTATION: u32 = 6002;
const RESERVE_MISMATCH: u32 = 6003;
const STALE_ATTESTATION: u32 = 6004;
const ATTESTATION_FROM_FUTURE: u32 = 6005;
const UNHEALTHY: u32 = 6006;
const NOT_UPGRADE_AUTHORITY: u32 = 6007;
const NOT_ADMIN: u32 = 6008;

const OK: u8 = 0;
const WARNING: u8 = 2;
const CRITICAL: u8 = 3;

// ---------- message and instruction encoding ----------

fn attestation(reserve: &Pubkey, score: u8, severity: u8, price_age: u32, issued_at: i64) -> Vec<u8> {
    let mut m = b"OCANARY1".to_vec();
    m.extend_from_slice(reserve.as_ref());
    m.push(score);
    m.push(severity);
    m.extend_from_slice(&price_age.to_le_bytes());
    m.extend_from_slice(&issued_at.to_le_bytes());
    assert_eq!(m.len(), 54);
    m
}

/// One signature entry: public key, signature, message, and the instruction index each of the three
/// offsets points into (`u16::MAX` = this instruction).
struct Entry {
    pubkey: [u8; 32],
    signature: [u8; 64],
    message: Vec<u8>,
    indexes: [u16; 3],
}

fn signed(signer: &Keypair, message: Vec<u8>) -> Entry {
    let signature: [u8; 64] = signer.sign_message(&message).into();
    Entry { pubkey: signer.pubkey().to_bytes(), signature, message, indexes: [u16::MAX; 3] }
}

/// Ed25519 precompile instruction in the same layout as web3.js `Ed25519Program`: header, offsets,
/// then per entry public key, signature, message.
fn ed25519_ix(entries: &[Entry]) -> Instruction {
    ed25519_ix_with_offsets(entries, |_, offsets| offsets)
}

/// Like `ed25519_ix`, but `patch` may rewrite each entry's seven offsets fields.
fn ed25519_ix_with_offsets(entries: &[Entry], patch: impl Fn(usize, [u16; 7]) -> [u16; 7]) -> Instruction {
    let header = 2 + 14 * entries.len();
    let mut payload = Vec::new();
    let mut offsets = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        let pk = (header + payload.len()) as u16;
        payload.extend_from_slice(&e.pubkey);
        let sig = (header + payload.len()) as u16;
        payload.extend_from_slice(&e.signature);
        let msg = (header + payload.len()) as u16;
        payload.extend_from_slice(&e.message);
        let fields = [sig, e.indexes[0], pk, e.indexes[1], msg, e.message.len() as u16, e.indexes[2]];
        offsets.push(patch(i, fields));
    }
    let mut data = vec![entries.len() as u8, 0];
    for fields in offsets {
        for v in fields {
            data.extend_from_slice(&v.to_le_bytes());
        }
    }
    data.extend_from_slice(&payload);
    Instruction { program_id: ed25519_program::ID, accounts: vec![], data }
}

fn discriminator(name: &str) -> Vec<u8> {
    Sha256::digest(format!("global:{name}").as_bytes())[..8].to_vec()
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &ORACLE_GUARD_ID).0
}

fn program_data_address() -> Pubkey {
    Pubkey::find_program_address(&[ORACLE_GUARD_ID.as_ref()], &bpf_loader_upgradeable::ID).0
}

fn initialize_ix(admin: &Pubkey, authority: &Pubkey) -> Instruction {
    let mut data = discriminator("initialize");
    data.extend_from_slice(authority.as_ref());
    Instruction {
        program_id: ORACLE_GUARD_ID,
        accounts: vec![
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(ORACLE_GUARD_ID, false),
            AccountMeta::new_readonly(program_data_address(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

fn set_authority_ix(admin: &Pubkey, new_authority: &Pubkey) -> Instruction {
    let mut data = discriminator("set_authority");
    data.extend_from_slice(new_authority.as_ref());
    Instruction {
        program_id: ORACLE_GUARD_ID,
        accounts: vec![AccountMeta::new(config_pda(), false), AccountMeta::new_readonly(*admin, true)],
        data,
    }
}

fn assert_ix(reserve: &Pubkey, max_severity: u8, max_age: u32) -> Instruction {
    let mut data = discriminator("assert_oracle_healthy");
    data.extend_from_slice(reserve.as_ref());
    data.push(max_severity);
    data.extend_from_slice(&max_age.to_le_bytes());
    Instruction {
        program_id: ORACLE_GUARD_ID,
        accounts: vec![
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new_readonly(sysvar::instructions::ID, false),
        ],
        data,
    }
}

fn position_pda(reserve: &Pubkey, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"position", reserve.as_ref(), user.as_ref()], &DEMO_VAULT_ID).0
}

fn deposit_ix(user: &Pubkey, reserve: &Pubkey, amount: u64) -> Instruction {
    let mut data = discriminator("deposit");
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: DEMO_VAULT_ID,
        accounts: vec![
            AccountMeta::new(*user, true),
            AccountMeta::new_readonly(*reserve, false),
            AccountMeta::new(position_pda(reserve, user), false),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new_readonly(sysvar::instructions::ID, false),
            AccountMeta::new_readonly(ORACLE_GUARD_ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

// ---------- environment ----------

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    authority: Keypair,
    reserve: Pubkey,
}

fn program_bytes(name: &str) -> Vec<u8> {
    let path = format!("{}/../target/deploy/{name}.so", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}; run `anchor build` first"))
}

/// Deploys both programs, makes `admin` the oracle_guard upgrade authority, and returns the
/// environment before `initialize`.
fn deployed() -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program(ORACLE_GUARD_ID, &program_bytes("oracle_guard")).unwrap();
    svm.add_program(DEMO_VAULT_ID, &program_bytes("demo_vault")).unwrap();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    // ProgramData header: u32 variant, u64 slot, Option<Pubkey> upgrade authority.
    let pd = program_data_address();
    let mut account: Account = svm.get_account(&pd).unwrap();
    account.data[12] = 1;
    account.data[13..45].copy_from_slice(admin.pubkey().as_ref());
    svm.set_account(pd, account).unwrap();

    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = NOW;
    svm.set_sysvar(&clock);

    Env { svm, admin, authority: Keypair::new(), reserve: Pubkey::new_unique() }
}

fn env() -> Env {
    let mut env = deployed();
    let ix = initialize_ix(&env.admin.pubkey(), &env.authority.pubkey());
    let admin = env.admin.insecure_clone();
    env.send(&[ix], &[&admin]).expect("initialize");
    env
}

impl Env {
    fn send(&mut self, ixs: &[Instruction], extra: &[&Keypair]) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let mut signers: Vec<&Keypair> = vec![&self.admin];
        signers.extend(extra.iter().copied().filter(|k| k.pubkey() != self.admin.pubkey()));
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(ixs, Some(&self.admin.pubkey()), &signers, self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    fn healthy(&self, severity: u8, issued_at: i64) -> Entry {
        signed(&self.authority, attestation(&self.reserve, 100, severity, 5, issued_at))
    }
}

fn expect_custom(result: Result<TransactionMetadata, FailedTransactionMetadata>, ix_index: u8, code: u32) {
    match result {
        Ok(meta) => panic!("expected error {code}, transaction succeeded: {:#?}", meta.logs),
        Err(failed) => assert_eq!(
            failed.err,
            TransactionError::InstructionError(ix_index, InstructionError::Custom(code)),
            "logs: {:#?}",
            failed.meta.logs
        ),
    }
}

// ---------- oracle_guard ----------

#[test]
fn healthy_attestation_passes_and_is_returned() {
    let mut env = env();
    let entry = env.healthy(OK, NOW - 10);
    let expected_msg = entry.message.clone();
    let meta = env.send(&[ed25519_ix(&[entry]), assert_ix(&env.reserve.clone(), WARNING, 60)], &[]).expect("healthy passes");
    // Borsh of the returned Attestation has the same field layout as the wire message minus the tag.
    assert_eq!(meta.return_data.program_id, ORACLE_GUARD_ID);
    assert_eq!(meta.return_data.data, expected_msg[8..].to_vec());
}

#[test]
fn warning_passes_when_allowed_and_fails_when_not() {
    let mut env = env();
    let reserve = env.reserve;
    let e = env.healthy(WARNING, NOW);
    env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]).expect("warning allowed");
    let e = env.healthy(WARNING, NOW);
    expect_custom(env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, OK, 60)], &[]), 1, UNHEALTHY);
}

#[test]
fn critical_fails() {
    let mut env = env();
    let reserve = env.reserve;
    let e = env.healthy(CRITICAL, NOW);
    expect_custom(env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]), 1, UNHEALTHY);
}

#[test]
fn stale_attestation_fails() {
    let mut env = env();
    let reserve = env.reserve;
    let e = env.healthy(OK, NOW - 61);
    expect_custom(env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]), 1, STALE_ATTESTATION);
    let e = env.healthy(OK, NOW - 60);
    env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]).expect("exactly max age passes");
}

#[test]
fn future_dated_attestation_fails() {
    let mut env = env();
    let reserve = env.reserve;
    let e = env.healthy(OK, NOW + 61);
    expect_custom(env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]), 1, ATTESTATION_FROM_FUTURE);
}

#[test]
fn wrong_signer_fails() {
    let mut env = env();
    let reserve = env.reserve;
    let impostor = Keypair::new();
    let e = signed(&impostor, attestation(&reserve, 100, OK, 5, NOW));
    expect_custom(env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]), 1, WRONG_SIGNER);
}

#[test]
fn missing_ed25519_instruction_fails() {
    let mut env = env();
    let reserve = env.reserve;
    expect_custom(env.send(&[assert_ix(&reserve, WARNING, 60)], &[]), 0, MISSING_SIGNATURE);
}

#[test]
fn reserve_mismatch_fails() {
    let mut env = env();
    let other = Pubkey::new_unique();
    let e = signed(&env.authority, attestation(&other, 100, OK, 5, NOW));
    let reserve = env.reserve;
    expect_custom(env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]), 1, RESERVE_MISMATCH);
}

#[test]
fn authority_signed_non_attestation_fails() {
    let mut env = env();
    let reserve = env.reserve;
    let mut msg = attestation(&reserve, 100, OK, 5, NOW);
    msg[..8].copy_from_slice(b"OTHERAPP");
    let e = signed(&env.authority, msg);
    expect_custom(env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]), 1, INVALID_ATTESTATION);
}

#[test]
fn tampered_message_is_rejected_by_the_precompile() {
    let mut env = env();
    let reserve = env.reserve;
    let mut e = env.healthy(CRITICAL, NOW);
    e.message[41] = OK;
    let result = env.send(&[ed25519_ix(&[e]), assert_ix(&reserve, WARNING, 60)], &[]);
    let failed = result.expect_err("a message changed after signing must not verify");
    assert!(
        matches!(failed.err, TransactionError::InstructionError(0, _)),
        "expected the Ed25519 instruction to fail, got {:?}",
        failed.err
    );
}

/// The classic offsets trick: the second Ed25519 instruction verifies a genuine signature that
/// lives in the first instruction (instruction index 0), while its own inline bytes carry a forged
/// "healthy" message in the usual position. The guard must ignore the forged bytes and judge the
/// reserve by the genuinely signed critical attestation. The forged one is newer, so a parser that
/// trusted the inline bytes would pick it and let the transaction through.
#[test]
fn offsets_pointing_at_another_instruction_are_ignored() {
    let mut env = env();
    let reserve = env.reserve;
    let genuine = env.healthy(CRITICAL, NOW - 30);
    let genuine_ix = ed25519_ix(&[Entry { indexes: [u16::MAX; 3], ..genuine }]);

    let forged = Entry {
        pubkey: env.authority.pubkey().to_bytes(),
        signature: [0u8; 64],
        message: attestation(&reserve, 100, OK, 5, NOW),
        indexes: [0, 0, 0],
    };
    // Offsets into instruction 0 have the same values as for a single-entry instruction.
    let trick_ix = ed25519_ix_with_offsets(&[forged], |_, f| f);

    expect_custom(env.send(&[genuine_ix, trick_ix, assert_ix(&reserve, WARNING, 60)], &[]), 2, UNHEALTHY);
}

/// Same trick without any self-contained signature: nothing verified is usable, so the guard
/// reports the signature as missing.
#[test]
fn only_cross_instruction_offsets_counts_as_missing_signature() {
    let mut env = env();
    let reserve = env.reserve;
    let genuine = env.healthy(OK, NOW);
    let pointing = Entry { indexes: [0, 0, 0], ..env.healthy(OK, NOW) };
    let ixs = [ed25519_ix(&[Entry { indexes: [0, 0, 0], ..genuine }]), ed25519_ix(&[pointing]), assert_ix(&reserve, WARNING, 60)];
    expect_custom(env.send(&ixs, &[]), 2, MISSING_SIGNATURE);
}

#[test]
fn newest_attestation_for_the_reserve_wins() {
    let mut env = env();
    let reserve = env.reserve;
    let old_ok = env.healthy(OK, NOW - 30);
    let new_critical = env.healthy(CRITICAL, NOW - 5);
    expect_custom(env.send(&[ed25519_ix(&[old_ok, new_critical]), assert_ix(&reserve, WARNING, 60)], &[]), 1, UNHEALTHY);
}

// ---------- config ----------

#[test]
fn initialize_requires_upgrade_authority() {
    let mut env = deployed();
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = initialize_ix(&stranger.pubkey(), &stranger.pubkey());
    expect_custom(env.send(&[ix], &[&stranger]), 0, NOT_UPGRADE_AUTHORITY);
}

#[test]
fn authority_rotation_is_admin_only_and_takes_effect() {
    let mut env = env();
    let reserve = env.reserve;
    let stranger = Keypair::new();
    let new_authority = Keypair::new();
    expect_custom(env.send(&[set_authority_ix(&stranger.pubkey(), &stranger.pubkey())], &[&stranger]), 0, NOT_ADMIN);

    let admin = env.admin.pubkey();
    env.send(&[set_authority_ix(&admin, &new_authority.pubkey())], &[]).expect("admin rotates");
    let old = env.healthy(OK, NOW);
    expect_custom(env.send(&[ed25519_ix(&[old]), assert_ix(&reserve, WARNING, 60)], &[]), 1, WRONG_SIGNER);
    let new = signed(&new_authority, attestation(&reserve, 100, OK, 5, NOW));
    env.send(&[ed25519_ix(&[new]), assert_ix(&reserve, WARNING, 60)], &[]).expect("new authority accepted");
}

// ---------- demo_vault (CPI) ----------

#[test]
fn demo_vault_deposits_only_when_oracle_is_healthy() {
    let mut env = env();
    let reserve = env.reserve;
    let user = env.admin.pubkey();

    let e = env.healthy(WARNING, NOW - 10);
    env.send(&[ed25519_ix(&[e]), deposit_ix(&user, &reserve, 500)], &[]).expect("deposit with healthy oracle");
    let position = env.svm.get_account(&position_pda(&reserve, &user)).unwrap();
    let deposited = u64::from_le_bytes(position.data[8 + 64..8 + 72].try_into().unwrap());
    assert_eq!(deposited, 500);

    let e = env.healthy(CRITICAL, NOW);
    expect_custom(env.send(&[ed25519_ix(&[e]), deposit_ix(&user, &reserve, 700)], &[]), 1, UNHEALTHY);
    expect_custom(env.send(&[deposit_ix(&user, &reserve, 700)], &[]), 0, MISSING_SIGNATURE);
    let e = env.healthy(OK, NOW - 601);
    expect_custom(env.send(&[ed25519_ix(&[e]), deposit_ix(&user, &reserve, 700)], &[]), 1, STALE_ATTESTATION);

    let position = env.svm.get_account(&position_pda(&reserve, &user)).unwrap();
    let deposited = u64::from_le_bytes(position.data[8 + 64..8 + 72].try_into().unwrap());
    assert_eq!(deposited, 500, "refused deposits must not change the position");

    // Exactly the vault's limit (600 s, the indexer's interval plus margin) is still accepted.
    let e = env.healthy(OK, NOW - 600);
    env.send(&[ed25519_ix(&[e]), deposit_ix(&user, &reserve, 100)], &[]).expect("deposit at the age limit");
    let position = env.svm.get_account(&position_pda(&reserve, &user)).unwrap();
    assert_eq!(u64::from_le_bytes(position.data[8 + 64..8 + 72].try_into().unwrap()), 600);
}
