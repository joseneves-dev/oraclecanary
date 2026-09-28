/**
 * Decides which recorded health changes are worth a public alert, and words them.
 *
 * An alert opens when a reserve gets a critical problem that is not explained away, and closes with a
 * "Recovered" when none is left. The only thing explained away is a tokenized stock's price going
 * stale because its market closed (the MARKET_CLOSED check); any other critical problem is alerted at
 * any time, and a stock still frozen once the market opens is too.
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
  /** The critical problems that are not explained away, after the change. */
  codes: string[];
}

const isMarketClosed = (keys: string[]) => keys.some((k) => k.startsWith('MARKET_CLOSED:'));

/** Critical codes that count as problems: a stale price is excused while its stock market is closed. */
export function problemCodes(keys: string[]): string[] {
  const critical = keys.filter((k) => k.endsWith(':critical')).map((k) => k.split(':')[0]);
  return isMarketClosed(keys) ? critical.filter((code) => code !== 'STALE') : critical;
}

/**
 * The alert a change calls for, or null.
 *
 * `open` says whether this reserve has an alert that has not been closed yet; the caller keeps that
 * state, opening it on "started" and "still-frozen" and closing it on "resolved". `minSupplyUsd` only
 * applies to opening an alert, so an open one is always closed, however small the reserve became.
 */
export function alertFor(event: HealthEvent, open: boolean, minSupplyUsd: number): Alert | null {
  const before = problemCodes(event.previousChecks);
  const after = problemCodes(event.checks);
  const added = after.filter((code) => !before.includes(code));

  if (open) {
    if (!after.length) return { kind: 'resolved', event, codes: [] };
    return added.length ? { kind: 'worsened', event, codes: after } : null;
  }
  if (!added.length || event.totalSupplyUsd < minSupplyUsd) return null;
  // A stale price that was excused a moment ago is now one the market opening did not fix.
  const unfrozen = added.length === 1 && added[0] === 'STALE' && isMarketClosed(event.previousChecks);
  return { kind: unfrozen ? 'still-frozen' : 'started', event, codes: after };
}

/** What each critical check means for users, in a few words. */
const CRITICAL_MEANING: Record<string, string> = {
  STALE: 'the price is stale, so the protocol rejects it',
  DEPRECATED_PROVIDER: 'the price depends on an oracle that has shut down',
  NO_ORACLE: 'no price oracle is configured',
  EMPTY_PRICE_ENTRY: 'the price chain points at an empty oracle entry',
  SOURCES_DIVERGE: 'its price sources disagree beyond the allowed limit',
  PRICE_DEVIATION: 'the oracle price is far above the market price, so collateral is overvalued',
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
export function formatAlert({ kind, event, codes }: Alert, siteUrl: string): string {
  const where = [PROTOCOL_NAMES[event.protocol] ?? event.protocol, event.marketName].filter(Boolean).join(' · ');

  let detail: string;
  if (kind === 'resolved') {
    detail = 'The price is usable again.';
  } else if (kind === 'still-frozen') {
    detail = 'The US stock market is open, but the price has not resumed: the protocol still rejects it.';
  } else {
    detail = `${codes.map((code) => CRITICAL_MEANING[code] ?? code).join('; ')}.`;
    detail = detail.charAt(0).toUpperCase() + detail.slice(1);
    if (codes.includes('STALE')) detail += ' Borrowing and liquidations fail until it updates.';
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
