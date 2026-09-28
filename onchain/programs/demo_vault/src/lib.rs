//! DEMO ONLY. A mock vault that records deposits without moving any tokens. It shows how a lending
//! integration calls `oracle_guard` via CPI and refuses to act when the reserve's oracle is unhealthy.

use anchor_lang::prelude::*;
use oracle_guard::cpi::accounts::AssertOracleHealthy;
use oracle_guard::program::OracleGuard;

declare_id!("HGjvgPmovhBCeXVUrtNkrdQn1LadW6dyKo52A6MnhMi4");

/// This vault accepts reserves whose worst open check is at most a warning.
pub const MAX_SEVERITY: u8 = oracle_guard::SEVERITY_WARNING;
/// This vault accepts attestations signed at most two minutes ago.
pub const MAX_ATTESTATION_AGE_SECONDS: u32 = 120;

#[program]
pub mod demo_vault {
    use super::*;

    /// Records a mock deposit of `amount` into `reserve`, after oracle_guard confirms the reserve's
    /// oracle is healthy.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let reserve = ctx.accounts.reserve.key();
        let attestation = oracle_guard::cpi::assert_oracle_healthy(
            CpiContext::new(
                ctx.accounts.oracle_guard_program.to_account_info(),
                AssertOracleHealthy {
                    config: ctx.accounts.guard_config.to_account_info(),
                    instructions: ctx.accounts.instructions.to_account_info(),
                },
            ),
            reserve,
            MAX_SEVERITY,
            MAX_ATTESTATION_AGE_SECONDS,
        )?
        .get();

        let position = &mut ctx.accounts.position;
        position.owner = ctx.accounts.user.key();
        position.reserve = reserve;
        position.deposited = position.deposited.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
        position.bump = ctx.bumps.position;
        msg!("demo deposit accepted: amount={} oracle_score={}", amount, attestation.score);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub reserve: Pubkey,
    pub deposited: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: only its address is used, as the reserve the attestation must name.
    pub reserve: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", reserve.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    /// CHECK: validated by oracle_guard (config PDA seeds).
    pub guard_config: UncheckedAccount<'info>,
    /// CHECK: validated by oracle_guard (Instructions sysvar address).
    pub instructions: UncheckedAccount<'info>,
    pub oracle_guard_program: Program<'info, OracleGuard>,
    pub system_program: Program<'info, System>,
}
