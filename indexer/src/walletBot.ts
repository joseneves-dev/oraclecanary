import 'dotenv/config';
import { writeFile } from 'node:fs/promises';

import { Connection, PublicKey } from '@solana/web3.js';
import pg from 'pg';

import { fetchWalletPositions } from './positions.js';
import { alertKeys, formatChange, formatCheck, shortAddress, summarizeWallet, walletChanges, type ReserveHealth, type WalletSummary } from './walletAlerts.js';

/**
 * The Telegram bot's private side: people send it /watch <wallet> and get a direct message when a
 * price behind that wallet's loan accounts can no longer be used (and when it recovers). The public
 * channel is posted by notify.ts; this reads the bot's messages with long polling and checks every
 * watched wallet every WATCH_INTERVAL_SECONDS. Read-only on the chain: wallets are only addresses.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const SITE_URL = (process.env.SITE_URL ?? 'https://oraclecanary.com').replace(/\/$/, '');
const RPC_URL = process.env.POSITIONS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const INTERVAL_SECONDS = Number(process.env.WATCH_INTERVAL_SECONDS ?? 300);
const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE ?? '/data/bot.heartbeat';
/** Kept small so a few chats cannot make every check cost a lot of RPC calls. */
const MAX_PER_CHAT = 5;
const MAX_WALLETS = Number(process.env.WATCH_MAX_WALLETS ?? 500);
/** /check runs a live lookup; one per chat every so often is plenty. */
const CHECK_COOLDOWN_MS = 15_000;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');
if (!TOKEN) {
  // Idle without a bot, like the alerts service, so the stack runs before one is configured.
  console.log('TELEGRAM_BOT_TOKEN is not set: the wallet bot is disabled.');
  setInterval(() => {}, 1 << 30);
  await new Promise(() => {});
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (e) => console.error('Database connection error:', e.message));
const connection = new Connection(RPC_URL, {
  commitment: 'confirmed',
  disableRetryOnRateLimit: true,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
});

// ---- Telegram ----

class ChatGone extends Error {}

async function telegram<T>(method: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } };
  if (data.ok) return data.result as T;
  if (response.status === 429 && data.parameters?.retry_after) {
    await sleep(data.parameters.retry_after * 1000);
    return telegram(method, body, timeoutMs);
  }
  // The user blocked the bot or deleted the chat: nothing more can be sent there.
  if (response.status === 403) throw new ChatGone(data.description ?? 'forbidden');
  // The URL holds the token, so only Telegram's description is reported.
  throw new Error(`Telegram ${method} answered ${response.status}: ${data.description ?? 'no description'}`);
}

const say = (chatId: number | string, text: string) =>
  telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });

// ---- Reading a wallet ----

async function reserveHealth(addresses: string[]): Promise<Map<string, ReserveHealth>> {
  if (!addresses.length) return new Map();
  const { rows } = await pool.query('SELECT address, asset, market_name, checks FROM lending_reserve WHERE address = ANY($1::text[])', [addresses]);
  return new Map(
    rows.map((r) => [
      r.address,
      {
        address: r.address,
        asset: r.asset,
        marketName: r.market_name,
        checks: (Array.isArray(r.checks) ? r.checks : []).map((c: { code: string; severity: string }) => `${c.code}:${c.severity}`),
      },
    ]),
  );
}

/** The wallet's loan accounts now, or null when a source could not be read (so nothing is concluded). */
async function summarize(wallet: string): Promise<WalletSummary | null> {
  const result = await fetchWalletPositions(connection, new PublicKey(wallet));
  if (result.failed.includes('kamino') || result.failed.includes('marginfi')) return null;
  const reserves = await reserveHealth([...new Set(result.positions.flatMap((p) => ('reserve' in p ? [p.reserve] : [])))]);
  return summarizeWallet(result.positions, reserves);
}

// ---- Commands ----

