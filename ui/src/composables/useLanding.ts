/*
 * Live data for the front page: every listed reserve, the latest incidents and configuration
 * changes, refreshed while the page is open. Every figure on the page is derived from here; a
 * value the API could not give is null, and the page shows "—" for it (never 0).
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  fetchAllReserves,
  fetchConfigChanges,
  fetchIncidents,
  type ConfigChange,
  type Reserve,
  type ReserveIncident,
  type Severity,
} from '@/api/client'
import { priceState } from '@/lib/priceState'
import { usd } from '@/lib/format'
import { openIncidents as listOpenIncidents } from '@/lib/incidents'

export const PROTOCOLS = [
  { id: 'kamino', name: 'Kamino' },
  { id: 'marginfi', name: 'marginfi' },
  { id: 'jupiter-lend', name: 'Jupiter Lend' },
] as const

export type ProtocolId = (typeof PROTOCOLS)[number]['id']

export function protocolName(id: string): string {
  return PROTOCOLS.find((p) => p.id === id)?.name ?? id
}

export const SEVERITIES: Severity[] = ['ok', 'info', 'warning', 'critical']

export const SEVERITY_LABEL: Record<Severity, string> = {
  ok: 'Healthy',
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}

/** Refresh a little more often than the indexer reads the chain (every 5 minutes). */
const REFRESH_MS = 120_000

/** The feed shows incidents with money at stake, the same bar as a Telegram alert. */
const FEED_MIN_USD = 10_000

export function useLanding() {
  const reserves = shallowRef<Reserve[] | null>(null)
  const incidents = shallowRef<ReserveIncident[] | null>(null)
  const changes = shallowRef<ConfigChange[] | null>(null)
  const now = ref(Date.now())
  /** The reserves could not be read (the last attempt failed and none are shown). */
  const reservesFailed = ref(false)

  let controller: AbortController | null = null
  let refreshTimer: number | undefined
  let clockTimer: number | undefined

  async function load(): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    // Each source settles on its own: one failing leaves the others on the page.
    const keep = <T>(p: Promise<T>, apply: (v: T) => void) =>
      p.then(apply).catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') console.warn('[landing]', e)
      })
    await Promise.all([
      keep(
        fetchAllReserves({ listed: true }, signal).catch((e: unknown) => {
          if ((e as Error)?.name !== 'AbortError' && !reserves.value) reservesFailed.value = true
          throw e
        }),
        (v) => {
          reserves.value = v
          reservesFailed.value = false
        },
      ),
      keep(fetchIncidents({ itemsPerPage: 30, 'totalSupplyUsd[gte]': FEED_MIN_USD }, signal), (v) => (incidents.value = v)),
      keep(fetchConfigChanges(5, signal), (v) => (changes.value = v)),
    ])
  }

  onMounted(() => {
    void load()
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    clockTimer = window.setInterval(() => (now.value = Date.now()), 15_000)
  })

  onBeforeUnmount(() => {
    controller?.abort()
    window.clearInterval(refreshTimer)
    window.clearInterval(clockTimer)
  })

  const totalUsd = computed(() => (reserves.value ? reserves.value.reduce((s, r) => s + (r.totalSupplyUsd ?? 0), 0) : null))

  const bySeverity = computed(() => {
    if (!reserves.value) return null
    const out: Record<Severity, number> = { ok: 0, info: 0, warning: 0, critical: 0 }
    for (const r of reserves.value) out[r.severity] = (out[r.severity] ?? 0) + 1
    return out
  })

  /** Most recent chain read across the reserves. */
  const lastChecked = computed(() => {
    if (!reserves.value?.length) return null
    let max = 0
    for (const r of reserves.value) {
      const t = Date.parse(r.checkedAt)
      if (t > max) max = t
    }
    return max || null
  })

  /** Reserves failing any of `codes`, and the deposits in them. */
  function failing(codes: string[], severity?: Severity): { count: number; usd: number } | null {
    if (!reserves.value) return null
    let count = 0
    let usd = 0
    for (const r of reserves.value) {
      if (r.checks.some((c) => codes.includes(c.code) && (!severity || c.severity === severity))) {
        count++
        usd += r.totalSupplyUsd ?? 0
      }
    }
    return { count, usd }
  }

  /**
   * Deposits whose price the protocol refuses right now (same rule as the dashboard: a blocking
   * check, reserves of $1K or more), and those only paused because their stock market is closed.
   */
  const unusable = computed(() => {
    if (!reserves.value) return null
    const out = { blockedUsd: 0, blockedCount: 0, pausedUsd: 0, pausedCount: 0 }
    for (const r of reserves.value) {
      const usd = r.totalSupplyUsd ?? 0
      if (usd < 1000) continue
      const state = priceState(r)
      if (state === 'blocked') {
        out.blockedUsd += usd
        out.blockedCount++
      } else if (state === 'paused') {
        out.pausedUsd += usd
        out.pausedCount++
      }
    }
    return out
  })

  /** Open incidents, as the app's Incidents page counts them: listed reserves that are critical now, holding $1 or more. */
  const open = computed(() => {
    if (!reserves.value) return null
    const rows = listOpenIncidents(reserves.value)
    return { count: rows.length, atStake: rows.filter((r) => (r.totalSupplyUsd ?? 0) >= FEED_MIN_USD).length }
  })

  const protocols = computed(() =>
    PROTOCOLS.map((p) => {
      const rows = reserves.value?.filter((r) => r.protocol === p.id) ?? null
      return {
        ...p,
        rows,
        count: rows ? rows.length : null,
        usd: rows ? rows.reduce((s, r) => s + (r.totalSupplyUsd ?? 0), 0) : null,
      }
    }),
  )

  return { open, unusable, reservesFailed, reserves, incidents, changes, now, totalUsd, bySeverity, lastChecked, protocols, failing, reload: load }
}

/* ── formatting (null → "—") ─────────────────────────────────────────── */

export const DASH = '—'

/** Money as the app shows it (lib/format usd), "—" when unknown. */
export function fmtUsd(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? DASH : usd(v)
}

export function fmtInt(v: number | null | undefined): string {
  return v == null ? DASH : v.toLocaleString('en-US')
}

export function fmtAgo(ms: number | null | undefined, now: number): string {
  if (ms == null) return DASH
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function fmtSeconds(s: number | null | undefined): string {
  if (s == null) return DASH
  if (s < 90) return `${Math.round(s)}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min`
  const h = s / 3600
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`
  return `${Math.round(h / 24)} d`
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
}

/** Human names for the check codes the page mentions. */
export const CHECK_LABEL: Record<string, string> = {
  STALE: 'Stale price',
  NEAR_STALE: 'Close to stale',
  NO_FALLBACK: 'No fallback',
  DEPRECATED_PROVIDER: 'Shut-down oracle',
  PRICE_DEVIATION: 'Price far from market',
  SOURCES_DIVERGE: 'Sources disagree',
  WIDE_CONFIDENCE: 'Pyth unsure',
  FIXED_PRICE: 'Fixed price',
  MARKET_CLOSED: 'Market closed',
  NO_ORACLE: 'No oracle',
  EMPTY_PRICE_ENTRY: 'Empty price entry',
  UNREADABLE_ORACLE: 'Unreadable oracle',
  WINDING_DOWN: 'Winding down',
}

export function checkLabel(code: string): string {
  return CHECK_LABEL[code] ?? code
}
