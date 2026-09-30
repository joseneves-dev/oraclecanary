import { usd } from './alerts.js';
import type { WalletPosition } from './positions.js';

/**
 * Judges a wallet's loan accounts from its positions and the health of the reserves behind them, and
 * words the Telegram messages about them. Pure, so the bot's decisions can be tested.
 *
 * On Kamino and marginfi a loan account (obligation, marginfi account) acts on all its prices at
 * once: one price the protocol cannot use holds up the whole account. A tokenized stock whose price
 * only paused because its market closed is "paused", which is expected every night and is not
 * alerted on.
 */

/** Checks that make the protocol refuse a price (as on the web app's positions page). */
const BLOCKING = new Set(['STALE', 'NO_ORACLE', 'EMPTY_PRICE_ENTRY', 'DEPRECATED_PROVIDER']);

export interface ReserveHealth {
  address: string;
  asset: string;
  marketName: string | null;
  /** Failing checks as "CODE:severity". */
  checks: string[];
}

export type AccountState = 'blocked' | 'paused' | 'ok';

export interface AccountSummary {
  account: string;
  protocol: 'kamino' | 'marginfi';
  market: string | null;
  state: AccountState;
  /** Assets whose price holds the account up, sorted. */
  blockers: string[];
  depositsUsd: number;
  loansUsd: number;
}

export interface WalletSummary {
  accounts: AccountSummary[];
  depositsUsd: number;
  loansUsd: number;
  /** Positions whose reserve is not tracked, so their health is unknown. */
  unmonitored: number;
}

function reserveState(reserve: ReserveHealth): AccountState {
  const blocking = reserve.checks.filter((k) => k.endsWith(':critical') && BLOCKING.has(k.split(':')[0]));
  if (!blocking.length) return 'ok';
  const closed = reserve.checks.some((k) => k.startsWith('MARKET_CLOSED:'));
  return closed && blocking.every((k) => k.startsWith('STALE:')) ? 'paused' : 'blocked';
}

export function summarizeWallet(positions: WalletPosition[], reserves: Map<string, ReserveHealth>): WalletSummary {
  const accounts = new Map<string, AccountSummary>();
  let unmonitored = 0;
  for (const p of positions) {
    // Vault shares have no loan account; the bot judges loan accounts only.
    if (!('reserve' in p)) continue;
    const reserve = reserves.get(p.reserve);
    if (!reserve) unmonitored++;
    const summary = accounts.get(p.account) ?? {
      account: p.account,
      protocol: p.protocol,
      market: reserve?.marketName ?? null,
      state: 'ok' as AccountState,
      blockers: [],
      depositsUsd: 0,
      loansUsd: 0,
    };
    summary.market ??= reserve?.marketName ?? null;
    if (p.side === 'borrow') summary.loansUsd += p.usd;
    else summary.depositsUsd += p.usd;
    const state = reserve ? reserveState(reserve) : 'ok';
    if (state !== 'ok') {
      if (state === 'blocked' || summary.state !== 'blocked') {
        // A real failure outranks a closed market for the same account.
        if (state === 'blocked' && summary.state === 'paused') summary.blockers = [];
        summary.state = state;
        summary.blockers = [...new Set([...summary.blockers, reserve!.asset || reserve!.address])].sort();
      }
    }
    accounts.set(p.account, summary);
  }
  const list = [...accounts.values()];
  return {
    accounts: list,
    depositsUsd: list.reduce((s, a) => s + a.depositsUsd, 0),
    loansUsd: list.reduce((s, a) => s + a.loansUsd, 0),
    unmonitored,
  };
}

/** What a chat was told, one key per blocked account: alerts go out only when this set changes. */
export function alertKeys(summary: WalletSummary): string[] {
  return summary.accounts
    .filter((a) => a.state === 'blocked')
    .map((a) => `${a.account}:${a.blockers.join(',')}`)
    .sort();
}

export interface WalletChange {
  kind: 'blocked' | 'recovered';
  account: string;
  /** The account now (blocked), or null when it disappeared (e.g. closed) while blocked. */
  summary: AccountSummary | null;
}

/**
 * The changes to tell a chat about, from the keys it was last told and the wallet now. A blocked
 * account whose blockers change is re-announced as blocked.
 */
export function walletChanges(previousKeys: string[], summary: WalletSummary): WalletChange[] {
  const now = alertKeys(summary);
  const before = new Set(previousKeys);
  const after = new Set(now);
  const accountOf = (key: string) => key.slice(0, key.indexOf(':'));
  const changes: WalletChange[] = [];
  for (const key of now) {
    if (before.has(key)) continue;
    const account = accountOf(key);
    changes.push({ kind: 'blocked', account, summary: summary.accounts.find((a) => a.account === account) ?? null });
  }
  const stillBlocked = new Set(now.map(accountOf));
  for (const key of previousKeys) {
    if (after.has(key)) continue;
    const account = accountOf(key);
    if (stillBlocked.has(account)) continue; // re-announced above with its new blockers
    changes.push({ kind: 'recovered', account, summary: summary.accounts.find((a) => a.account === account) ?? null });
  }
  return changes;
}

const PROTOCOL: Record<AccountSummary['protocol'], string> = { kamino: 'Kamino', marginfi: 'marginfi' };
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

function where(a: AccountSummary | null): string {
  if (!a) return '';
  return escapeHtml([PROTOCOL[a.protocol], a.market].filter(Boolean).join(' · '));
}

/** The DM for one change, in Telegram HTML. */
export function formatChange(wallet: string, change: WalletChange, siteUrl: string): string {
  const link = `${siteUrl}/positions?address=${wallet}`;
  const a = change.summary;
  if (change.kind === 'blocked' && a) {
    return [
      `<b>🔴 Your loan account is held up</b>`,
      `Wallet ${shortAddress(wallet)} · ${where(a)}`,
      '',
      escapeHtml(
        `The protocol cannot use the price of ${a.blockers.join(', ')}, so this account cannot borrow, withdraw or be liquidated until it updates.`,
      ),
      `Deposits ${usd(a.depositsUsd)} · loans ${usd(a.loansUsd)}`,
      '',
      link,
    ].join('\n');
  }
  return [
    `<b>🟢 Your loan account can act again</b>`,
    `Wallet ${shortAddress(wallet)}${a ? ` · ${where(a)}` : ''}`,
    '',
    a ? 'Every price it uses is usable again.' : 'The account no longer has open positions.',
    '',
    link,
  ].join('\n');
}

/** The answer to /check: where the wallet stands now. */
export function formatCheck(wallet: string, summary: WalletSummary, siteUrl: string): string {
  const lines = [`<b>Wallet ${shortAddress(wallet)}</b>`];
  if (!summary.accounts.length) {
    lines.push('No deposits or loans on Kamino or marginfi.');
  } else {
    lines.push(`Deposits ${usd(summary.depositsUsd)} · loans ${usd(summary.loansUsd)} · ${summary.accounts.length} loan account(s)`, '');
    for (const a of summary.accounts) {
      const status =
        a.state === 'blocked'
          ? `🔴 held up: the protocol cannot use the price of ${a.blockers.join(', ')}`
          : a.state === 'paused'
            ? `🔵 paused while the US market is closed (${a.blockers.join(', ')})`
            : '🟢 every price usable';
      lines.push(`${where(a)}: ${escapeHtml(status)}`);
    }
    if (summary.unmonitored) lines.push('', `${summary.unmonitored} position(s) in reserves OracleCanary does not track.`);
  }
  lines.push('', `${siteUrl}/positions?address=${wallet}`);
  return lines.join('\n');
}
