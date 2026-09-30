import { usd } from './alerts.js';
import type { WalletPosition } from './positions.js';

/**
 * Judges a wallet's loan accounts from its positions and the health of the reserves behind them,
 * decides what to tell a chat, and words the Telegram messages. Pure, so the bot's decisions can be
 * tested.
 *
 * On Kamino and marginfi a loan account (obligation, marginfi account) acts on all its prices at
 * once: one price the protocol cannot use holds up the whole account. A tokenized stock whose price
 * only paused because its market closed is "paused", which is expected every night and is not
 * alerted on.
 */

/** Checks that make the protocol refuse a price (as on the web app's positions page). */
const BLOCKING = new Set(['STALE', 'NO_ORACLE', 'EMPTY_PRICE_ENTRY', 'DEPRECATED_PROVIDER']);
/** Telegram rejects messages longer than 4096 characters. */
const MAX_MESSAGE = 3900;

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
  /** A reserve of the account is not tracked (any more), so its state cannot be judged in full. */
  incomplete: boolean;
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
    const summary = accounts.get(p.account) ?? {
      account: p.account,
      protocol: p.protocol,
      market: reserve?.marketName ?? null,
      state: 'ok' as AccountState,
      blockers: [],
      depositsUsd: 0,
      loansUsd: 0,
      incomplete: false,
    };
    if (!reserve) {
      unmonitored++;
      summary.incomplete = true;
    }
    summary.market ??= reserve?.marketName ?? null;
    if (p.side === 'borrow') summary.loansUsd += p.usd;
    else summary.depositsUsd += p.usd;
    const state = reserve ? reserveState(reserve) : 'ok';
    if (state !== 'ok' && (state === 'blocked' || summary.state !== 'blocked')) {
      // A real failure outranks a closed market for the same account.
      if (state === 'blocked' && summary.state === 'paused') summary.blockers = [];
      summary.state = state;
      summary.blockers = [...new Set([...summary.blockers, reserve!.asset || reserve!.address])].sort();
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

/*
 * What a chat knows about a wallet is stored as a list of strings, one per loan account:
 *   "told:<account>:<blockers>"  the chat was told the account is held up by these prices;
 *   "seen:<account>:<blockers>"  found held up once, not yet told: an alert goes out only when the
 *                                next check agrees, so a price that crosses its limit for a moment
 *                                (or a stock settling just after the open) stays quiet.
 * Keys from the first version ("<account>:<blockers>") read as "told".
 */
interface Entry {
  kind: 'told' | 'seen';
  blockers: string;
}

function parseState(keys: string[]): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const key of keys) {
    const parts = key.split(':');
    const tagged = parts[0] === 'told' || parts[0] === 'seen';
    const account = tagged ? parts[1] : parts[0];
    const blockers = (tagged ? parts.slice(2) : parts.slice(1)).join(':');
    if (account) entries.set(account, { kind: tagged ? (parts[0] as Entry['kind']) : 'told', blockers });
  }
  return entries;
}

function serialize(entries: Map<string, Entry>): string[] {
  return [...entries].map(([account, e]) => `${e.kind}:${account}:${e.blockers}`).sort();
}

/** The state of a chat that has just been shown the wallet (e.g. on /watch): every held-up account counts as told. */
export function alertKeys(summary: WalletSummary): string[] {
  return serialize(new Map(summary.accounts.filter((a) => a.state === 'blocked').map((a) => [a.account, { kind: 'told' as const, blockers: a.blockers.join(',') }])));
}

export interface WalletChange {
  kind: 'blocked' | 'recovered';
  account: string;
  /** The account now (blocked), or null when it disappeared (e.g. closed) while blocked. */
  summary: AccountSummary | null;
  /** The state to store once this message is sent, so a later failure cannot make it repeat. */
  stateAfter: string[];
}

export interface WalletPlan {
  changes: WalletChange[];
  /** The state to store when every change was sent (or when there is none). */
  state: string[];
}

