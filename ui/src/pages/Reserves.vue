<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { fetchReservePage, type Reserve, type ReserveQuery } from '@/api/client'
import ReserveTable, { type SortKey } from '@/components/ReserveTable.vue'

const PAGE_SIZE = 25
const SORT_KEYS: SortKey[] = ['score', 'totalSupplyUsd', 'priceAgeSeconds', 'asset']
type Health = 'all' | 'issues' | 'critical'
type ProtocolFilter = 'all' | 'kamino' | 'jupiter-lend' | 'marginfi'

const PROTOCOL_LABEL: Record<ProtocolFilter, string> = { all: 'All protocols', kamino: 'Kamino', 'jupiter-lend': 'Jupiter Lend', marginfi: 'marginfi' }

/** Checks a reserve can fail, as the API's `check` filter takes them. */
const ISSUES: Record<string, string> = {
  STALE: 'Stale price',
  NEAR_STALE: 'Close to stale',
  DEPRECATED_PROVIDER: 'Shut-down provider',
  SOURCES_DIVERGE: 'Sources disagree',
  WIDE_CONFIDENCE: 'Pyth unsure of the price',
  NO_ORACLE: 'No oracle',
  EMPTY_PRICE_ENTRY: 'Empty price entry',
  UNREADABLE_ORACLE: 'Oracle not readable',
  NO_FALLBACK: 'No fallback oracle',
  MARKET_CLOSED: 'Market hours',
  FIXED_PRICE: 'Fixed price',
}

/** Price sources, as the API's `provider` filter takes them (the names in each reserve's `providers`). */
const PROVIDERS: Record<string, string> = {
  PythLazer: 'Pyth Lazer',
  Pyth: 'Pyth',
  Chainlink: 'Chainlink',
  ChainlinkDataStreams: 'Chainlink Data Streams',
  ChainlinkX: 'Chainlink (xStocks)',
  ChainlinkExchangeRate: 'Chainlink exchange rate',
  ChainlinkNAV: 'Chainlink NAV',
  SwitchboardOnDemand: 'Switchboard (shut down)',
  StakePool: 'Stake pool rate',
  FixedPrice: 'Fixed price',
}

/** Minimum supply thresholds, in USD. */
const MIN_SUPPLY: Record<string, string> = { '10000': '≥ $10K', '100000': '≥ $100K', '1000000': '≥ $1M', '10000000': '≥ $10M' }

interface ListState {
  search: string
  health: Health
  protocol: ProtocolFilter
  issue: string
  provider: string
  minSupply: string
  listedOnly: boolean
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  page: number
}

const route = useRoute()
const router = useRouter()

/**
 * The list state lives in the URL, so opening a reserve and going back restores the same
 * filters, sort and page, and a filtered view can be shared as a link.
 */
