//! oracle_guard: lets a Solana program refuse to act when OracleCanary has attested that a lending
//! reserve's oracle is unhealthy.
//!
//! OracleCanary signs a fixed-size attestation off-chain (see [`Attestation`]). The transaction carries
//! an Ed25519 precompile instruction that verifies that signature; `assert_oracle_healthy` finds it
//! through the Instructions sysvar and checks signer, reserve, freshness and severity.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{ed25519_program, sysvar::instructions as ix_sysvar};

pub mod ed25519;

declare_id!("444eBJsPgQGT6QfKtESvd21vZQa4YFsuKTodCokTasTT");

/// Seed of the single config PDA that stores the admin and the attestation signer.
pub const CONFIG_SEED: &[u8] = b"config";
/// First 8 bytes of every attestation message; also versions the format.
pub const DOMAIN_TAG: [u8; 8] = *b"OCANARY1";
/// Size in bytes of an encoded attestation message.
pub const ATTESTATION_LEN: usize = 54;
/// `price_age_seconds` value meaning the price age could not be read.
pub const PRICE_AGE_UNKNOWN: u32 = u32::MAX;
/// How far ahead of the cluster clock an attestation may be dated (signer and validator clocks drift).
pub const MAX_FUTURE_SKEW_SECONDS: i64 = 60;

pub const SEVERITY_OK: u8 = 0;
pub const SEVERITY_INFO: u8 = 1;
pub const SEVERITY_WARNING: u8 = 2;
pub const SEVERITY_CRITICAL: u8 = 3;

#[program]
pub mod oracle_guard {
    use super::*;

    /// Creates the config. Only the program's upgrade authority may call it, so nobody can
    /// front-run the deployer and install their own attestation signer.
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.authority = authority;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Rotates the key whose signatures are accepted as OracleCanary attestations.
    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.config.authority = new_authority;
        Ok(())
    }

    /// Succeeds only if this transaction carries a valid attestation for `reserve`, signed by the
    /// configured authority, issued at most `max_attestation_age_seconds` ago, with a severity no
    /// worse than `max_severity`. Returns the attestation so callers can apply their own policy
    /// (score, price age) on top.
    pub fn assert_oracle_healthy(
        ctx: Context<AssertOracleHealthy>,
        reserve: Pubkey,
        max_severity: u8,
        max_attestation_age_seconds: u32,
    ) -> Result<Attestation> {
        let attestation = load_attestation(
            &ctx.accounts.instructions.to_account_info(),
            &ctx.accounts.config.authority,
            &reserve,
        )?;
        let now = Clock::get()?.unix_timestamp;
        check_attestation(&attestation, now, max_severity, max_attestation_age_seconds)?;
        msg!(
            "oracle healthy: score={} severity={} issued_at={}",
            attestation.score,
            attestation.severity,
            attestation.issued_at
        );
        Ok(attestation)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// May rotate `authority`.
    pub admin: Pubkey,
    /// Ed25519 key that signs OracleCanary attestations.
    pub authority: Pubkey,
    pub bump: u8,
}

/// A signed statement about one reserve's oracle health.
///
/// Wire format (54 bytes, little-endian):
/// `domain_tag [u8;8] | reserve [u8;32] | score u8 | severity u8 | price_age_seconds u32 | issued_at i64`
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Attestation {
    pub reserve: Pubkey,
    /// 0-100, as computed by the indexer.
    pub score: u8,
    /// 0 ok, 1 info, 2 warning, 3 critical.
    pub severity: u8,
    /// Age of the oldest price in the reserve's price chain; `PRICE_AGE_UNKNOWN` if unreadable.
    pub price_age_seconds: u32,
    /// Unix seconds when OracleCanary measured the reserve's health (not when it signed).
    pub issued_at: i64,
}

