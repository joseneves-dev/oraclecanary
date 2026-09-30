import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { WalletPosition } from '../src/positions.js';
import { alertKeys, formatChange, formatCheck, planWallet, summarizeWallet, type ReserveHealth } from '../src/walletAlerts.js';

const WALLET = 'BKLBmxGDFrGK63QwhFgUcvqRQfWnTeJzUeMaoKcDGcvH';
const SITE = 'https://oraclecanary.com';

const reserve = (address: string, asset: string, checks: string[] = []): ReserveHealth => ({ address, asset, marketName: 'Superstate Market', checks });
const position = (reserve: string, side: 'deposit' | 'borrow', usd: number, account = 'loan-1'): WalletPosition => ({
  protocol: 'kamino',
  side,
  reserve,
  account,
  tokens: usd,
  usd,
  weight: side === 'borrow' ? 1 : 0.8,
});

const loan = [position('fwdi', 'deposit', 184_000), position('usdc', 'borrow', 25_000)];
const reserves = (fwdiChecks: string[]) => new Map([
  ['fwdi', reserve('fwdi', 'FWDI', fwdiChecks)],
  ['usdc', reserve('usdc', 'USDC')],
]);

describe('summarizeWallet', () => {
  it('holds up the whole loan account when one of its prices cannot be used', () => {
    const summary = summarizeWallet(loan, reserves(['STALE:critical', 'NO_FALLBACK:warning']));
    assert.equal(summary.accounts.length, 1);
    assert.equal(summary.accounts[0].state, 'blocked');
    assert.deepEqual(summary.accounts[0].blockers, ['FWDI']);
    assert.equal(summary.depositsUsd, 184_000);
    assert.equal(summary.loansUsd, 25_000);
  });

  it('calls a stock paused by its closed market paused, not blocked, and counts untracked reserves', () => {
    const summary = summarizeWallet([...loan, position('unknown', 'deposit', 5)], reserves(['STALE:critical', 'MARKET_CLOSED:info']));
    assert.equal(summary.accounts[0].state, 'paused');
    assert.equal(summary.unmonitored, 1);
  });

  it('ignores warnings and vault shares when judging accounts', () => {
    const vault: WalletPosition = { protocol: 'kamino-vault', side: 'deposit', vault: 'v', share: 0.1 };
    const summary = summarizeWallet([...loan, vault], reserves(['NO_FALLBACK:warning']));
    assert.equal(summary.accounts[0].state, 'ok');
    assert.equal(summary.accounts.length, 1);
  });
});

describe('planWallet', () => {
  const blocked = summarizeWallet(loan, reserves(['STALE:critical']));
  const healthy = summarizeWallet(loan, reserves([]));
  const paused = summarizeWallet(loan, reserves(['STALE:critical', 'MARKET_CLOSED:info']));
  const kinds = (plan: ReturnType<typeof planWallet>) => plan.changes.map((c) => c.kind);

  it('announces an account held up on two checks in a row, once, then its recovery', () => {
    const first = planWallet([], blocked);
    assert.deepEqual(kinds(first), [], 'one check is not enough');
    const second = planWallet(first.state, blocked);
    assert.deepEqual(kinds(second), ['blocked']);
    assert.deepEqual(kinds(planWallet(second.state, blocked)), [], 'already told');
    assert.deepEqual(kinds(planWallet(second.state, healthy)), ['recovered']);
  });

  it('stays quiet about a price that is blocked for a single check', () => {
    const seen = planWallet([], blocked);
    const back = planWallet(seen.state, healthy);
    assert.deepEqual(kinds(back), []);
    assert.deepEqual(back.state, []);
  });

  it('never alerts on a market-closed pause, and does not call blocked-to-paused recovered', () => {
    assert.deepEqual(kinds(planWallet([], paused)), []);
    const told = alertKeys(blocked);
    const plan = planWallet(told, paused);
    assert.deepEqual(kinds(plan), []);
    assert.deepEqual(plan.state, told);
  });

  it('keeps an announced account while one of its reserves is not tracked', () => {
    const told = alertKeys(blocked);
    const untracked = summarizeWallet(loan, new Map([['usdc', reserve('usdc', 'USDC')]]));
    assert.deepEqual(kinds(planWallet(told, untracked)), []);
  });

  it('reports an announced account that closed as recovered, and reads first-version state', () => {
    const empty = summarizeWallet([], new Map());
    assert.deepEqual(planWallet(alertKeys(blocked), empty).changes.map((c) => [c.kind, c.summary]), [['recovered', null]]);
    assert.deepEqual(kinds(planWallet(['loan-1:FWDI'], healthy)), ['recovered']);
  });

  it('gives the state to store after each message, so a failed later one does not repeat the first', () => {
    const second = { ...loan[0], account: 'loan-2' };
    const twoBlocked = summarizeWallet([...loan, second], reserves(['STALE:critical']));
    const seen = planWallet([], twoBlocked);
    const plan = planWallet(seen.state, twoBlocked);
    assert.deepEqual(kinds(plan), ['blocked', 'blocked']);
    assert.ok(plan.changes[0].stateAfter.some((k) => k.startsWith('told:loan-1:')));
    assert.ok(plan.changes[0].stateAfter.some((k) => k.startsWith('seen:loan-2:')), 'the second account is not marked told before its message');
    assert.deepEqual(plan.changes[1].stateAfter, plan.state);
  });
});

describe('messages', () => {
  it('says which price holds the account up, what it blocks and links the wallet', () => {
    const text = formatChange(WALLET, { kind: 'blocked', summary: summarizeWallet(loan, reserves(['STALE:critical'])).accounts[0] }, SITE);
    assert.match(text, /Your loan account is held up/);
    assert.match(text, /Wallet BKLB…GcvH · Kamino · Superstate Market/);
    assert.match(text, /cannot use the price of FWDI, so this account cannot borrow, withdraw or be liquidated/);
    assert.match(text, /Deposits \$184\.0K · loans \$25\.0K/);
    assert.ok(text.endsWith(`${SITE}/positions?address=${WALLET}`));
  });

  it('answers /check for an empty wallet and for a paused one', () => {
    assert.match(formatCheck(WALLET, summarizeWallet([], new Map()), SITE), /No deposits or loans on Kamino or marginfi/);
    const paused = formatCheck(WALLET, summarizeWallet(loan, reserves(['STALE:critical', 'MARKET_CLOSED:info'])), SITE);
    assert.match(paused, /paused while the US market is closed \(FWDI\)/);
  });
});