const HELP = [
  '<b>OracleCanary wallet alerts</b>',
  'I message you when a price behind one of your Kamino or marginfi loan accounts can no longer be used: then the account cannot borrow, withdraw or be liquidated. And again when it recovers.',
  '',
  '/watch &lt;wallet&gt; start watching a wallet (up to 5)',
  '/unwatch &lt;wallet&gt; stop',
  '/list your watched wallets',
  '/check &lt;wallet&gt; where it stands now',
  '',
  'Read-only: I only need the address, never a signature or a key.',
].join('\n');

const lastCheck = new Map<number, number>();

function parseAddress(arg: string | undefined): string | null {
  if (!arg || !ADDRESS.test(arg)) return null;
  try {
    return new PublicKey(arg).toBase58();
  } catch {
    return null;
  }
}

async function watch(chatId: number, wallet: string): Promise<void> {
  const { rows } = await pool.query(
    'SELECT (SELECT COUNT(*) FROM wallet_watch WHERE chat_id = $1) AS mine, (SELECT COUNT(DISTINCT wallet) FROM wallet_watch) AS total, EXISTS (SELECT 1 FROM wallet_watch WHERE chat_id = $1 AND wallet = $2) AS already',
    [chatId, wallet],
  );
  if (rows[0].already) return void (await say(chatId, `Already watching ${shortAddress(wallet)}. /check ${wallet} shows where it stands.`));
  if (Number(rows[0].mine) >= MAX_PER_CHAT) return void (await say(chatId, `You can watch up to ${MAX_PER_CHAT} wallets. /list shows them; /unwatch one first.`));
  if (Number(rows[0].total) >= MAX_WALLETS) return void (await say(chatId, 'The watch list is full for now. Please try again later.'));

  const summary = await summarize(wallet).catch(() => null);
  await pool.query(
    `INSERT INTO wallet_watch (chat_id, wallet, created_at, last_state, last_usd, last_checked_at)
     VALUES ($1, $2, NOW(), $3, $4, $5) ON CONFLICT (chat_id, wallet) DO NOTHING`,
    // What the user sees now is what they were told: only later changes are alerted.
    [chatId, wallet, JSON.stringify(summary ? alertKeys(summary) : []), summary ? summary.depositsUsd + summary.loansUsd : null, summary ? new Date() : null],
  );
  console.log(`Watching a wallet for chat ${chatId}`);
  await say(chatId, [`✅ Watching ${shortAddress(wallet)}. I'll message you if one of its loan accounts is held up by a price, and when it recovers.`, '', summary ? formatCheck(wallet, summary, SITE_URL) : "I couldn't read it right now; I'll check again in a few minutes."].join('\n'));
}

async function handle(chatId: number, text: string): Promise<void> {
  const [rawCommand, arg] = text.trim().split(/\s+/, 2);
  const command = rawCommand.split('@')[0].toLowerCase();

  // The site's "Get a DM" link opens the bot with the wallet as the start parameter.
  const deepLinked = command === '/start' ? parseAddress(arg) : null;
  if (deepLinked) return watch(chatId, deepLinked);
  if (command === '/start' || command === '/help') return void (await say(chatId, HELP));

  if (command === '/list') {
    const { rows } = await pool.query('SELECT wallet FROM wallet_watch WHERE chat_id = $1 ORDER BY created_at', [chatId]);
    return void (await say(chatId, rows.length ? ['<b>Watching</b>', ...rows.map((r) => `• <code>${r.wallet}</code>`)].join('\n') : 'Not watching any wallet yet. Send /watch followed by an address.'));
  }

  if (command === '/watch' || command === '/unwatch' || command === '/check') {
    const wallet = parseAddress(arg);
    if (!wallet) return void (await say(chatId, `Send ${command} followed by a Solana wallet address.`));

    if (command === '/watch') return watch(chatId, wallet);
    if (command === '/unwatch') {
      const { rowCount } = await pool.query('DELETE FROM wallet_watch WHERE chat_id = $1 AND wallet = $2', [chatId, wallet]);
      return void (await say(chatId, rowCount ? `Stopped watching ${shortAddress(wallet)}.` : `Wasn't watching ${shortAddress(wallet)}.`));
    }
    if (Date.now() - (lastCheck.get(chatId) ?? 0) < CHECK_COOLDOWN_MS) return void (await say(chatId, 'One check every few seconds, please.'));
    lastCheck.set(chatId, Date.now());
    const summary = await summarize(wallet).catch(() => null);
    return void (await say(chatId, summary ? formatCheck(wallet, summary, SITE_URL) : "I couldn't read that wallet right now. Try again in a minute."));
  }

  await say(chatId, HELP);
}

