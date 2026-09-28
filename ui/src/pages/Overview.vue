<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchAllReserves, fetchIncidents, fetchReserves, type Reserve, type ReserveIncident, type Severity } from '@/api/client'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTable from '@/components/ReserveTable.vue'
import { time, usd } from '@/lib/format'

const ATTENTION_ROWS = 10
const TELEGRAM_URL = 'https://t.me/OracleCanaryAlerts'

const reserves = ref<Reserve[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

/** Reserves still depending on Switchboard, and past incidents: they feed the story cards. */
const switchboard = ref<Reserve[] | null>(null)
const incidents = ref<ReserveIncident[]>([])

/** Aborts the requests when leaving the page, so they cannot update it afterwards. */
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())

/** Only closures with this much at stake are worth telling as a story. */
const STORY_MIN_SUPPLY_USD = 100_000

onMounted(async () => {
  const { signal } = controller
  // The cards are extras: if their data fails to load they are simply not shown.
  fetchReserves({ check: 'DEPRECATED_PROVIDER', itemsPerPage: 500 }, signal).then((rows) => (switchboard.value = rows), () => {})
  fetchIncidents({ itemsPerPage: 200, 'totalSupplyUsd[gte]': STORY_MIN_SUPPLY_USD }, signal).then((rows) => (incidents.value = rows), () => {})
  try {
    // Unlisted markets hold junk tokens with arbitrary prices.
    reserves.value = await fetchAllReserves({ listed: true }, signal)
  } catch (e) {
    if (!signal.aborted) error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

const noFallback = computed(() => reserves.value.filter((r) => r.checks.some((c) => c.code === 'NO_FALLBACK')))
const noFallbackSupply = computed(() => noFallback.value.reduce((sum, r) => sum + r.totalSupplyUsd, 0))

/** The largest stock-market closure recorded: a tokenized stock left without a fresh price for hours. */
const largestFreeze = computed(() => {
  const seconds = (i: ReserveIncident) => i.durationSeconds ?? Math.max(0, (Date.now() - Date.parse(i.startedAt)) / 1000)
  // At least an hour long, so a closure noticed for a few minutes is not told as a story.
  const closures = incidents.value.filter((i) => i.checks.some((c) => c.code === 'MARKET_CLOSED') && seconds(i) >= 3600)
  const largest = [...closures].sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)[0]
  if (!largest) return null
  const hours = Math.round(seconds(largest) / 3600)
  return { incident: largest, hours, label: hours === 1 ? '1 hour' : `${hours} hours` }
})

const switchboardListed = computed(() => switchboard.value?.filter((r) => r.market.name) ?? [])
const switchboardUnlisted = computed(() => switchboard.value?.filter((r) => !r.market.name) ?? [])

const totalSupply = computed(() => reserves.value.reduce((sum, r) => sum + r.totalSupplyUsd, 0))
const critical = computed(() => reserves.value.filter((r) => r.severity === 'critical'))
const warnings = computed(() => reserves.value.filter((r) => r.severity === 'warning'))
const supplyAtRisk = computed(() => critical.value.reduce((sum, r) => sum + r.totalSupplyUsd, 0))

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, info: 1, warning: 2, critical: 3 }

/** Critical issues first, then the largest warnings. */
const needsAttention = computed(() =>
  reserves.value
    .filter((r) => r.severity === 'critical' || r.severity === 'warning')
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.totalSupplyUsd - a.totalSupplyUsd)
    .slice(0, ATTENTION_ROWS),
)

/**
 * Scope entry types that describe a token's structure (a peg, a staking or maturity rate)
 * rather than a market price, so they are not oracle providers.
 */
const NON_MARKET_SOURCES = new Set(['FixedPrice', 'SplStake', 'MsolStake', 'JitoRestaking', 'DiscountToMaturity'])

