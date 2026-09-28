import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import pg from 'pg';

import { alertFor, formatAlert, type HealthEvent } from './alerts.js';

/**
 * Posts alerts to a Telegram channel for new health events. Remembers the last event handled in
 * CURSOR_FILE, so a restart neither repeats alerts nor skips events recorded while it was down.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '@OracleCanaryAlerts';
const SITE_URL = (process.env.SITE_URL ?? 'https://oraclecanary.com').replace(/\/$/, '');
const MIN_SUPPLY_USD = Number(process.env.ALERT_MIN_SUPPLY_USD ?? 10_000);
const POLL_SECONDS = Number(process.env.ALERT_POLL_SECONDS ?? 60);
const CURSOR_FILE = process.env.ALERT_CURSOR_FILE ?? '/data/alerts-cursor';
// Telegram allows about 20 messages a minute in one channel.
const SEND_GAP_MS = 3_000;
const BATCH = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');

if (!TOKEN) {
  // Stay up without doing anything, so the stack runs before a bot is configured.
  console.log('TELEGRAM_BOT_TOKEN is not set: alerts are disabled.');
  await new Promise(() => {});
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (e) => console.error('Database connection error:', e.message));

async function readCursor(): Promise<string | null> {
  try {
    const value = (await readFile(CURSOR_FILE, 'utf8')).trim();
    return /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeCursor(id: string): Promise<void> {
  await mkdir(dirname(CURSOR_FILE), { recursive: true });
  await writeFile(CURSOR_FILE, id);
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

/** Sends a message, waiting out Telegram's rate limit when it asks to. Throws on any other failure. */
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
    throw new Error(`Telegram answered ${response.status}: ${body.description ?? 'no description'}`);
  }
  throw new Error('Telegram kept rate-limiting the message');
}

let cursor = await readCursor();
if (!cursor) {
  // First start: alert from now on rather than replaying the whole history.
  const { rows } = await pool.query('SELECT COALESCE(MAX(id), 0) AS id FROM reserve_health_event');
  cursor = String(rows[0].id);
  await writeCursor(cursor);
}
console.log(`Sending alerts to ${CHAT_ID} for events after #${cursor} (reserves with at least $${MIN_SUPPLY_USD} supplied).`);

for (;;) {
  try {
    for (const event of await eventsAfter(cursor)) {
      const alert = alertFor(event, MIN_SUPPLY_USD);
      if (alert) {
        await send(formatAlert(alert, SITE_URL));
        console.log(`Sent ${alert.kind} alert for ${event.asset} (event #${event.id})`);
        await sleep(SEND_GAP_MS);
      }
      // Moved past only once handled, so a failed send is retried on the next poll.
      cursor = event.id;
      await writeCursor(cursor);
    }
  } catch (e) {
    console.error(`Alerts: ${(e as Error).message}`);
  }
  await sleep(POLL_SECONDS * 1000);
}
