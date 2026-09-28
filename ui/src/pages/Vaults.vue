<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter, type LocationQuery } from 'vue-router'
import { fetchVaults, type Severity, type Vault } from '@/api/client'
import KpiCard from '@/components/KpiCard.vue'
import SeverityBadge from '@/components/SeverityBadge.vue'
import { usd } from '@/lib/format'

const route = useRoute()
const router = useRouter()
const vaults = ref<Vault[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    vaults.value = await fetchVaults()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

/** Test and dust vaults hold next to nothing; they are listed only on request. */
const MIN_VAULT_USD = 10_000
/** Kept in the URL (small=1) like the sort, so going back from a vault keeps it. */
const showSmall = computed({
  get: () => route.query.small === '1',
  set: (value: boolean) => {
    const { small: _small, ...rest } = route.query
    router.replace({ query: value ? { ...rest, small: '1' } : rest })
  },
})
const smallCount = computed(() => vaults.value.filter((v) => v.totalUsd < MIN_VAULT_USD).length)
const shown = computed(() => (showSmall.value ? vaults.value : vaults.value.filter((v) => v.totalUsd >= MIN_VAULT_USD)))

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
  const query: Record<string, string> = {}
  if (key !== 'totalUsd') query.sort = key
  if (sortDir !== defaultDir(key)) query.dir = sortDir
  if (showSmall.value) query.small = '1'
  router.replace({ query })
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

  <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>

  <div v-else class="ax-dash-grid" :aria-busy="loading">
    <KpiCard label="Vaults" :value="loading ? '…' : String(shown.length)" icon="users-group" tone="c1" :hint="showSmall ? 'Every Kamino curator vault with deposits' : 'Kamino curator vaults holding $10K or more'" />
    <KpiCard label="Deposits" :value="loading ? '…' : usd(total)" icon="layout-dashboard" tone="c2" />
    <KpiCard
      label="At risk now"
      :value="loading ? '…' : usd(atRisk)"
      icon="alert-triangle"
      :tone="atRisk > 0 ? 'c3' : 'c4'"
      :hint="loading ? undefined : atRisk > 0 ? `${share(atRisk, total)} of deposits` : `None of ${usd(total)} is in an unhealthy reserve or market`"
    />
    <KpiCard
      label="Vaults exposed"
      :value="loading ? '…' : String(exposed.length)"
      icon="bell"
      :tone="exposed.length ? 'c3' : 'c4'"
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
      <div class="ax-card__header vaults-header">
        <div class="ax-card__titles">
          <h2 class="ax-card__title">All vaults</h2>
          <p class="ax-card__subtitle ax-num">
            {{ loading ? 'Loading…' : `${shown.length} vaults` }} · exposure is recomputed every few minutes from live oracle
            data
          </p>
        </div>
        <div class="ax-card__actions">
          <label v-if="smallCount" class="toggle">
            <input v-model="showSmall" type="checkbox" class="ax-checkbox" />
            Show {{ smallCount }} vaults under $10K
          </label>
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
                :class="{ center: col.num }"
                :aria-sort="ariaSort(col.key)"
              >
                <button type="button" class="sort-button" @click="sortBy(col.key)">
                  {{ col.label }}
                  <svg v-if="state.sortKey !== col.key" class="ax-table__sort" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity: 0.4"><path d="M8 9l4 -4l4 4" /><path d="M16 15l-4 4l-4 -4" /></svg>
                  <svg v-else-if="state.sortDir === 'asc'" class="ax-table__sort" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6 -6l6 6" /></svg>
                  <svg v-else class="ax-table__sort" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6" /></svg>
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
              <td class="ax-table__td center ax-num">{{ usd(v.totalUsd) }}</td>
              <td class="ax-table__td center ax-num" :class="{ risk: v.atRiskUsd > 0 }">
                {{ v.atRiskUsd > 0 ? `${usd(v.atRiskUsd)} · ${share(v.atRiskUsd, v.totalUsd)}` : '—' }}
              </td>
              <td class="ax-table__td center ax-num">{{ v.allocations.length }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !vaults.length" class="empty">No vault data yet.</p>
      <p v-else-if="!loading && !rows.length" class="empty">No vault holds $10K or more. Use the option above to see the smaller ones.</p>
    </section>
  </div>
</template>

<style scoped>
.vaults-header {
  flex-wrap: wrap;
  gap: var(--ax-space-3);
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
  text-align: left;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ax-space-4);
  padding: var(--ax-space-5);
}
.pilot__actions {
  display: flex;
  gap: var(--ax-space-2);
}
th {
  text-align: left;
}
/* Deposits, At risk and Reserves: header and values centered on the same axis. */
th.center,
td.center {
  text-align: center;
}
th.center .sort-button {
  justify-content: center;
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