/** Share of supplied value whose price ultimately depends on each oracle provider. */
const providerShare = computed(() => {
  const byProvider = new Map<string, number>()
  for (const r of reserves.value) {
    for (const p of r.providers) {
      if (!NON_MARKET_SOURCES.has(p)) byProvider.set(p, (byProvider.get(p) ?? 0) + r.totalSupplyUsd)
    }
  }
  return [...byProvider]
    .map(([provider, value]) => ({ provider, value, share: totalSupply.value ? value / totalSupply.value : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
})

const lastChecked = computed(() => {
  const latest = Math.max(...reserves.value.map((r) => Date.parse(r.checkedAt)))
  return Number.isFinite(latest) ? time(latest) : null
})
</script>

<template>
  <section class="hero" aria-labelledby="hero-title">
    <h1 id="hero-title" class="hero__title">When a lending oracle fails, withdrawals and liquidations silently stop.</h1>
    <p class="hero__lead">
      OracleCanary watches the oracle behind every reserve of Kamino, marginfi and Jupiter Lend's listed markets<template
        v-if="!loading && reserves.length"
        >: {{ reserves.length }} reserves holding {{ usd(totalSupply) }}</template
      >. It alerts on Telegram when one breaks, and its on-chain guard (live on devnet) lets programs refuse to act on a broken price.
      <template v-if="lastChecked"> Last checked at {{ lastChecked }}.</template>
    </p>
    <div class="hero__actions">
      <a class="ax-btn ax-btn--primary ax-btn--sm" :href="TELEGRAM_URL" target="_blank" rel="noopener">Get alerts on Telegram</a>
      <RouterLink class="ax-btn ax-btn--secondary ax-btn--sm" :to="{ name: 'incidents' }">See incidents</RouterLink>
      <a class="ax-btn ax-btn--secondary ax-btn--sm" href="/api/docs" target="_blank" rel="noopener">Public API</a>
    </div>

    <div class="stories">
      <RouterLink v-if="switchboard && switchboard.length" class="story ax-card" :to="{ name: 'switchboard' }">
        <span class="story__kicker">Switchboard shut down on 25 Sep</span>
        <span class="story__text">
          <template v-if="!switchboardListed.length">No listed market depends on it any more.</template>
          <template v-else>{{ switchboardListed.length }} listed reserves still depend on it.</template>
          <!-- The compiler drops whitespace between templates, so the space between sentences is explicit. -->
          <template v-if="switchboardUnlisted.length">
            {{ ' ' }}{{ switchboardUnlisted.length }} reserves in unlisted markets still do, and their price can no longer be produced.
          </template>
        </span>
        <span class="story__more">Switchboard exposure →</span>
      </RouterLink>
      <RouterLink
        v-if="largestFreeze"
        class="story ax-card"
        :to="{ name: 'reserve', params: { address: largestFreeze.incident.reserve } }"
      >
        <span class="story__kicker">Frozen by market hours</span>
        <span class="story__text">
          A {{ usd(largestFreeze.incident.totalSupplyUsd) }} tokenized-stock reserve ({{ largestFreeze.incident.asset }}) had no fresh price for
          {{ largestFreeze.label }} while the US market was closed. Its only oracle follows market hours, so the protocol rejects the price,
          and loans against it cannot be liquidated, every night and weekend.
        </span>
        <span class="story__more">{{ largestFreeze.incident.asset }} →</span>
      </RouterLink>
      <RouterLink v-if="!loading && noFallbackSupply" class="story ax-card" :to="{ name: 'reserves', query: { issue: 'NO_FALLBACK' } }">
        <span class="story__kicker">No fallback oracle</span>
        <span class="story__text">
          {{ usd(noFallbackSupply) }}, {{ Math.round((noFallbackSupply / totalSupply) * 100) }}% of listed supply, is priced through a feed
          with no fallback oracle: if that feed stops, the price stops.
        </span>
        <span class="story__more">All reserves →</span>
      </RouterLink>
    </div>
  </section>

  <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>

  <div v-else class="ax-dash-grid" :aria-busy="loading">
    <KpiCard label="Reserves monitored" :value="loading ? '…' : String(reserves.length)" icon="table" tone="c1" hint="Kamino, Jupiter Lend and marginfi" />
    <KpiCard label="Supply watched" :value="loading ? '…' : usd(totalSupply)" icon="layout-dashboard" tone="c2" />
    <KpiCard label="Critical" :value="loading ? '…' : String(critical.length)" icon="alert-triangle" tone="c3" :hint="loading ? undefined : `${usd(supplyAtRisk)} supplied`" />
    <KpiCard label="Warnings" :value="loading ? '…' : String(warnings.length)" icon="bell" tone="c4" hint="Mostly single-source prices" />

    <section class="ax-card ax-col--8" aria-label="Reserves that need attention">
      <div class="ax-card__header">
        <div class="ax-card__titles">
          <h2 class="ax-card__title">Needs attention</h2>
          <p class="ax-card__subtitle">Largest reserves with a critical issue or a warning</p>
        </div>
        <div class="ax-card__actions">
          <RouterLink class="ax-btn ax-btn--secondary ax-btn--sm" :to="{ name: 'reserves' }">All reserves</RouterLink>
        </div>
      </div>
      <ReserveTable v-if="loading || needsAttention.length" :rows="needsAttention" />
      <p v-else class="empty">No listed reserve has a critical issue or a warning right now.</p>
    </section>

    <section class="ax-card ax-col--4" aria-label="Supply by oracle provider">
      <div class="ax-card__header">
        <div class="ax-card__titles">
          <h2 class="ax-card__title">Who prices the money</h2>
          <p class="ax-card__subtitle">Share of supply each oracle provider feeds into</p>
        </div>
      </div>
      <div class="ax-card__body">
        <ul class="providers">
          <li v-for="p in providerShare" :key="p.provider">
            <div class="providers__row">
              <span>{{ p.provider }}</span>
              <span class="ax-num">{{ usd(p.value) }} · {{ Math.round(p.share * 100) }}%</span>
            </div>
            <div class="providers__bar"><span :style="{ width: `${Math.max(2, p.share * 100)}%` }"></span></div>
          </li>
        </ul>
        <p class="providers__note">A reserve counts once for every provider its price depends on, so shares add up to more than 100%.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero {
  display: grid;
  gap: var(--ax-space-4);
  margin-bottom: var(--ax-space-6);
}
.hero__title {
  font-family: var(--ax-font-display);
  font-size: clamp(1.5rem, 1.1rem + 1.6vw, 2.25rem);
  line-height: 1.15;
  color: var(--ax-text-strong);
  max-width: 28ch;
}
.hero__lead {
  color: var(--ax-text-muted);
  max-width: 72ch;
}
.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-2);
}
.stories {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--ax-space-4);
  margin-top: var(--ax-space-2);
}
.story {
  display: grid;
  gap: var(--ax-space-2);
  align-content: start;
  padding: var(--ax-space-5);
  color: inherit;
  text-decoration: none;
}
.story:hover .story__more,
.story:focus-visible .story__more {
  text-decoration: underline;
}
.story__kicker {
  font-size: var(--ax-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ax-accent);
}
.story__text {
  color: var(--ax-text-strong);
  font-size: var(--ax-text-sm);
}
.story__more {
  font-size: var(--ax-text-sm);
  color: var(--ax-accent);
  font-weight: 600;
}
.empty {
  padding: var(--ax-space-8);
  text-align: center;
  color: var(--ax-text-muted);
}
.providers {
  display: grid;
  gap: var(--ax-space-4);
}
.providers__row {
  display: flex;
  justify-content: space-between;
  font-size: var(--ax-text-sm);
  margin-bottom: var(--ax-space-1);
}
.providers__bar {
  height: 6px;
  border-radius: 999px;
  background: var(--ax-surface-subtle);
  overflow: hidden;
}
.providers__bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ax-accent);
}
.providers__note {
  margin-top: var(--ax-space-4);
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
</style>
