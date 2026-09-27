<script setup lang="ts">
import { ref, watch } from 'vue'
import { fetchReserves, type Reserve, type ReserveQuery } from '@/api/client'
import ReserveTable, { type SortKey } from '@/components/ReserveTable.vue'

const PAGE_SIZE = 25

const rows = ref<Reserve[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const search = ref('')
const health = ref<'all' | 'issues' | 'critical'>('all')
const listedOnly = ref(true)
const sortKey = ref<SortKey>('score')
const sortDir = ref<'asc' | 'desc'>('asc')
const page = ref(1)

/**
 * Health bands map onto the score: a critical check costs 50 points, so reserves at or
 * below 50 have a critical issue (or several warnings), and anything below 100 has at least one.
 */
function buildQuery(): ReserveQuery {
  const query: Record<string, string | number | boolean> = {
    page: page.value,
    itemsPerPage: PAGE_SIZE,
    [`order[${sortKey.value}]`]: sortDir.value,
  }
  if (listedOnly.value) query.listed = true
  if (search.value.trim()) query.asset = search.value.trim()
  if (health.value === 'issues') query['score[lt]'] = 100
  if (health.value === 'critical') query['score[lte]'] = 50
  return query as ReserveQuery
}

let requestId = 0
async function load() {
  const id = ++requestId
  loading.value = true
  error.value = null
  try {
    const result = await fetchReserves(buildQuery())
    if (id === requestId) rows.value = result
  } catch (e) {
    if (id === requestId) error.value = (e as Error).message
  } finally {
    if (id === requestId) loading.value = false
  }
}

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortKey.value = key
    sortDir.value = key === 'score' || key === 'asset' ? 'asc' : 'desc'
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => (page.value === 1 ? load() : (page.value = 1)), 250)
})
watch([health, listedOnly, sortKey, sortDir], () => (page.value === 1 ? load() : (page.value = 1)))
watch(page, load, { immediate: true })
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
          <h2 class="ax-card__title">Kamino</h2>
          <p class="ax-card__subtitle">Sorted and filtered by the API</p>
        </div>
        <div class="ax-card__actions toolbar__controls">
          <input v-model="search" type="search" class="ax-input ax-input--sm" placeholder="Search asset, e.g. SOL" aria-label="Search by asset" />
          <select v-model="health" class="ax-select ax-select--sm" aria-label="Filter by health">
            <option value="all">All health levels</option>
            <option value="issues">With issues (score &lt; 100)</option>
            <option value="critical">Serious (score ≤ 50)</option>
          </select>
          <label class="toolbar__check">
            <input v-model="listedOnly" type="checkbox" class="ax-checkbox" />
            Listed markets only
          </label>
        </div>
      </div>

      <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>
      <div v-else :aria-busy="loading" :class="{ loading }">
        <ReserveTable :rows="rows" :sort-key="sortKey" :sort-dir="sortDir" @sort="sortBy" />
        <p v-if="!loading && !rows.length" class="empty">No reserves match these filters.</p>
      </div>

      <div class="ax-card__footer pager">
        <span class="ax-num muted">Page {{ page }}</span>
        <nav class="ax-pagination" aria-label="Pagination">
          <button type="button" class="ax-pagination__prev" :disabled="page === 1" aria-label="Previous page" @click="page--">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6l6 6" /></svg>
          </button>
          <button type="button" class="ax-pagination__next" :disabled="rows.length < PAGE_SIZE" aria-label="Next page" @click="page++">
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
.toolbar__controls {
  flex-wrap: wrap;
  gap: var(--ax-space-2);
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
