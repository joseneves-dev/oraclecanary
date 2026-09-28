import 'dotenv/config';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import pg from 'pg';

import { alertFor, formatAlert, type HealthEvent } from './alerts.js';

/**
 * Posts alerts to a Telegram channel for new health events. Keeps the last event handled and the
 * reserves with an open alert in STATE_FILE, so a restart neither repeats alerts nor skips events
 * recorded while it was down, and every alert opened is eventually closed.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '@OracleCanaryAlerts';
const SITE_URL = (process.env.SITE_URL ?? 'https://oraclecanary.com').replace(/\/$/, '');
const MIN_SUPPLY_USD = Number(process.env.ALERT_MIN_SUPPLY_USD ?? 10_000);
const POLL_SECONDS = Number(process.env.CHECK_INTERVAL_SECONDS ?? 60);
const STATE_FILE = process.env.ALERT_STATE_FILE ?? '/data/alerts-cursor';
// Written after every poll that reached Telegram or had nothing to send; the container health check
// (src/healthcheck.ts) reports "unhealthy" when it gets old, e.g. while Telegram keeps failing.
const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE ?? '/data/alerts.heartbeat';
// Telegram allows about 20 messages a minute in one channel.
const SEND_GAP_MS = 3_000;
const BATCH = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');

if (!TOKEN) {
  // Stay up without doing anything, so the stack runs before a bot is configured. A pending promise
  // alone does not keep Node running; a timer does.
  console.log('TELEGRAM_BOT_TOKEN is not set: alerts are disabled.');
  setInterval(() => {}, 1 << 30);
  await new Promise(() => {});
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (e) => console.error('Database connection error:', e.message));

interface State {
  /** Id of the last event handled. */
  cursor: string;
  /** Reserves with an alert that has not been closed by a "Recovered" yet. */
  open: Set<string>;
}

async function readState(): Promise<State | null> {
  try {
    const text = (await readFile(STATE_FILE, 'utf8')).trim();
    // The first version stored only the cursor.
    if (/^\d+$/.test(text)) return { cursor: text, open: new Set() };
    const saved = JSON.parse(text) as { cursor?: unknown; open?: unknown };
    if (typeof saved.cursor !== 'string' || !/^\d+$/.test(saved.cursor)) return null;
    return { cursor: saved.cursor, open: new Set(Array.isArray(saved.open) ? saved.open.filter((a): a is string => typeof a === 'string') : []) };
  } catch {
    return null;
  }
}

async function writeState(state: State): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  // Written aside and renamed, so a crash mid-write cannot leave a half-written file.
  await writeFile(`${STATE_FILE}.tmp`, JSON.stringify({ cursor: state.cursor, open: [...state.open] }));
  await rename(`${STATE_FILE}.tmp`, STATE_FILE);
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

async function eventsAfter(id: string): Promise<HealthEvent[]> {
  const { rows } = await pool.query(
    `SELECT id, address, protocol, asset, market_name, previous_checks, checks, total_supply_usd
       FROM reserve_health_event WHERE id > $1 ORDER BY id LIMIT ${BATCH}`,
    [id],
  );
  return rows.map((r) => ({
    id: String(r.id),
    address: r.address,
    protocol: r.protocol,
    asset: r.asset,
    marketName: r.market_name,
    previousChecks: strings(r.previous_checks),
    checks: strings(r.checks),
    totalSupplyUsd: Number(r.total_supply_usd),
  }));
}

/** Telegram refused this message for good (bad request, bot not allowed in the chat): retrying is useless. */
class RejectedMessage extends Error {}

/** Sends a message, waiting out Telegram's rate limit when it asks to. */
async function send(text: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return;
    const body = (await response.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
    if (response.status === 429 && body.parameters?.retry_after) {
      await sleep(body.parameters.retry_after * 1000);
      continue;
    }
    // The description never contains the token; the URL, which does, is not logged.
    const message = `Telegram answered ${response.status}: ${body.description ?? 'no description'}`;
    throw response.status >= 400 && response.status < 500 ? new RejectedMessage(message) : new Error(message);
  }
  throw new Error('Telegram kept rate-limiting the message');
}

async function heartbeat(): Promise<void> {
  try {
    await writeFile(HEARTBEAT_FILE, new Date().toISOString());
  } catch (e) {
    console.warn(`Could not write the heartbeat file: ${(e as Error).message}`);
  }
}

let state = await readState();
if (!state) {
  // First start: alert from now on rather than replaying the whole history.
  const { rows } = await pool.query('SELECT COALESCE(MAX(id), 0) AS id FROM reserve_health_event');
  state = { cursor: String(rows[0].id), open: new Set() };
  await writeState(state);
}
console.log(`Sending alerts to ${CHAT_ID} for events after #${state.cursor} (reserves with at least $${MIN_SUPPLY_USD} supplied).`);

for (;;) {
  // A poll where Telegram refused a message is not a healthy one, even though it moved on.
  let rejected = false;
  try {
    for (const event of await eventsAfter(state.cursor)) {
      const alert = alertFor(event, state.open.has(event.address), MIN_SUPPLY_USD);
      if (alert) {
        try {
          await send(formatAlert(alert, SITE_URL));
          console.log(`Sent ${alert.kind} alert for ${event.asset} (event #${event.id})`);
          await sleep(SEND_GAP_MS);
        } catch (e) {
          // A message Telegram will never accept must not hold back every later alert.
          if (!(e instanceof RejectedMessage)) throw e;
          rejected = true;
          console.error(`Alerts: skipped event #${event.id}: ${e.message}`);
        }
        if (alert.kind === 'resolved') state.open.delete(event.address);
        else state.open.add(event.address);
      }
      // Moved past only once handled, so a failed send is retried on the next poll.
      state.cursor = event.id;
      await writeState(state);
    }
    if (!rejected) await heartbeat();
  } catch (e) {
    console.error(`Alerts: ${(e as Error).message}`);
  }
  await sleep(POLL_SECONDS * 1000);
}
