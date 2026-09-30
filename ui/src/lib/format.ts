import type { Severity } from '@/api/client'

const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

/** $1.2M, $26.9K, $14 */
export function usd(value: number): string {
  return compactUsd.format(value)
}

/** 45s, 12m, 3h 20m, 1d 20h */
export function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`
}

/** 7u3HeH…PfF */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function solscanAccount(address: string): string {
  return `https://solscan.io/account/${address}`
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
  ok: 'Healthy',
}

export const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'ax-badge--danger',
  warning: 'ax-badge--warning',
  info: 'ax-badge--info',
  ok: 'ax-badge--success',
}

// Dates come from the API in UTC and are shown in the viewer's own time zone, which is named so
// the time cannot be mistaken for UTC.
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
const dayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const hourFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })

type DateInput = Date | string | number
const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value))

/** 27 Sep, 22:55 GMT+1 */
export function dateTime(value: DateInput): string {
  return dateTimeFormat.format(toDate(value))
}

/** 27 Sep, 22:55, for axis labels and lists where the zone is shown once nearby. */
export function dateHour(value: DateInput): string {
  return hourFormat.format(toDate(value))
}

/** 27 Sep */
export function day(value: DateInput): string {
  return dayFormat.format(toDate(value))
}

/** 22:55:12 GMT+1 */
export function time(value: DateInput): string {
  return timeFormat.format(toDate(value))
}

/** How each protocol is named on screen. */
export const PROTOCOL_NAME: Record<string, string> = { kamino: 'Kamino', marginfi: 'marginfi', 'jupiter-lend': 'Jupiter Lend' }

/** Kamino, marginfi, Jupiter Lend; unknown ids are shown as they are. */
export function protocolName(protocol: string): string {
  return PROTOCOL_NAME[protocol] ?? protocol
}

/** The colour a value takes for each health level: only bad news is coloured. */
export const SEVERITY_TONE: Record<Severity, 'danger' | 'warning' | undefined> = {
  critical: 'danger',
  warning: 'warning',
  info: undefined,
  ok: undefined,
}
