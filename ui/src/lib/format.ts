import type { Severity } from '@/api/client'

// Three significant digits everywhere (the front page uses the same function), so a figure reads
// the same on every page: $4.01B, $26.9M, $628M, $1.00K. Under $1,000 there is no unit to scale, so
// whole dollars; amounts under a dollar are only "<$1".
const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  minimumSignificantDigits: 3,
  maximumSignificantDigits: 3,
})
const wholeUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** $4.01B, $26.9M, $628M, $14, <$1, $0 */
export function usd(value: number): string {
  if (Math.abs(value) >= 1000) return compactUsd.format(value)
  if (value > 0 && value < 1) return '<$1'
  return wholeUsd.format(value)
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

/**
 * A check message as shown on screen: the API writes ages in seconds ("Price is 12987s old; the
 * protocol rejects prices older than 185s"), which read better as durations ("3h 36m", "3m 5s").
 * Under an hour the seconds are kept, so a price just past its limit never reads as equal to it.
 */
export function checkMessage(message: string): string {
  return message.replace(/\b(\d+)s\b/g, (_, digits: string) => {
    const seconds = Number(digits)
    if (seconds < 60 || seconds >= 3600) return duration(seconds)
    const rest = seconds % 60
    return rest ? `${Math.floor(seconds / 60)}m ${rest}s` : `${seconds / 60}m`
  })
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
  info: 'ax-badge--neutral',
  ok: 'ax-badge--success',
}

// Dates come from the API in UTC and are shown in the viewer's own time zone, which is named so
// the time cannot be mistaken for UTC. Day before month with the month spelled ("1 Oct, 00:57"),
// whatever the browser's locale, so no date can be read as January.
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const hourFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })

type DateInput = Date | string | number
const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value))
/** Some engines write September as "Sept" in en-GB; every other month has three letters. */
const short = (text: string) => text.replace('Sept', 'Sep')

/** 27 Sep, 22:55 GMT+1 */
export function dateTime(value: DateInput): string {
  return short(dateTimeFormat.format(toDate(value)))
}

/** 27 Sep, 22:55, for axis labels and lists where the zone is shown once nearby. */
export function dateHour(value: DateInput): string {
  return short(hourFormat.format(toDate(value)))
}

/** 27 Sep */
export function day(value: DateInput): string {
  return short(dayFormat.format(toDate(value)))
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