async function listen(): Promise<never> {
  let offset = 0;
  for (;;) {
    try {
      const updates = await telegram<{ update_id: number; message?: { chat: { id: number; type: string }; text?: string } }[]>(
        'getUpdates',
        { offset, timeout: 30, allowed_updates: ['message'] },
        40_000,
      );
      for (const update of updates) {
        offset = update.update_id + 1;
        const message = update.message;
        // Commands only in private chats: alerts are personal.
        if (!message?.text || message.chat.type !== 'private') continue;
        await handle(message.chat.id, message.text).catch((e) => {
          if (!(e instanceof ChatGone)) console.error(`Bot command: ${(e as Error).message}`);
        });
      }
    } catch (e) {
      console.error(`Bot updates: ${(e as Error).message}`);
      await sleep(5_000);
    }
  }
}

// ---- Checking watched wallets ----

async function checkAll(): Promise<void> {
  const { rows } = await pool.query('SELECT id, chat_id, wallet, last_state FROM wallet_watch ORDER BY wallet');
  const byWallet = new Map<string, { id: string; chatId: string; lastState: string[] }[]>();
  for (const r of rows) {
    const list = byWallet.get(r.wallet) ?? [];
    list.push({ id: r.id, chatId: r.chat_id, lastState: Array.isArray(r.last_state) ? r.last_state : [] });
    byWallet.set(r.wallet, list);
  }

  for (const [wallet, watchers] of byWallet) {
    let summary: WalletSummary | null = null;
    try {
      summary = await summarize(wallet);
    } catch (e) {
      console.warn(`Watch ${shortAddress(wallet)}: ${(e as Error).message}`);
    }
    // A wallet that could not be read keeps its state: no false "recovered".
    if (!summary) continue;
    const keys = alertKeys(summary);
    for (const w of watchers) {
      try {
        for (const change of walletChanges(w.lastState, summary)) await say(w.chatId, formatChange(wallet, change, SITE_URL));
      } catch (e) {
        if (e instanceof ChatGone) {
          await pool.query('DELETE FROM wallet_watch WHERE chat_id = $1', [w.chatId]);
          continue;
        }
        console.error(`Alert to chat ${w.chatId}: ${(e as Error).message}`);
        continue; // not recorded as told, so it is retried next time
      }
      await pool.query('UPDATE wallet_watch SET last_state = $2, last_usd = $3, last_checked_at = NOW() WHERE id = $1', [
        w.id,
        JSON.stringify(keys),
        summary.depositsUsd + summary.loansUsd,
      ]);
    }
    // Spreads the RPC calls out.
    await sleep(1_000);
  }
}

async function checkLoop(): Promise<never> {
  for (;;) {
    try {
      await checkAll();
      await writeFile(HEARTBEAT_FILE, new Date().toISOString()).catch(() => {});
    } catch (e) {
      console.error(`Wallet checks: ${(e as Error).message}`);
    }
    await sleep(INTERVAL_SECONDS * 1000);
  }
}

console.log(`Wallet bot: checking watched wallets every ${INTERVAL_SECONDS}s.`);
await Promise.all([listen(), checkLoop()]);
