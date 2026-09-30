import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { WalletPosition } from '../src/positions.js';
import { alertKeys, formatChange, formatCheck, summarizeWallet, walletChanges, type ReserveHealth } from '../src/walletAlerts.js';

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

describe('walletChanges', () => {
  const blocked = summarizeWallet(loan, reserves(['STALE:critical']));
  const healthy = summarizeWallet(loan, reserves([]));

  it('announces a newly blocked account once, then its recovery', () => {
    const first = walletChanges([], blocked);
    assert.deepEqual(first.map((c) => c.kind), ['blocked']);
    assert.deepEqual(walletChanges(alertKeys(blocked), blocked), [], 'nothing new');
    assert.deepEqual(walletChanges(alertKeys(blocked), healthy).map((c) => c.kind), ['recovered']);
  });

  it('never alerts on a market-closed pause', () => {
    const paused = summarizeWallet(loan, reserves(['STALE:critical', 'MARKET_CLOSED:info']));
    assert.deepEqual(walletChanges([], paused), []);
  });

  it('reports a blocked account that closed as recovered', () => {
    const empty = summarizeWallet([], new Map());
    const changes = walletChanges(alertKeys(blocked), empty);
    assert.deepEqual(changes.map((c) => [c.kind, c.summary]), [['recovered', null]]);
  });
});

describe('messages', () => {
  it('says which price holds the account up, what it blocks and links the wallet', () => {
    const [change] = walletChanges([], summarizeWallet(loan, reserves(['STALE:critical'])));
    const text = formatChange(WALLET, change, SITE);
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