/**
 * What to tell a chat, from what it was told and the wallet now:
 * - an account held up on two checks in a row is announced once; an announced account whose
 *   blockers change is announced again at once;
 * - an announced account is "recovered" only when every price it uses is usable and all its
 *   reserves are tracked, or when it no longer exists; while paused by a closed market, or while one
 *   of its reserves is not tracked, it keeps its state.
 */
export function planWallet(previousKeys: string[], summary: WalletSummary): WalletPlan {
  const before = parseState(previousKeys);
  const after = new Map<string, Entry>();
  const changes: Omit<WalletChange, 'stateAfter'>[] = [];
  const present = new Set(summary.accounts.map((a) => a.account));

  for (const a of summary.accounts) {
    const was = before.get(a.account);
    const blockers = a.blockers.join(',');
    if (a.state === 'blocked') {
      const confirmed = was?.kind === 'told' || (was?.kind === 'seen' && was.blockers === blockers);
      if (confirmed) {
        after.set(a.account, { kind: 'told', blockers });
        if (!(was?.kind === 'told' && was.blockers === blockers)) changes.push({ kind: 'blocked', account: a.account, summary: a });
      } else {
        after.set(a.account, { kind: 'seen', blockers });
      }
    } else if (was?.kind === 'told' && (a.state === 'paused' || a.incomplete)) {
      after.set(a.account, was);
    } else if (was?.kind === 'told') {
      changes.push({ kind: 'recovered', account: a.account, summary: a });
    }
  }
  for (const [account, was] of before) {
    if (!present.has(account) && was.kind === 'told') changes.push({ kind: 'recovered', account, summary: null });
  }

  // Until its message is sent, a changed account keeps what the chat was told; then it takes its new state.
  const changed = new Set(changes.map((c) => c.account));
  const progress = new Map([...after].filter(([account]) => !changed.has(account)));
  for (const account of changed) {
    const was = before.get(account);
    if (was) progress.set(account, was);
  }
  const withState = changes.map((c) => {
    const next = after.get(c.account);
    if (next) progress.set(c.account, next);
    else progress.delete(c.account);
    return { ...c, stateAfter: serialize(progress) };
  });
  return { changes: withState, state: serialize(after) };
}

const PROTOCOL: Record<AccountSummary['protocol'], string> = { kamino: 'Kamino', marginfi: 'marginfi' };
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

function where(a: AccountSummary | null): string {
  if (!a) return '';
  return escapeHtml([PROTOCOL[a.protocol], a.market].filter(Boolean).join(' · '));
}

/** The DM for one change, in Telegram HTML. */
export function formatChange(wallet: string, change: Pick<WalletChange, 'kind' | 'summary'>, siteUrl: string): string {
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
  const head = [`<b>Wallet ${shortAddress(wallet)}</b>`];
  const link = ['', `${siteUrl}/positions?address=${wallet}`];
  if (!summary.accounts.length) return [...head, 'No deposits or loans on Kamino or marginfi.', ...link].join('\n');

  head.push(`Deposits ${usd(summary.depositsUsd)} · loans ${usd(summary.loansUsd)} · ${summary.accounts.length} loan account(s)`, '');
  const lines = summary.accounts.map((a) => {
    const status =
      a.state === 'blocked'
        ? `🔴 held up: the protocol cannot use the price of ${a.blockers.join(', ')}`
        : a.state === 'paused'
          ? `🔵 paused while the US market is closed (${a.blockers.join(', ')})`
          : '🟢 every price usable';
    return `${where(a)}: ${escapeHtml(status)}`;
  });
  const tail = summary.unmonitored ? ['', `${summary.unmonitored} position(s) in reserves OracleCanary does not track.`] : [];
  // Keeps within Telegram's limit for wallets with very many accounts; the link has the full list.
  const kept: string[] = [];
  let length = [...head, ...tail, ...link].join('\n').length;
  for (const line of lines) {
    if (length + line.length + 40 > MAX_MESSAGE) {
      kept.push(`… and ${lines.length - kept.length} more on the site.`);
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  return [...head, ...kept, ...tail, ...link].join('\n');
}
