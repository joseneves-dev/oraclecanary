/**
 * What a reserve's price means for the loans that use it. Shared by the Overview and My positions,
 * and by the same rules as the Telegram bot (indexer/src/walletAlerts.ts).
 */
export type PriceState = 'blocked' | 'paused' | 'overvalued' | 'weak' | 'ok'

/** Checks that make the protocol refuse a price (see indexer/src/health.ts); PRICE_DEVIATION prices are still used. */
export const BLOCKING = new Set(['STALE', 'NO_ORACLE', 'EMPTY_PRICE_ENTRY', 'DEPRECATED_PROVIDER'])

export function priceState(reserve: { checks: { code: string; severity: string }[]; severity: string }): PriceState {
  const critical = reserve.checks.filter((c) => c.severity === 'critical')
  const blocking = critical.filter((c) => BLOCKING.has(c.code))
  const closed = reserve.checks.some((c) => c.code === 'MARKET_CLOSED')
  // A stock paused by its closed market, with nothing else wrong, is expected rather than broken.
  if (blocking.length) return closed && blocking.every((c) => c.code === 'STALE') ? 'paused' : 'blocked'
  if (critical.some((c) => c.code === 'PRICE_DEVIATION')) return 'overvalued'
  if (critical.length || reserve.severity === 'warning') return 'weak'
  return 'ok'
}
