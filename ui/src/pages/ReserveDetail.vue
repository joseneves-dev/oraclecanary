<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchEvents, fetchReserve, fetchReserveHistory, type Reserve, type ReserveEvent, type ReserveSnapshot } from '@/api/client'
import EventList from '@/components/EventList.vue'
import HealthHistoryChart from '@/components/HealthHistoryChart.vue'
import PriceAgeChart from '@/components/PriceAgeChart.vue'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTags from '@/components/ReserveTags.vue'
import SeverityBadge from '@/components/SeverityBadge.vue'
import { SEVERITY_TONE, checkMessage, dateTime, duration, protocolName, shortAddress, solscanAccount, usd } from '@/lib/format'
import { priceState } from '@/lib/priceState'

const props = defineProps<{ address: string }>()

const reserve = ref<Reserve | null>(null)
/** A tokenized stock whose price only paused because its market is closed (same rule as My positions). */
const paused = computed(() => !!reserve.value && priceState(reserve.value) === 'paused')
const loading = ref(true)
const error = ref<string | null>(null)

watch(
  () => props.address,
  async (address, _previous, onCleanup) => {
    // The component is reused when only the address changes; a slower earlier response must not
    // overwrite the reserve now in the URL.
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    loading.value = true
    error.value = null
    try {
      reserve.value = await fetchReserve(address, controller.signal)
    } catch (e) {
      if (!controller.signal.aborted) error.value = (e as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  },
  { immediate: true },
)

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
] as const
const rangeHours = ref<number>(RANGES[0].hours)
/** Start of the first hour in the range, so the current hour is the last bar. */
const rangeStart = computed(() => {
  const start = new Date(Date.now() - (rangeHours.value - 1) * 3_600_000)
  start.setUTCMinutes(0, 0, 0)
  return start
})

const history = ref<ReserveSnapshot[]>([])
const events = ref<ReserveEvent[]>([])
const historyError = ref<string | null>(null)
const RECENT_EVENTS = 20

watch(
  [() => props.address, rangeStart],
  async ([address, from], _previous, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    historyError.value = null
    try {
      const [samples, changes] = await Promise.all([
        fetchReserveHistory(address, from, controller.signal),
        fetchEvents({ reserve: address, itemsPerPage: RECENT_EVENTS }, controller.signal),
      ])
      history.value = samples
      events.value = changes
    } catch (e) {
      if (!controller.signal.aborted) historyError.value = (e as Error).message
    }
  },
  { immediate: true },
)

const accountRows = (r: Reserve) =>
  [
    { label: 'Reserve', value: r.address },
    { label: 'Lending market', value: r.market.address },
    { label: 'Token mint', value: r.mint },
    { label: 'Scope price account', value: r.oracleAccounts.scopePrices, extra: r.oracleAccounts.scopeChain.length ? `chain [${r.oracleAccounts.scopeChain.join(', ')}]` : null },
    { label: 'Pyth feed', value: r.oracleAccounts.pyth },
    { label: 'Switchboard feed', value: r.oracleAccounts.switchboard },
    { label: 'Oracle', value: r.oracleAccounts.oracle },
    ...r.oracleAccounts.sources.map((s, i) => ({ label: `Source ${i + 1}: ${s.type}`, value: s.account })),
  ].filter((row): row is { label: string; value: string; extra?: string | null } => row.value !== null)
</script>

<template>
  <!-- One root: the layout pads every top-level block, which would stack the spacing. -->
  <div class="page">
    <div v-if="loading" class="loading-page" role="status" aria-label="Loading">
      <div class="loading-page__head">
        <span class="ax-skeleton ax-skeleton--line" style="width: 220px; height: 1.75rem"></span>
        <span class="ax-skeleton ax-skeleton--line" style="width: min(420px, 80%)"></span>
      </div>
      <div class="ax-dash-grid">
        <div v-for="n in 4" :key="n" class="ax-card ax-col--3 loading-page__kpi">
          <span class="ax-skeleton ax-skeleton--line" style="width: 45%"></span>
          <span class="ax-skeleton ax-skeleton--line" style="width: 65%; height: 1.75rem"></span>
        </div>
        <div class="ax-card ax-col--12 loading-page__card"><span class="ax-skeleton ax-skeleton--rect" style="height: 100%"></span></div>
      </div>
    </div>
    <div v-else-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>
    <div v-else-if="!reserve" class="state">
      <p>No reserve with address <code>{{ address }}</code>.</p>
      <RouterLink :to="{ name: 'reserves' }" class="ax-btn ax-btn--secondary ax-btn--sm">Back to reserves</RouterLink>
    </div>

    <template v-else>
      <div class="ax-page-head">
        <div class="ax-page-head__row">
          <div>
            <div class="title-row">
              <h1 class="ax-page-head__title">{{ reserve.asset || shortAddress(reserve.mint) }}</h1>
              <!-- A stock paused by its closed market is expected, so it reads as on My positions, not as an alarm. -->
              <span class="title-badges">
                <span v-if="paused" class="ax-badge ax-badge--soft ax-badge--pill ax-badge--info">Paused · market closed</span>
                <template v-else>
                  <SeverityBadge :severity="reserve.severity" />
                  <ReserveTags :checks="reserve.checks" hide-empty />
                </template>
              </span>
            </div>
            <p class="ax-page-head__subtitle">
              {{ protocolName(reserve.protocol) }} · {{ reserve.market.name ?? 'Unlisted market' }} · checked {{ dateTime(reserve.checkedAt) }}
            </p>
          </div>
        </div>
      </div>

      <div class="ax-dash-grid">
        <KpiCard
          label="Health score"
          :value="`${reserve.score} / 100`"
          :tone="paused ? undefined : SEVERITY_TONE[reserve.severity]"
          :hint="paused ? 'Paused while the US market is closed: expected' : null"
        />
        <KpiCard label="Supply" :value="usd(reserve.totalSupplyUsd)" />
        <KpiCard
          label="Price age"
          :value="duration(reserve.price.ageSeconds)"
         
          :tone="reserve.price.isStale && !paused ? 'danger' : undefined"
          :hint="`The protocol rejects prices older than ${duration(reserve.price.maxAgeSeconds)}`"
        />
        <KpiCard label="Oracle providers" :value="String(reserve.providers.length)" :hint="reserve.providers.join(', ') || 'None found'" />

        <section class="ax-card ax-col--12" aria-label="Health history">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 class="ax-card__title">Health history</h2>
              <p class="ax-card__subtitle">Worst score of each hour. Recorded for listed markets since 27 Sep 2026.</p>
            </div>
            <div class="ax-btn-group ax-btn-group--segmented" role="group" aria-label="Time range">
              <button
                v-for="range in RANGES"
                :key="range.label"
                type="button"
                class="ax-btn ax-btn--sm"
                :aria-pressed="rangeHours === range.hours"
                @click="rangeHours = range.hours"
              >
                {{ range.label }}
              </button>
            </div>
          </div>
          <div class="ax-card__body">
            <div v-if="historyError" class="ax-alert ax-alert--danger" role="alert">{{ historyError }}</div>
            <p v-else-if="!reserve.market.name" class="muted">History is not recorded for unlisted markets.</p>
            <HealthHistoryChart v-else :samples="history" :from="rangeStart" :hours="rangeHours" />
          </div>
        </section>

        <section v-if="reserve.market.name && !historyError && reserve.price.maxAgeSeconds > 0" class="ax-card ax-col--12" aria-label="Price age">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 class="ax-card__title">Price age</h2>
              <p class="ax-card__subtitle">
                How old the price was, against the protocol's limit: past the dashed line, the protocol rejects it. Same range as above.
              </p>
            </div>
          </div>
          <div class="ax-card__body">
            <PriceAgeChart :samples="history" :from="rangeStart" :hours="rangeHours" :max-age-seconds="reserve.price.maxAgeSeconds" />
          </div>
        </section>

        <section v-if="reserve.market.name" class="ax-card ax-col--12" aria-label="Changes">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 class="ax-card__title">Changes</h2>
              <p class="ax-card__subtitle">When a check started or stopped failing, once the change lasted a few minutes</p>
            </div>
          </div>
          <div class="ax-card__body">
            <EventList v-if="events.length" :events="events" hide-asset />
            <p v-else class="muted">No change recorded yet: this reserve has kept its current state since recording started.</p>
          </div>
        </section>

        <section class="ax-card ax-col--6" aria-label="Health checks">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 class="ax-card__title">Health checks</h2>
              <p class="ax-card__subtitle">{{ reserve.checks.length ? `${reserve.checks.length} ${reserve.checks.length === 1 ? 'issue' : 'issues'} found` : 'All checks passed' }}</p>
            </div>
          </div>
          <div class="ax-card__body">
            <ul v-if="reserve.checks.length" class="checks">
              <li v-for="c in reserve.checks" :key="c.code" class="checks__item">
                <SeverityBadge :severity="c.severity" />
                <div>
                  <b class="ax-mono checks__code">{{ c.code }}</b>
                  <p class="checks__message">{{ checkMessage(c.message) }}</p>
                </div>
              </li>
            </ul>
            <p v-else class="muted">The price is fresh, has a fallback source and no provider has shut down.</p>
          </div>
        </section>

        <section class="ax-card ax-col--6" aria-label="On-chain accounts">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 class="ax-card__title">On-chain accounts</h2>
              <p class="ax-card__subtitle">Verify every value on Solscan</p>
            </div>
          </div>
          <div class="ax-card__body">
            <dl class="accounts">
              <template v-for="row in accountRows(reserve)" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>
                  <a :href="solscanAccount(row.value)" target="_blank" rel="noopener" class="ax-mono">{{ shortAddress(row.value) }}</a>
                  <span v-if="row.extra" class="muted extra">{{ row.extra }}</span>
                </dd>
              </template>
            </dl>
          </div>
        </section>
      </div>
    </template>
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
.title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-2) var(--ax-space-3);
}
.title-badges {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-1);
  letter-spacing: normal;
}
.loading-page {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-6);
}
.loading-page__head {
  display: grid;
  gap: var(--ax-space-3);
}
.loading-page__kpi {
  display: grid;
  gap: var(--ax-space-3);
  padding: var(--ax-space-4) var(--ax-space-5);
}
.loading-page__card {
  height: 280px;
  padding: var(--ax-space-5);
}
.state {
  padding: var(--ax-space-8);
  display: grid;
  gap: var(--ax-space-4);
  justify-items: start;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.checks {
  display: grid;
  gap: var(--ax-space-4);
}
.checks__item > :first-child {
  justify-self: start;
}
.checks__item {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: var(--ax-space-3);
  align-items: start;
}
.checks__code {
  font-size: var(--ax-text-xs);
  color: var(--ax-text-strong);
}
.checks__message {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.accounts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--ax-space-2) var(--ax-space-6);
  font-size: var(--ax-text-sm);
}
.extra {
  margin-inline-start: var(--ax-space-2);
}
.accounts dt {
  color: var(--ax-text-muted);
}
</style>
