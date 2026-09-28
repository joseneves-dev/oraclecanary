<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchAllReserves, fetchIncidents, type Reserve, type ReserveIncident } from '@/api/client'
import IncidentLog from '@/components/IncidentLog.vue'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTags from '@/components/ReserveTags.vue'
import { duration, usd } from '@/lib/format'

const router = useRouter()
// Empty reserves (under $1, shown as $0) put no money at risk and are left out of incidents.
const MIN_EXPOSED_USD = 1

const reserves = ref<Reserve[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    reserves.value = await fetchAllReserves({ listed: true })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

const open = computed(() => reserves.value.filter((r) => r.severity === 'critical' && r.totalSupplyUsd >= MIN_EXPOSED_USD).sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd))
const openSupply = computed(() => open.value.reduce((sum, r) => sum + r.totalSupplyUsd, 0))
/** How long the oldest open incident has lasted, from the age of its price. */
const longestOpen = computed(() => Math.max(0, ...open.value.map((r) => r.price.ageSeconds ?? 0)))

/** The most telling message of a reserve: its critical check. */
const mainIssue = (r: Reserve) => (r.checks.find((c) => c.severity === 'critical') ?? r.checks[0])?.message ?? ''

const LOG_SIZE = 100
const LOG_FILTERS = [
  { label: 'All', resolved: undefined },
  { label: 'Ongoing', resolved: false },
  { label: 'Resolved', resolved: true },
] as const
const logFilter = ref<(typeof LOG_FILTERS)[number]>(LOG_FILTERS[0])
const incidents = ref<ReserveIncident[]>([])
const logError = ref<string | null>(null)

watch(
  logFilter,
  async (filter, _previous, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    logError.value = null
    try {
      incidents.value = await fetchIncidents(
        { itemsPerPage: LOG_SIZE, 'totalSupplyUsd[gte]': MIN_EXPOSED_USD, ...(filter.resolved === undefined ? {} : { resolved: filter.resolved }) },
        controller.signal,
      )
    } catch (e) {
      if (!controller.signal.aborted) logError.value = (e as Error).message
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="ax-page-head">
    <div class="ax-page-head__row">
      <div>
        <h1 class="ax-page-head__title">Incidents</h1>
        <p class="ax-page-head__subtitle">Lending markets whose price feed is failing now, and every time it went wrong before.</p>
      </div>
    </div>
  </div>

  <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>

  <div v-else class="ax-dash-grid" :aria-busy="loading">
    <KpiCard label="Open incidents" :value="loading ? '…' : String(open.length)" icon="alert-triangle" tone="c3" hint="Listed reserves with a critical check" />
    <KpiCard label="Supply affected" :value="loading ? '…' : usd(openSupply)" icon="table" tone="c2" hint="Deposits in those reserves" />
    <KpiCard label="Longest open" :value="loading ? '…' : open.length ? duration(longestOpen) : '—'" icon="history" tone="c1" hint="Age of the oldest price among open incidents" />
    <KpiCard label="Markets watched" :value="loading ? '…' : String(reserves.length)" icon="layout-dashboard" tone="c4" hint="Listed reserves on Kamino, marginfi and Jupiter Lend" />

    <section class="ax-card ax-col--12" aria-label="Open incidents">
      <div class="ax-card__header">
        <div class="ax-card__titles">
          <h2 class="ax-card__title">Open now</h2>
          <p class="ax-card__subtitle">The protocol cannot use these prices: borrowing and liquidations are blocked until they recover</p>
        </div>
      </div>
      <div class="ax-card__body">
        <p v-if="!loading && !open.length" class="muted">No open incident: every listed reserve has a usable price.</p>
        <div v-else class="ax-table-wrap">
          <table class="ax-table ax-table--hover">
            <thead>
              <tr>
                <th scope="col">Reserve</th>
                <th scope="col">Issue</th>
                <th scope="col">Tags</th>
                <th scope="col" class="num">Price age</th>
                <th scope="col" class="num">Supply</th>
              </tr>
            </thead>
            <tbody>
              <!-- The whole row opens the reserve; the asset link keeps it reachable by keyboard. -->
              <tr v-for="r in open" :key="r.address" class="row-link" @click="router.push({ name: 'reserve', params: { address: r.address } })">
                <td>
                  <RouterLink :to="{ name: 'reserve', params: { address: r.address } }">{{ r.asset }}</RouterLink>
                  <div class="muted">{{ r.protocol }} · {{ r.market.name }}</div>
                </td>
                <td class="issue">{{ mainIssue(r) }}</td>
                <td><ReserveTags :checks="r.checks" /></td>
                <td class="num ax-num">{{ duration(r.price.ageSeconds) }}</td>
                <td class="num ax-num">{{ usd(r.totalSupplyUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="ax-card ax-col--12" aria-label="Incident log">
      <div class="ax-card__header">
        <div class="ax-card__titles">
          <h2 class="ax-card__title">Incident log</h2>
          <p class="ax-card__subtitle">
            Every period a listed reserve's price could not be used, and how long it lasted. ≈ marks a start worked out from
            the price age, for reserves already failing when tracking began on 27 Sep 2026.
          </p>
        </div>
        <div class="ax-btn-group ax-btn-group--segmented" role="group" aria-label="Incident status">
          <button
            v-for="filter in LOG_FILTERS"
            :key="filter.label"
            type="button"
            class="ax-btn ax-btn--sm"
            :aria-pressed="logFilter === filter"
            @click="logFilter = filter"
          >
            {{ filter.label }}
          </button>
        </div>
      </div>
      <div class="ax-card__body">
        <div v-if="logError" class="ax-alert ax-alert--danger" role="alert">{{ logError }}</div>
        <IncidentLog v-else-if="incidents.length" :incidents="incidents" />
        <p v-else class="muted">No incident in this list.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.row-link {
  cursor: pointer;
}
th {
  text-align: left;
}
.num {
  text-align: right;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
.issue {
  font-size: var(--ax-text-sm);
  max-width: 48ch;
}
</style>
