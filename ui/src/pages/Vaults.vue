<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter, type LocationQuery } from 'vue-router'
import { fetchVaults, type Severity, type Vault } from '@/api/client'
import EmptyState from '@/components/EmptyState.vue'
import KpiCard from '@/components/KpiCard.vue'
import SeverityBadge from '@/components/SeverityBadge.vue'
import { usd } from '@/lib/format'

const route = useRoute()
const router = useRouter()
const vaults = ref<Vault[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    vaults.value = await fetchVaults()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** Test and dust vaults hold next to nothing; they are listed only on request. */
const MIN_VAULT_USD = 10_000
/**
 * Filters and sort live in the URL, so they survive going back from a vault and can be shared. An
 * empty value removes its key, keeping links short.
 */
const one = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
function setQuery(patch: Record<string, string>) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query)) if (typeof value === 'string') query[key] = value
  for (const [key, value] of Object.entries(patch)) {
    if (value) query[key] = value
    else delete query[key]
  }
  router.replace({ query })
}

const showSmall = computed({
  get: () => one('small') === '1',
  set: (value: boolean) => setQuery({ small: value ? '1' : '' }),
})
const smallCount = computed(() => vaults.value.filter((v) => v.totalUsd < MIN_VAULT_USD).length)

type HealthFilter = '' | 'exposed' | 'critical' | 'issues'
const HEALTH_FILTERS: Record<Exclude<HealthFilter, ''>, string> = {
  exposed: 'With money at risk',
  critical: 'Critical',
  issues: 'Any issue',
}
const filters = computed(() => ({
  search: one('q'),
  curator: one('curator'),
  token: one('token'),
  health: (one('health') in HEALTH_FILTERS ? one('health') : '') as HealthFilter,
}))
/** Choices come from the vaults themselves, so a new curator or token appears without a code change. */
const curators = computed(() => [...new Set(vaults.value.map((v) => v.curator).filter((c): c is string => !!c))].sort())
const tokens = computed(() => [...new Set(vaults.value.map((v) => v.token).filter((t): t is string => !!t))].sort())

/** Typed search waits for a pause before it updates the URL, so every keystroke is not a history entry. */
const search = ref(one('q'))
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setQuery({ q: value.trim() }), 250)
})

const filtered = computed(() => {
  const f = filters.value
  return !!(f.search || f.curator || f.token || f.health)
})
function clearFilters() {
  search.value = ''
  clearTimeout(searchTimer)
  setQuery({ q: '', curator: '', token: '', health: '' })
}

const shown = computed(() => {
  const f = filters.value
  const needle = f.search.toLowerCase()
  return vaults.value.filter(
    (v) =>
      (showSmall.value || v.totalUsd >= MIN_VAULT_USD) &&
      (!needle || v.name.toLowerCase().includes(needle)) &&
      (!f.curator || v.curator === f.curator) &&
      (!f.token || v.token === f.token) &&
      (f.health !== 'exposed' || v.atRiskUsd > 0) &&
      (f.health !== 'critical' || v.worstSeverity === 'critical') &&
      (f.health !== 'issues' || v.worstSeverity === 'warning' || v.worstSeverity === 'critical'),
  )
})

const total = computed(() => shown.value.reduce((sum, v) => sum + v.totalUsd, 0))
const atRisk = computed(() => shown.value.reduce((sum, v) => sum + v.atRiskUsd, 0))
const exposed = computed(() => shown.value.filter((v) => v.atRiskUsd > 0))

/** Opens a vault from anywhere in its row, except where the row's own link already handles the click. */
function openVault(event: MouseEvent, address: string) {
  if ((event.target as HTMLElement).closest('a') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  // Selecting text in a row is not a click on it.
  if (window.getSelection()?.toString()) return
  router.push({ name: 'vault', params: { address } })
}
const selectValue = (event: Event) => (event.target as HTMLSelectElement).value
const share = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : '—')

// ---- Sorting: the whole list is loaded, so it runs in the browser. ----

type SortKey = 'name' | 'curator' | 'health' | 'totalUsd' | 'atRiskUsd' | 'reserves'

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Vault' },
  { key: 'curator', label: 'Curator' },
  { key: 'health', label: 'Health' },
  { key: 'totalUsd', label: 'Deposits', num: true },
  { key: 'atRiskUsd', label: 'At risk', num: true },
  { key: 'reserves', label: 'Reserves', num: true },
]
const SORT_KEYS = COLUMNS.map((c) => c.key)
const SEVERITY_RANK: Record<Severity, number> = { ok: 0, info: 1, warning: 2, critical: 3 }
/** Text columns read best A to Z; numbers and health, largest or worst first. */
const defaultDir = (key: SortKey) => (['name', 'curator'].includes(key) ? 'asc' : 'desc')

