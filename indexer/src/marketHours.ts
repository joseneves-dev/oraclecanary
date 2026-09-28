/**
 * US stock market regular hours (NYSE and Nasdaq: 9:30–16:00 New York time on trading days).
 * Oracle feeds for tokenized stocks follow the underlying stock, so many stop updating while the
 * market is closed and the lending protocol then rejects their price as stale.
 */

const ZONE = 'America/New_York';
const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;
const EARLY_CLOSE_MINUTE = 13 * 60;

/** Full-day closures, New York dates. Published by NYSE a year or more ahead. */
const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/** Days the market closes at 13:00, New York dates. */
const EARLY_CLOSES = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

/** Years HOLIDAYS covers; outside them holidays would pass for trading days, so nothing is assumed. */
export const CALENDAR_YEARS = new Set([2026, 2027]);

/**
 * Tokenized US stocks by mint. Listed explicitly rather than guessed from names, so an unrelated
 * token is never labelled as a stock.
 */
export const US_STOCK_MINTS = new Map([
  ['7GzQgf6DPo6ZANjnbhe9tNCpkGTv3zqHbsDx74jyQf9', 'FWDI'],
  ['2HehXG149TXuVptQhbiWAWDjbbuCsXSAtLTB5wc2aajK', 'GLXY'],
  ['XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', 'SPYx'],
  ['Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', 'QQQx'],
  ['Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', 'NVDAx'],
  ['XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', 'TSLAx'],
  ['XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', 'AAPLx'],
  ['XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', 'GOOGLx'],
  ['XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', 'MSTRx'],
  ['XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', 'CRCLx'],
  ['XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', 'HOODx'],
  ['Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH', 'STRCx'],
]);

export type ClosedReason = 'weekend' | 'holiday' | 'overnight';

export type MarketSession =
  | { open: true }
  | { open: false; reason: ClosedReason; lastClose: Date; nextOpen: Date };

interface Day {
  /** New York calendar date, YYYY-MM-DD. */
  date: string;
  year: number;
  month: number;
  day: number;
  weekday: number;
}

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

/** New York wall-clock time of an instant, as if it were UTC (for offset arithmetic). */
function wallClock(ms: number): number {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** The instant a New York wall-clock time happens. Market hours never fall in a DST gap. */
function nyTime(day: Day, minute: number): Date {
  const wall = Date.UTC(day.year, day.month - 1, day.day, 0, minute);
  const guess = wall - (wallClock(wall) - wall);
  return new Date(wall - (wallClock(guess) - guess));
}

function dayOf(ms: number): Day {
  const d = new Date(wallClock(ms));
  return {
    date: d.toISOString().slice(0, 10),
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

/** The same New York date `offset` days later; noon avoids DST edges. */
function addDays(day: Day, offset: number): Day {
  return dayOf(nyTime(day, 12 * 60).getTime() + offset * 86_400_000);
}

const isWeekend = (day: Day) => day.weekday === 0 || day.weekday === 6;

/** Opening and closing instants of a day's regular session, or null when the market is shut. */
function session(day: Day): { open: Date; close: Date } | null {
  if (!CALENDAR_YEARS.has(day.year)) throw new Error(`No US market holidays listed for ${day.year} (marketHours.ts)`);
  if (isWeekend(day) || HOLIDAYS.has(day.date)) return null;
  return { open: nyTime(day, OPEN_MINUTE), close: nyTime(day, EARLY_CLOSES.has(day.date) ? EARLY_CLOSE_MINUTE : CLOSE_MINUTE) };
}

/**
 * Whether the US stock market is in its regular session at `now`, and if not, since and until when.
 * Throws when the holidays around `now` are not listed.
 */
export function usStockSession(now: Date): MarketSession {
  const t = now.getTime();
  const today = dayOf(t);
  const todays = session(today);
  if (todays && todays.open.getTime() <= t && t < todays.close.getTime()) return { open: true };

  let lastClose: Date | null = null;
  let lastDay = today;
  for (let i = 0; i < 10 && !lastClose; i++) {
    const day = addDays(today, -i);
    const s = session(day);
    if (s && s.close.getTime() <= t) [lastClose, lastDay] = [s.close, day];
  }
  let nextOpen: Date | null = null;
  let nextDay = today;
  for (let i = 0; i < 10 && !nextOpen; i++) {
    const day = addDays(today, i);
    const s = session(day);
    if (s && s.open.getTime() > t) [nextOpen, nextDay] = [s.open, day];
  }
  if (!lastClose || !nextOpen) throw new Error(`No US market session found around ${now.toISOString()}`);

  // The reason is what the closed stretch spans: a holiday, a weekend, or just one night.
  let reason: ClosedReason = 'overnight';
  for (let day = addDays(lastDay, 1); day.date < nextDay.date; day = addDays(day, 1)) {
    if (!isWeekend(day)) {
      reason = 'holiday';
      break;
    }
    reason = 'weekend';
  }
  return { open: false, reason, lastClose, nextOpen };
}