impl Attestation {
    /// Parses a message; `None` if the length, tag or value ranges are wrong.
    pub fn parse(msg: &[u8]) -> Option<Self> {
        if msg.len() != ATTESTATION_LEN || msg[..8] != DOMAIN_TAG {
            return None;
        }
        let reserve = Pubkey::new_from_array(msg[8..40].try_into().ok()?);
        let score = msg[40];
        let severity = msg[41];
        if score > 100 || severity > SEVERITY_CRITICAL {
            return None;
        }
        let price_age_seconds = u32::from_le_bytes(msg[42..46].try_into().ok()?);
        let issued_at = i64::from_le_bytes(msg[46..54].try_into().ok()?);
        Some(Self { reserve, score, severity, price_age_seconds, issued_at })
    }

    pub fn to_bytes(&self) -> [u8; ATTESTATION_LEN] {
        let mut out = [0u8; ATTESTATION_LEN];
        out[..8].copy_from_slice(&DOMAIN_TAG);
        out[8..40].copy_from_slice(self.reserve.as_ref());
        out[40] = self.score;
        out[41] = self.severity;
        out[42..46].copy_from_slice(&self.price_age_seconds.to_le_bytes());
        out[46..54].copy_from_slice(&self.issued_at.to_le_bytes());
        out
    }
}

/// Scans every Ed25519 precompile instruction in the transaction and returns the newest valid
/// attestation for `reserve` signed by `authority`.
///
/// The Ed25519 precompile has already verified every signature before this program runs (a bad
/// signature fails the whole transaction), so a (public key, message) pair read from the exact
/// offsets the precompile used is authenticated.
pub fn load_attestation(
    instructions: &AccountInfo,
    authority: &Pubkey,
    reserve: &Pubkey,
) -> Result<Attestation> {
    let count = {
        let data = instructions.try_borrow_data()?;
        require!(data.len() >= 2, GuardError::MissingSignature);
        u16::from_le_bytes([data[0], data[1]]) as usize
    };
    let mut signed = Vec::new();
    for index in 0..count {
        let ix = ix_sysvar::load_instruction_at_checked(index, instructions)?;
        if ix.program_id == ed25519_program::ID {
            signed.extend(
                ed25519::self_contained_entries(&ix.data)
                    .into_iter()
                    .map(|(pk, msg)| (pk, msg.to_vec())),
            );
        }
    }
    select_attestation(signed.iter().map(|(pk, msg)| (*pk, msg.as_slice())), authority, reserve)
}

/// Picks the attestation to trust among verified (public key, message) pairs.
///
/// Errors, from most to least specific: `ReserveMismatch` if the authority signed attestations but
/// none for this reserve, `InvalidAttestation` if it signed only malformed messages, `WrongSigner`
/// if signatures exist but none from the authority, `MissingSignature` if there are none.
pub fn select_attestation<'a>(
    signed: impl Iterator<Item = (Pubkey, &'a [u8])>,
    authority: &Pubkey,
    reserve: &Pubkey,
) -> Result<Attestation> {
    let mut any_signature = false;
    let mut any_from_authority = false;
    let mut any_valid = false;
    let mut best: Option<Attestation> = None;
    for (signer, msg) in signed {
        any_signature = true;
        if signer != *authority {
            continue;
        }
        any_from_authority = true;
        let Some(attestation) = Attestation::parse(msg) else { continue };
        any_valid = true;
        if attestation.reserve != *reserve {
            continue;
        }
        if best.map_or(true, |b| attestation.issued_at > b.issued_at) {
            best = Some(attestation);
        }
    }
    match best {
        Some(a) => Ok(a),
        None if any_valid => err!(GuardError::ReserveMismatch),
        None if any_from_authority => err!(GuardError::InvalidAttestation),
        None if any_signature => err!(GuardError::WrongSigner),
        None => err!(GuardError::MissingSignature),
    }
}