/** The sort lives in the URL, so it survives going back from a vault and can be shared. */
function readSort(q: LocationQuery): { sortKey: SortKey; sortDir: 'asc' | 'desc' } {
  const one = (key: string) => (typeof q[key] === 'string' ? (q[key] as string) : '')
  const sortKey = SORT_KEYS.find((k) => k === one('sort')) ?? 'totalUsd'
  const dir = one('dir')
  return { sortKey, sortDir: dir === 'asc' || dir === 'desc' ? dir : defaultDir(sortKey) }
}

const state = computed(() => readSort(route.query))

function sortBy(key: SortKey) {
  const s = state.value
  const sortDir = s.sortKey === key ? (s.sortDir === 'asc' ? 'desc' : 'asc') : defaultDir(key)
  setQuery({ sort: key !== 'totalUsd' ? key : '', dir: sortDir !== defaultDir(key) ? sortDir : '' })
}

const rows = computed(() => {
  const s = state.value
  const value = (v: Vault): string | number => {
    switch (s.sortKey) {
      case 'name':
        return v.name.toLowerCase()
      case 'curator':
        // Vaults without a recognised curator go last either way.
        return v.curator?.toLowerCase() ?? (s.sortDir === 'asc' ? '￿' : '')
      case 'health':
        return SEVERITY_RANK[v.worstSeverity]
      case 'reserves':
        return v.allocations.length
      default:
        return v[s.sortKey]
    }
  }
  const sign = s.sortDir === 'asc' ? 1 : -1
  // Ties fall back to size, so equal rows keep a meaningful order.
  return [...shown.value].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    return (x < y ? -sign : x > y ? sign : 0) || b.totalUsd - a.totalUsd
  })
})

const ariaSort = (key: SortKey) => (state.value.sortKey === key ? (state.value.sortDir === 'asc' ? 'ascending' : 'descending') : 'none')
</script>

