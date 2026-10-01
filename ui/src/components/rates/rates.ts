import type { LendingRate, LentAgainst } from '@/api/client'
import { protocolName } from '@/lib/format'

/** The parts of the collateral bar, in the order they are drawn; the rest is "unreadable or no oracle". */
export const COMPOSITION: { key: keyof Pick<LentAgainst, 'withFallbackShare' | 'singleFeedShare' | 'fixedPriceShare'>; label: string; tone: string }[] = [
  { key: 'withFallbackShare', label: 'With a fallback', tone: 'fallback' },
  { key: 'singleFeedShare', label: 'Single feed, no fallback', tone: 'single' },
  { key: 'fixedPriceShare', label: 'Fixed price', tone: 'fixed' },
]

/** 4.32% (two decimals for rates), 61% (none for shares); a share above zero never reads as 0%. */
export function pct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const percent = value * 100
  if (percent > 0 && percent < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}%`
  return `${percent.toFixed(digits)}%`
}

const SOURCE_LABEL: Record<string, string> = {
  'kamino-api': 'Kamino API',
  'jupiter-api': 'Jupiter API',
  'marginfi-onchain': 'marginfi bank, on-chain',
}

/** Where a rate comes from, as shown under it. */
export function sourceLabel(source: string | null): string {
  return source ? (SOURCE_LABEL[source] ?? source) : 'No source'
}

/** "Main Market" with its protocol, without repeating a protocol name the market already carries. */
export function poolName(r: LendingRate): { market: string; protocol: string } {
  const market = r.market.name ?? r.market.address
  const protocol = protocolName(r.protocol)
  return { market, protocol: market.toLowerCase().startsWith(protocol.toLowerCase().split(' ')[0]) ? '' : protocol }
}

/** A short "5m ago" for a timestamp. */
export function ago(value: string | null, now = Date.now()): string {
  if (!value) return '—'
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