function readState(q: LocationQuery): ListState {
  const one = (key: string) => (typeof q[key] === 'string' ? (q[key] as string) : '')
  const page = Number.parseInt(one('page'), 10)
  return {
    search: one('q'),
    health: (['issues', 'critical'] as const).find((h) => h === one('health')) ?? 'all',
    protocol: (['kamino', 'jupiter-lend', 'marginfi'] as const).find((p) => p === one('protocol')) ?? 'all',
    // Own keys only: `in` would also accept inherited names such as "toString".
    issue: Object.hasOwn(ISSUES, one('issue')) ? one('issue') : '',
    provider: Object.hasOwn(PROVIDERS, one('provider')) ? one('provider') : '',
    minSupply: Object.hasOwn(MIN_SUPPLY, one('min')) ? one('min') : '',
    listedOnly: one('listed') !== 'all',
    sortKey: SORT_KEYS.find((k) => k === one('sort')) ?? 'score',
    sortDir: one('dir') === 'desc' ? 'desc' : 'asc',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

function writeState(next: Partial<ListState>) {
  const s = { ...state.value, ...next }
  const query: Record<string, string> = {}
  if (s.search) query.q = s.search
  if (s.health !== 'all') query.health = s.health
  if (s.protocol !== 'all') query.protocol = s.protocol
  if (s.issue) query.issue = s.issue
  if (s.provider) query.provider = s.provider
  if (s.minSupply) query.min = s.minSupply
  if (!s.listedOnly) query.listed = 'all'
  if (s.sortKey !== 'score') query.sort = s.sortKey
  if (s.sortDir !== 'asc') query.dir = s.sortDir
  if (s.page > 1) query.page = String(s.page)
  router.replace({ query })
}

const state = computed(() => readState(route.query))

const rows = ref<Reserve[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

/**
 * Health bands map onto the score: a critical check costs 50 points, so reserves at or
 * below 50 have a critical issue (or several warnings), and anything below 100 has at least one.
 */
function buildQuery(s: ListState): ReserveQuery {
  const query: ReserveQuery = { page: s.page, itemsPerPage: PAGE_SIZE, [`order[${s.sortKey}]`]: s.sortDir }
  if (s.listedOnly) query.listed = true
  if (s.protocol !== 'all') query.protocol = s.protocol
  if (s.search.trim()) query.asset = s.search.trim()
  if (s.health === 'issues') query['score[lt]'] = 100
  if (s.health === 'critical') query['score[lte]'] = 50
  if (s.issue) query.check = s.issue
  if (s.provider) query.provider = s.provider
  if (s.minSupply) query['totalSupplyUsd[gte]'] = Number(s.minSupply)
  return query
}

/** Whether any filter narrows the list, so "Clear filters" is worth showing. */
const filtered = computed(() => {
  const s = state.value
  return !!(s.search || s.health !== 'all' || s.protocol !== 'all' || s.issue || s.provider || s.minSupply || !s.listedOnly)
})

function clearFilters() {
  search.value = ''
  writeState({ search: '', health: 'all', protocol: 'all', issue: '', provider: '', minSupply: '', listedOnly: true, page: 1 })
}

const selectValue = (event: Event) => (event.target as HTMLSelectElement).value

let inFlight: AbortController | null = null
async function load(s: ListState) {
  // The route also changes when navigating away from this page; that is not a new query.
  if (route.name !== 'reserves') return
  inFlight?.abort()
  const controller = (inFlight = new AbortController())
  loading.value = true
  error.value = null
  try {
    const page = await fetchReservePage(buildQuery(s), controller.signal)
    rows.value = page.rows
    total.value = page.total
  } catch (e) {
    if (controller.signal.aborted) return
    rows.value = []
    total.value = 0
    error.value = (e as Error).message
  } finally {
    if (inFlight === controller) loading.value = false
  }
}

watch(state, load, { immediate: true, deep: true })
onBeforeUnmount(() => {
  inFlight?.abort()
  clearTimeout(searchTimer)
})

// The search box is edited locally and written to the URL after a pause in typing.
const search = ref(state.value.search)
watch(() => state.value.search, (value) => (search.value = value))
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  if (value === state.value.search) return
  searchTimer = setTimeout(() => writeState({ search: value, page: 1 }), 250)
})

function sortBy(key: SortKey) {
  const s = state.value
  const sortDir = s.sortKey === key ? (s.sortDir === 'asc' ? 'desc' : 'asc') : key === 'score' || key === 'asset' ? 'asc' : 'desc'
  writeState({ sortKey: key, sortDir, page: 1 })
}
</script>

<template>
  <div class="ax-page-head">
    <div class="ax-page-head__row">
      <div>
        <h1 class="ax-page-head__title">Reserves</h1>
        <p class="ax-page-head__subtitle">Every lending reserve, the oracles behind its price, and how healthy they are right now.</p>
      </div>
    </div>
  </div>

  <div class="ax-dash-grid">
    <section class="ax-card ax-col--12" aria-label="Lending reserves">
      <div class="ax-card__header toolbar">
        <div class="ax-card__titles">
          <h2 class="ax-card__title">{{ PROTOCOL_LABEL[state.protocol] }}</h2>
          <p class="ax-card__subtitle ax-num">{{ loading ? 'Loading…' : `${total} reserves` }}</p>
        </div>
        <div class="ax-card__actions toolbar__controls">
          <input v-model="search" type="search" class="ax-input ax-input--sm" placeholder="Search asset, e.g. SOL" aria-label="Search by asset" />
          <select
            class="ax-select ax-select--sm"
            aria-label="Filter by protocol"
            :value="state.protocol"
            @change="writeState({ protocol: ($event.target as HTMLSelectElement).value as ProtocolFilter, page: 1 })"
          >
            <option v-for="(label, value) in PROTOCOL_LABEL" :key="value" :value="value">{{ label }}</option>
          </select>
          <select
            class="ax-select ax-select--sm"
            aria-label="Filter by health"
            :value="state.health"
            @change="writeState({ health: ($event.target as HTMLSelectElement).value as Health, page: 1 })"
          >
            <option value="all">All health levels</option>
            <option value="issues">With issues (score &lt; 100)</option>
            <option value="critical">Serious (score ≤ 50)</option>
          </select>
          <select class="ax-select ax-select--sm" aria-label="Filter by issue" :value="state.issue" @change="writeState({ issue: selectValue($event), page: 1 })">
            <option value="">Any issue</option>
            <option v-for="(label, code) in ISSUES" :key="code" :value="code">{{ label }}</option>
          </select>
          <select
            class="ax-select ax-select--sm"
            aria-label="Filter by oracle provider"
            :value="state.provider"
            @change="writeState({ provider: selectValue($event), page: 1 })"
          >
            <option value="">Any oracle</option>
            <option v-for="(label, name) in PROVIDERS" :key="name" :value="name">{{ label }}</option>
          </select>
          <select
            class="ax-select ax-select--sm"
            aria-label="Filter by minimum supply"
            :value="state.minSupply"
            @change="writeState({ minSupply: selectValue($event), page: 1 })"
          >
            <option value="">Any supply</option>
            <option v-for="(label, value) in MIN_SUPPLY" :key="value" :value="value">{{ label }}</option>
          </select>
          <label class="toolbar__check">
            <input
              type="checkbox"
              class="ax-checkbox"
              :checked="state.listedOnly"
              @change="writeState({ listedOnly: ($event.target as HTMLInputElement).checked, page: 1 })"
            />
            Listed markets only
          </label>
          <button v-if="filtered" type="button" class="ax-btn ax-btn--ghost ax-btn--sm" @click="clearFilters">Clear filters</button>
        </div>
      </div>

      <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>
      <div v-else :aria-busy="loading" :class="{ loading }">
        <ReserveTable :rows="rows" :sort-key="state.sortKey" :sort-dir="state.sortDir" @sort="sortBy" />
        <p v-if="!loading && !rows.length" class="empty">No reserves match these filters.</p>
      </div>

      <div class="ax-card__footer pager">
        <span class="ax-num muted">Page {{ state.page }} of {{ pageCount }}</span>
        <nav class="ax-pagination" aria-label="Pagination">
          <button
            type="button"
            class="ax-pagination__prev"
            :disabled="loading || state.page <= 1"
            aria-label="Previous page"
            @click="writeState({ page: state.page - 1 })"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6l6 6" /></svg>
          </button>
          <button
            type="button"
            class="ax-pagination__next"
            :disabled="loading || state.page >= pageCount"
            aria-label="Next page"
            @click="writeState({ page: state.page + 1 })"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6l-6 6" /></svg>
          </button>
        </nav>
      </div>
    </section>
  </div>
</template>

<style scoped>
.toolbar {
  flex-wrap: wrap;
  gap: var(--ax-space-3);
}
/* The filters take the full width under the title and wrap, so each control keeps its own size. */
.toolbar__controls {
  flex: 1 1 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-2);
}
.toolbar__controls .ax-select {
  width: auto;
  min-width: 0;
}
.toolbar__controls .ax-input {
  width: 220px;
}
.toolbar__check {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}
.empty {
  padding: var(--ax-space-8);
  text-align: center;
  color: var(--ax-text-muted);
}
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
</style>