<template>
  <!-- One root: the layout pads every top-level block, which would stack the spacing. -->
  <div class="page">
    <div class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <h1 class="ax-page-head__title">Curator vaults</h1>
          <p class="ax-page-head__subtitle">
            How much of each Kamino vault is lent into reserves whose oracle is unhealthy, or into markets where the collateral borrowers post has a
            price that cannot be used. Then bad loans cannot be liquidated, and the losses fall on the vault.
          </p>
        </div>
      </div>
    </div>

    <section v-if="error" class="ax-card">
      <EmptyState tone="error" title="Can't reach the API right now">
        The vaults come from the live API, which did not answer. Try again in a moment.
        <template #actions>
          <button type="button" class="ax-btn ax-btn--secondary ax-btn--sm" @click="load">Retry</button>
        </template>
      </EmptyState>
    </section>
    <div v-else class="ax-dash-grid" :aria-busy="loading">
      <KpiCard label="Vaults" :loading="loading" :value="String(shown.length)" :hint="showSmall ? 'Every Kamino curator vault with deposits' : 'Kamino curator vaults holding $10K or more'" />
      <KpiCard label="Deposits" :loading="loading" :value="usd(total)" />
      <KpiCard
        label="At risk now"
        :loading="loading"
        :value="usd(atRisk)"
       
        :tone="atRisk > 0 ? 'danger' : undefined"
        :hint="loading ? undefined : atRisk > 0 ? `${share(atRisk, total)} of deposits` : `None of ${usd(total)} is in an unhealthy reserve or market`"
      />
      <KpiCard
        label="Vaults exposed"
        :loading="loading"
        :value="String(exposed.length)"
       
        :tone="exposed.length ? 'danger' : undefined"
        hint="With money in an unhealthy reserve or market"
      />

      <section class="ax-card ax-col--12 pilot" aria-label="Alerts for your vault">
        <div>
          <h2 class="ax-card__title">Curate a vault?</h2>
          <p class="muted">
            Private Telegram alerts (webhooks on request) for exactly the reserves your vault lends into and the collateral in their markets, within
            minutes of a problem, before your depositors notice. Free pilot for the first curators.
          </p>
        </div>
        <div class="pilot__actions">
          <a class="ax-btn ax-btn--primary ax-btn--sm" href="mailto:hello@oraclecanary.com?subject=Vault%20alerts%20pilot">Request a pilot</a>
          <a class="ax-btn ax-btn--secondary ax-btn--sm" href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener">Public alerts</a>
        </div>
      </section>

      <section class="ax-card ax-col--12" aria-label="Vaults">
        <div class="ax-card__header toolbar">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">All vaults</h2>
            <p class="ax-card__subtitle">
              <span v-if="loading" class="ax-skeleton ax-skeleton--line count-skeleton" aria-hidden="true"></span>
              <template v-else><span class="ax-num">{{ shown.length }}</span> vaults</template> · exposure is recomputed every few minutes from
              live oracle data
            </p>
          </div>
          <div class="ax-card__actions toolbar__controls">
            <input v-model="search" type="search" class="ax-input ax-input--sm" placeholder="Search vault, e.g. USDC" aria-label="Search by vault name" />
            <select class="ax-select ax-select--sm" aria-label="Filter by curator" :value="filters.curator" @change="setQuery({ curator: selectValue($event) })">
              <option value="">All curators</option>
              <option v-for="c in curators" :key="c" :value="c">{{ c }}</option>
            </select>
            <select class="ax-select ax-select--sm" aria-label="Filter by token" :value="filters.token" @change="setQuery({ token: selectValue($event) })">
              <option value="">Any token</option>
              <option v-for="t in tokens" :key="t" :value="t">{{ t }}</option>
            </select>
            <select class="ax-select ax-select--sm" aria-label="Filter by health" :value="filters.health" @change="setQuery({ health: selectValue($event) })">
              <option value="">All health levels</option>
              <option v-for="(label, value) in HEALTH_FILTERS" :key="value" :value="value">{{ label }}</option>
            </select>
            <label v-if="smallCount" class="toggle">
              <input v-model="showSmall" type="checkbox" class="ax-checkbox" />
              Show {{ smallCount }} vaults under $10K
            </label>
            <button v-if="filtered" type="button" class="ax-btn ax-btn--ghost ax-btn--sm" @click="clearFilters">Clear filters</button>
          </div>
        </div>
        <div class="ax-table-wrap">
          <table class="ax-table ax-table--hover" style="min-width: 760px">
            <thead class="ax-table__head">
              <tr>
                <th
                  v-for="col in COLUMNS"
                  :key="col.key"
                  scope="col"
                  class="ax-table__th"
                  :class="{ 'ax-table__th--num': col.num }"
                  :aria-sort="ariaSort(col.key)"
                >
                  <button type="button" class="sort-button" :class="{ 'sort-button--active': state.sortKey === col.key }" @click="sortBy(col.key)">
                    {{ col.label }}
                    <svg v-if="state.sortKey !== col.key" class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9l4 -4l4 4" /><path d="M16 15l-4 4l-4 -4" /></svg>
                    <svg v-else-if="state.sortDir === 'asc'" class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6 -6l6 6" /></svg>
                    <svg v-else class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6" /></svg>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in rows" :key="v.address" class="ax-table__row row-link" @click="openVault($event, v.address)">
                <td class="ax-table__td">
                  <RouterLink :to="{ name: 'vault', params: { address: v.address } }" class="name">{{ v.name }}</RouterLink>
                  <div class="muted">{{ v.token ?? '' }}</div>
                </td>
                <td class="ax-table__td muted">{{ v.curator ?? '—' }}</td>
                <td class="ax-table__td"><SeverityBadge :severity="v.worstSeverity" /></td>
                <td class="ax-table__td ax-table__td--num nowrap">{{ usd(v.totalUsd) }}</td>
                <td class="ax-table__td ax-table__td--num nowrap" :class="{ risk: v.atRiskUsd > 0 }">
                  {{ v.atRiskUsd > 0 ? `${usd(v.atRiskUsd)} · ${share(v.atRiskUsd, v.totalUsd)}` : '—' }}
                </td>
                <td class="ax-table__td ax-table__td--num nowrap">{{ v.allocations.length }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!loading && !vaults.length" class="empty">No vault data yet.</p>
        <p v-else-if="!loading && !rows.length && filtered" class="empty">No vault matches these filters.</p>
        <p v-else-if="!loading && !rows.length" class="empty">No vault holds $10K or more. Use the option above to see the smaller ones.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Card subtitles stay at a readable line length. */
.ax-card__subtitle {
  max-width: 72ch;
}
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-6);
}
.page > .ax-page-head {
  margin-block-end: 0;
}
.toolbar {
  flex-wrap: wrap;
  gap: var(--ax-space-3);
}
/* The filters take the full width under the title and wrap, as on the Reserves page. */
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
.toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.pilot {
  display: flex;
  flex-direction: row;
  text-align: left;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ax-space-4);
  padding: var(--ax-space-5);
}
.count-skeleton {
  display: inline-block;
  width: 4rem;
  vertical-align: middle;
}
.pilot__actions {
  display: flex;
  gap: var(--ax-space-2);
}
/* The sort arrow sits right of the label, shown on hover and on the active column only. */
.sort-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.15s;
}
.sort-button:hover .sort-icon,
.sort-button:focus-visible .sort-icon {
  opacity: 0.6;
}
.sort-button--active {
  color: var(--ax-accent-text, var(--ax-accent));
}
.sort-button--active .sort-icon {
  opacity: 1;
}
.sort-button {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-1);
  font: inherit;
  color: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.sort-button:focus-visible {
  outline: 2px solid var(--ax-accent);
  outline-offset: 2px;
  border-radius: var(--ax-radius-sm);
}
.row-link {
  cursor: pointer;
}
.name {
  color: var(--ax-text-strong);
  font-weight: 600;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.risk {
  color: var(--ax-danger-500);
  font-weight: 600;
}
.empty {
  padding: var(--ax-space-8);
  text-align: center;
  color: var(--ax-text-muted);
}
</style>