/// Applies the caller's freshness and severity policy at cluster time `now`.
pub fn check_attestation(
    attestation: &Attestation,
    now: i64,
    max_severity: u8,
    max_attestation_age_seconds: u32,
) -> Result<()> {
    require!(
        attestation.issued_at <= now.saturating_add(MAX_FUTURE_SKEW_SECONDS),
        GuardError::AttestationFromFuture
    );
    let age = now.saturating_sub(attestation.issued_at);
    require!(age <= i64::from(max_attestation_age_seconds), GuardError::StaleAttestation);
    require!(attestation.severity <= max_severity, GuardError::Unhealthy);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ GuardError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::OracleGuard>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ GuardError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GuardError::NotAdmin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AssertOracleHealthy<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: constrained to the Instructions sysvar address.
    #[account(address = ix_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[error_code]
pub enum GuardError {
    #[msg("No Ed25519 signature instruction in this transaction")]
    MissingSignature,
    #[msg("No Ed25519 signature from the configured OracleCanary authority")]
    WrongSigner,
    #[msg("Signed message is not a valid OracleCanary attestation")]
    InvalidAttestation,
    #[msg("Attestation is for a different reserve")]
    ReserveMismatch,
    #[msg("Attestation is older than the allowed age")]
    StaleAttestation,
    #[msg("Attestation is dated too far in the future")]
    AttestationFromFuture,
    #[msg("Reserve oracle severity is worse than allowed")]
    Unhealthy,
    #[msg("Signer is not the program's upgrade authority")]
    NotUpgradeAuthority,
    #[msg("Signer is not the config admin")]
    NotAdmin,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Attestation {
        Attestation {
            reserve: Pubkey::new_unique(),
            score: 85,
            severity: SEVERITY_WARNING,
            price_age_seconds: 12,
            issued_at: 1_790_000_000,
        }
    }

    #[test]
    fn round_trips_wire_format() {
        let a = sample();
        assert_eq!(Attestation::parse(&a.to_bytes()), Some(a));
    }

    /// Same vector as `encodes the documented wire format` in ts/attestation.test.ts.
    #[test]
    fn golden_vector_matches_typescript_helper() {
        let mut reserve = [0u8; 32];
        for (i, b) in reserve.iter_mut().enumerate() {
            *b = i as u8 + 1;
        }
        let a = Attestation {
            reserve: Pubkey::new_from_array(reserve),
            score: 85,
            severity: SEVERITY_WARNING,
            price_age_seconds: 12,
            issued_at: 1_790_000_000,
        };
        let hex: String = a.to_bytes().iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            concat!(
                "4f43414e41525931",
                "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
                "55",
                "02",
                "0c000000",
                "803bb16a00000000"
            )
        );
    }

    #[test]
    fn rejects_bad_tag_length_and_ranges() {
        let a = sample();
        let mut bytes = a.to_bytes();
        bytes[0] = b'X';
        assert_eq!(Attestation::parse(&bytes), None);
        assert_eq!(Attestation::parse(&a.to_bytes()[..53]), None);
        let mut bytes = a.to_bytes();
        bytes[41] = 4;
        assert_eq!(Attestation::parse(&bytes), None);
        let mut bytes = a.to_bytes();
        bytes[40] = 101;
        assert_eq!(Attestation::parse(&bytes), None);
    }

    #[test]
    fn picks_newest_attestation_for_the_reserve() {
        let authority = Pubkey::new_unique();
        let older = sample();
        let newer = Attestation { issued_at: older.issued_at + 10, severity: SEVERITY_CRITICAL, ..older };
        let (o, n) = (older.to_bytes(), newer.to_bytes());
        let signed = [(authority, &n[..]), (authority, &o[..])];
        let got = select_attestation(signed.into_iter(), &authority, &older.reserve).unwrap();
        assert_eq!(got, newer);
    }

    #[test]
    fn freshness_and_severity_policy() {
        let a = sample();
        let now = a.issued_at + 30;
        assert!(check_attestation(&a, now, SEVERITY_WARNING, 30).is_ok());
        assert!(check_attestation(&a, now, SEVERITY_WARNING, 29).is_err());
        assert!(check_attestation(&a, now, SEVERITY_INFO, 60).is_err());
        assert!(check_attestation(&a, a.issued_at - MAX_FUTURE_SKEW_SECONDS - 1, SEVERITY_CRITICAL, 60).is_err());
    }
}
