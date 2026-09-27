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
