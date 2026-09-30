<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchAllReserves, fetchConfigChanges, fetchIncidents, type ConfigChange, type Reserve, type ReserveIncident } from '@/api/client'
import EmptyState from '@/components/EmptyState.vue'
import IncidentLog from '@/components/IncidentLog.vue'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTags from '@/components/ReserveTags.vue'
import { dateTime, duration, protocolName, shortAddress, usd } from '@/lib/format'

const router = useRouter()
// Empty reserves (under $1, shown as $0) put no money at risk and are left out of incidents.
const MIN_EXPOSED_USD = 1

const reserves = ref<Reserve[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

/** Changes to how listed reserves are priced: new listings, other price sources, other age limits. */
const changes = ref<ConfigChange[]>([])
const changesLoading = ref(true)
const changesError = ref<string | null>(null)
const CHANGE_LABEL: Record<string, string> = { listed: 'Newly listed', price_source: 'Price source', max_age: 'Age limit' }

onMounted(async () => {
  fetchConfigChanges(30)
    .then((rows) => (changes.value = rows))
    .catch((e) => (changesError.value = (e as Error).message))
    .finally(() => (changesLoading.value = false))
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
// shallowRef keeps the filter object itself, so the `===` that marks the pressed button holds.
const logFilter = shallowRef<(typeof LOG_FILTERS)[number]>(LOG_FILTERS[0])
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
  <!-- One root: the layout pads every top-level block, which would stack the spacing. -->
  <div class="page">
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
      <KpiCard label="Open incidents" :loading="loading" :tone="open.length ? 'danger' : undefined" :value="String(open.length)" icon="alert-triangle" hint="Listed reserves with a critical check" />
      <KpiCard label="Supply affected" :loading="loading" :tone="openSupply > 0 ? 'danger' : undefined" :value="usd(openSupply)" icon="table" hint="Deposits in those reserves" />
      <KpiCard label="Longest open" :loading="loading" :value="open.length ? duration(longestOpen) : '—'" icon="history" hint="Age of the oldest price among open incidents" />
      <KpiCard label="Markets watched" :loading="loading" :value="String(reserves.length)" icon="layout-dashboard" hint="Listed reserves on Kamino, marginfi and Jupiter Lend" />

      <section class="ax-card ax-col--12" aria-label="Open incidents">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">Open now</h2>
            <p class="ax-card__subtitle">Borrowing and liquidations are blocked until these prices recover</p>
          </div>
        </div>
        <EmptyState v-if="!loading && !open.length" title="No open incident">Every listed reserve has a price the protocol can use.</EmptyState>
        <div v-else class="ax-table-wrap">
          <table class="ax-table ax-table--hover ax-table--compact open">
            <thead class="ax-table__head">
              <tr>
                <th scope="col" class="ax-table__th">Reserve</th>
                <th scope="col" class="ax-table__th">Issue</th>
                <th scope="col" class="ax-table__th">Tags</th>
                <th scope="col" class="ax-table__th ax-table__th--num">Price age</th>
                <th scope="col" class="ax-table__th ax-table__th--num">Supply</th>
              </tr>
            </thead>
            <tbody>
              <template v-if="loading">
                <tr v-for="n in 3" :key="n" aria-hidden="true">
                  <td v-for="c in 5" :key="c" class="ax-table__td"><span class="ax-skeleton ax-skeleton--line" style="width: 60%"></span></td>
                </tr>
              </template>
              <!-- The whole row opens the reserve; the asset link keeps it reachable by keyboard. -->
              <tr v-for="r in open" :key="r.address" class="ax-table__row row-link" @click="router.push({ name: 'reserve', params: { address: r.address } })">
                <td class="ax-table__td">
                  <RouterLink class="asset" :to="{ name: 'reserve', params: { address: r.address } }">{{ r.asset }}</RouterLink>
                  <div class="muted">{{ protocolName(r.protocol) }} · {{ r.market.name }}</div>
                </td>
                <td class="ax-table__td issue">{{ mainIssue(r) }}</td>
                <td class="ax-table__td"><ReserveTags :checks="r.checks" /></td>
                <td class="ax-table__td ax-table__td--num nowrap danger">{{ duration(r.price.ageSeconds) }}</td>
                <td class="ax-table__td ax-table__td--num nowrap">{{ usd(r.totalSupplyUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="ax-card ax-col--12" aria-label="Incident log">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">Incident log</h2>
            <p class="ax-card__subtitle">Each time a listed reserve's price could not be used, and for how long</p>
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
        <div v-if="logError" class="ax-card__body"><div class="ax-alert ax-alert--danger" role="alert">{{ logError }}</div></div>
        <template v-else-if="incidents.length">
          <IncidentLog :incidents="incidents" />
          <p class="footnote">≈ marks a start worked out from the price age, for reserves already failing when tracking began on 27 Sep 2026.</p>
        </template>
        <EmptyState v-else :tone="logFilter.resolved === false ? 'clear' : 'none'" :title="logFilter.resolved === false ? 'Nothing ongoing' : 'No incident in this list'" compact />
      </section>

      <section class="ax-card ax-col--12" aria-label="Configuration changes">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">Configuration changes</h2>
            <p class="ax-card__subtitle">New listings and changes to how listed reserves are priced</p>
          </div>
        </div>
        <div v-if="changesError" class="ax-card__body"><div class="ax-alert ax-alert--danger" role="alert">{{ changesError }}</div></div>
        <div v-else-if="changesLoading" class="ax-card__body skeleton-rows" aria-hidden="true">
          <span v-for="n in 3" :key="n" class="ax-skeleton ax-skeleton--line"></span>
        </div>
        <div v-else-if="changes.length" class="ax-table-wrap">
          <table class="ax-table ax-table--hover ax-table--compact">
            <thead class="ax-table__head">
              <tr>
                <th scope="col" class="ax-table__th">When</th>
                <th scope="col" class="ax-table__th">Reserve</th>
                <th scope="col" class="ax-table__th">Change</th>
                <th scope="col" class="ax-table__th">What changed</th>
                <th scope="col" class="ax-table__th ax-table__th--num">Supply</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in changes" :key="c.id" class="ax-table__row">
                <td class="ax-table__td muted nowrap">{{ dateTime(c.occurredAt) }}</td>
                <td class="ax-table__td">
                  <RouterLink class="asset" :to="{ name: 'reserve', params: { address: c.reserve } }">{{ c.asset || shortAddress(c.reserve) }}</RouterLink>
                  <div class="muted">{{ protocolName(c.protocol) }} · {{ c.marketName }}</div>
                </td>
                <td class="ax-table__td">
                  <span class="ax-badge ax-badge--soft ax-badge--pill" :class="c.kind === 'listed' ? 'ax-badge--info' : 'ax-badge--warning'">{{
                    CHANGE_LABEL[c.kind] ?? c.kind
                  }}</span>
                </td>
                <td class="ax-table__td issue">{{ c.detail }}</td>
                <td class="ax-table__td ax-table__td--num nowrap">{{ usd(c.totalSupplyUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-else tone="none" title="No change seen yet" compact>
          No change to how a listed reserve is priced has been seen since this check started.
        </EmptyState>
        <p v-if="!changesLoading && !changesError" class="footnote">
          Seen from one check to the next: routine when an oracle is migrated, and the first sign of trouble when a thin token is listed or a
          price source is swapped without notice.
        </p>
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
.row-link {
  cursor: pointer;
}
.nowrap {
  white-space: nowrap;
}
.asset {
  font-weight: 600;
  color: var(--ax-text-strong);
}
.asset:hover {
  color: var(--ax-accent-text);
}
/* Secondary text in a cell: the protocol and market under an asset, a date. */
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
.danger {
  color: var(--ax-danger-500);
  font-weight: 600;
}
.issue {
  font-size: var(--ax-text-sm);
  max-width: 56ch;
}
.footnote {
  margin: 0;
  padding: var(--ax-space-3) var(--ax-space-6) var(--ax-space-4);
  font-size: var(--ax-text-xs);
  color: var(--ax-text-subtle);
  max-width: 110ch;
}
.skeleton-rows {
  display: grid;
  gap: var(--ax-space-3);
}
</style>
