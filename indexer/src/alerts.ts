/**
 * Decides which recorded health changes are worth a public alert, and words them. An alert is sent
 * when a reserve's price becomes unusable or usable again: a critical check starts or all of them
 * stop. A tokenized stock that goes stale because its market closed is expected and is not an
 * alert, but one still frozen after the market opens is.
 */

/** A row of reserve_health_event, as read by the notifier. */
export interface HealthEvent {
  id: string;
  address: string;
  protocol: string;
  asset: string;
  marketName: string | null;
  previousChecks: string[];
  /** Lasting failed checks after the change, as "CODE:severity". */
  checks: string[];
  totalSupplyUsd: number;
}

export type AlertKind = 'started' | 'worsened' | 'still-frozen' | 'resolved';

export interface Alert {
  kind: AlertKind;
  event: HealthEvent;
}

const codesOf = (keys: string[], severity: string) => keys.filter((k) => k.endsWith(`:${severity}`)).map((k) => k.split(':')[0]);
const isMarketClosed = (keys: string[]) => keys.some((k) => k.startsWith('MARKET_CLOSED:'));

/** The alert a change calls for, or null. `minSupplyUsd` leaves out reserves with little at stake. */
export function alertFor(event: HealthEvent, minSupplyUsd: number): Alert | null {
  if (event.totalSupplyUsd < minSupplyUsd) return null;

  const before = codesOf(event.previousChecks, 'critical');
  const after = codesOf(event.checks, 'critical');
  const wasClosed = isMarketClosed(event.previousChecks);
  const closed = isMarketClosed(event.checks);

  if (!before.length && after.length) return closed ? null : { kind: 'started', event };
  if (before.length && !after.length) return wasClosed ? null : { kind: 'resolved', event };
  if (!before.length || !after.length) return null;
  if (wasClosed && !closed) return { kind: 'still-frozen', event };
  if (after.some((code) => !before.includes(code)) && !closed) return { kind: 'worsened', event };
  return null;
}

/** What each critical check means for users, in a few words. */
const CRITICAL_MEANING: Record<string, string> = {
  STALE: 'the price is stale, so the protocol rejects it',
  DEPRECATED_PROVIDER: 'the price depends on an oracle that has shut down',
  NO_ORACLE: 'no price oracle is configured',
  EMPTY_PRICE_ENTRY: 'the price chain points at an empty oracle entry',
  SOURCES_DIVERGE: 'its price sources disagree beyond the allowed limit',
};

const PROTOCOL_NAMES: Record<string, string> = { kamino: 'Kamino', marginfi: 'marginfi', 'jupiter-lend': 'Jupiter Lend' };

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function usd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

const HEADLINES: Record<AlertKind, string> = {
  started: '🔴 Price unusable',
  worsened: '🔴 New critical issue',
  'still-frozen': '🔴 Still frozen after the market opened',
  resolved: '🟢 Recovered',
};

/** The alert as a Telegram message in HTML parse mode. */
export function formatAlert({ kind, event }: Alert, siteUrl: string): string {
  const where = [PROTOCOL_NAMES[event.protocol] ?? event.protocol, event.marketName].filter(Boolean).join(' · ');
  const critical = codesOf(event.checks, 'critical');
  const reasons = critical.map((code) => CRITICAL_MEANING[code] ?? code);

  let detail: string;
  if (kind === 'resolved') {
    detail = 'The price is usable again.';
  } else if (kind === 'still-frozen') {
    detail = 'The US stock market is open, but the price has not resumed: the protocol still rejects it.';
  } else {
    detail = `${reasons.join('; ')}.`;
    detail = detail.charAt(0).toUpperCase() + detail.slice(1);
    if (critical.includes('STALE')) detail += ' Borrowing and liquidations fail until it updates.';
  }

  return [
    `<b>${HEADLINES[kind]}: ${escapeHtml(event.asset || event.address)}</b>`,
    escapeHtml(where),
    '',
    escapeHtml(detail),
    `Supply: ${usd(event.totalSupplyUsd)}`,
    '',
    `${siteUrl}/reserves/${event.address}`,
  ].join('\n');
}
