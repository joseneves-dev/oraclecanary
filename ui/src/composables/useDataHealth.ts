/*
 * How fresh OracleCanary's data is per protocol (GET /api/health), for the status lights in the
 * sidebar foot and the header pill. It says whether the indexer has read each protocol recently, not
 * whether the protocol itself works. One poll is shared by every component that uses it, and runs
 * only while one is mounted and the tab is visible.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { fetchHealth, type Health } from '@/api/client'
import { dateTime, duration, protocolName } from '@/lib/format'

/** In the sidebar's order. */
const PROTOCOL_IDS = ['kamino', 'jupiter-lend', 'marginfi'] as const

/** The indexer reads the chain every 5 minutes; the API calls data stale after 20. */
const REFRESH_MS = 60_000
const CLOCK_MS = 15_000

export type FreshnessState = 'loading' | 'ok' | 'stale' | 'unknown'
export type OverallState = 'loading' | 'ok' | 'warn' | 'down'

export interface FreshnessRow {
  id: string
  name: string
  state: FreshnessState
  /** Shown beside the name: the state in words, never left to the colour alone. */
  label: string
  title: string
}

const health = shallowRef<Health | null>(null)
/** The last call failed: the API could not be reached. */
const failed = ref(false)
/** When `health` was read, so ages keep counting between calls. */
const fetchedAt = ref(0)
const now = ref(Date.now())

let users = 0
let controller: AbortController | null = null
let refreshTimer: number | undefined
let clockTimer: number | undefined

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  try {
    health.value = await fetchHealth(controller.signal)
    fetchedAt.value = Date.now()
    failed.value = false
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') failed.value = true
  }
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void load()
}

function start(): void {
  void load()
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void load()
  }, REFRESH_MS)
  clockTimer = window.setInterval(() => (now.value = Date.now()), CLOCK_MS)
  document.addEventListener('visibilitychange', onVisible)
}

function stop(): void {
  controller?.abort()
  window.clearInterval(refreshTimer)
  window.clearInterval(clockTimer)
  document.removeEventListener('visibilitychange', onVisible)
}

// A failed call shows as unknown rather than the last answer, whose "ok" may no longer hold.
const unreachable = computed(() => failed.value || health.value?.database === 'unreachable')

const rows = computed<FreshnessRow[]>(() =>
  PROTOCOL_IDS.map((id) => {
    const name = protocolName(id)
    const p = health.value?.protocols.find((x) => x.protocol === id)
    if (unreachable.value) return { id, name, state: 'unknown', label: 'Unknown', title: `${name}: data freshness unknown` }
    if (!health.value) return { id, name, state: 'loading', label: '—', title: `${name}: checking…` }
    if (!p?.lastCheckedAt || p.ageSeconds == null) return { id, name, state: 'stale', label: 'No data yet', title: `${name}: not indexed yet` }
    const age = duration(Math.max(0, Math.round(p.ageSeconds + (now.value - fetchedAt.value) / 1000)))
    const title = `${name} data last indexed ${dateTime(p.lastCheckedAt)}`
    return p.status === 'ok' ? { id, name, state: 'ok', label: `${age} ago`, title } : { id, name, state: 'stale', label: `Stale · ${age}`, title }
  }),
)

const overall = computed<OverallState>(() => {
  if (unreachable.value) return 'down'
  if (!health.value) return 'loading'
  return rows.value.some((r) => r.state === 'stale') ? 'warn' : 'ok'
})

const downReason = computed(() => (health.value?.database === 'unreachable' ? 'Database unreachable' : "Can't reach the OracleCanary API"))

/** One line for tooltips and screen readers. */
const summary = computed(() => {
  if (overall.value === 'down') return downReason.value
  if (overall.value === 'loading') return 'Checking data freshness…'
  const behind = rows.value.filter((r) => r.state === 'stale')
  return behind.length ? `Indexer behind on ${behind.map((r) => `${r.name} (${r.label.replace('Stale · ', '')})`).join(', ')}` : 'Reading Solana mainnet · all data fresh'
})

export function useDataHealth() {
  onMounted(() => {
    if (users++ === 0) start()
  })
  onBeforeUnmount(() => {
    if (--users === 0) stop()
  })
  return { rows, overall, summary, downReason }
}
