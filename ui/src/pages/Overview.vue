<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchAllReserves, fetchIncidents, fetchReserves, fetchStats, type Reserve, type ReserveIncident, type Severity, type Stats } from '@/api/client'
import EmptyState from '@/components/EmptyState.vue'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTable from '@/components/ReserveTable.vue'
import WalletLookup from '@/components/WalletLookup.vue'
import { time, usd } from '@/lib/format'
import { priceState } from '@/lib/priceState'

const router = useRouter()
const ATTENTION_ROWS = 10

const reserves = ref<Reserve[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

/** Reserves still depending on Switchboard, and past incidents: they feed the story cards. */
const switchboard = ref<Reserve[] | null>(null)
const incidents = ref<ReserveIncident[]>([])
/** Wallets people watch through the bot: shown once there are some. */
const stats = ref<Stats | null>(null)

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
  fetchStats(signal).then((s) => (stats.value = s), () => {})
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
const protocolCount = computed(() => new Set(reserves.value.map((r) => r.protocol)).size)
const critical = computed(() => reserves.value.filter((r) => r.severity === 'critical'))
const warnings = computed(() => reserves.value.filter((r) => r.severity === 'warning'))
/**
 * Deposits whose price the protocol cannot use right now, apart from stocks paused by their closed
 * market. Reserves this small (e.g. vaults left empty) would only add noise to the figure.
 */
const BLOCKED_MIN_USD = 1_000
const blocked = computed(() => reserves.value.filter((r) => r.totalSupplyUsd >= BLOCKED_MIN_USD && priceState(r) === 'blocked'))
const paused = computed(() => reserves.value.filter((r) => r.totalSupplyUsd >= BLOCKED_MIN_USD && priceState(r) === 'paused'))
const supplyOf = (list: Reserve[]) => list.reduce((sum, r) => sum + r.totalSupplyUsd, 0)

/** The colour of the live status dot: the worst health among listed reserves. */
const statusTone = computed(() => (critical.value.length ? 'danger' : warnings.value.length ? 'warning' : 'success'))

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
  <!-- One root: the layout pads each top-level block, so separate blocks would stack their padding. -->
  <div class="overview">
    <header class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <h1 class="ax-page-head__title">Overview</h1>
          <p class="status" :aria-busy="loading">
            <span class="status__dot" :class="`status__dot--${error ? 'muted' : statusTone}`" aria-hidden="true"></span>
            <template v-if="error">Live data could not be loaded right now</template>
            <template v-else-if="loading">Loading the latest check…</template>
            <template v-else>
              Live · {{ reserves.length }} listed reserves on {{ protocolCount }} protocols, checked every 5 minutes<template v-if="lastChecked"
                >, last at <span class="ax-num">{{ lastChecked }}</span></template
              >
            </template>
          </p>
        </div>
        <div class="ax-page-head__actions">
          <a class="ax-btn ax-btn--ghost ax-btn--sm" href="/api/docs" target="_blank" rel="noopener">Public API</a>
        </div>
      </div>
    </header>

    <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>

    <div class="ax-dash-grid" :aria-busy="loading">
      <template v-if="!error">
        <KpiCard
          label="Deposits watched"
          icon="layout-dashboard"
          :loading="loading"
          :value="usd(totalSupply)"
          :hint="`In ${reserves.length} listed reserves on Kamino, marginfi and Jupiter Lend`"
          :to="{ name: 'reserves' }"
        />
        <KpiCard
          label="Critical"
          icon="alert-triangle"
          :loading="loading"
          :value="String(critical.length)"
          :tone="critical.length ? 'danger' : undefined"
          hint="Listed reserves with a critical issue"
          :to="{ name: 'incidents' }"
        />
        <KpiCard
          label="Warnings"
          icon="bell"
          :loading="loading"
          :value="String(warnings.length)"
          :tone="warnings.length ? 'warning' : undefined"
          hint="Listed reserves with a warning"
          :to="{ name: 'reserves', query: { health: 'issues' } }"
        />
        <KpiCard
          label="Can't be priced now"
          icon="lock"
          :loading="loading"
          :value="usd(supplyOf(blocked))"
          :tone="blocked.length ? 'danger' : undefined"
          :to="{ name: 'reserves', query: { health: 'critical' } }"
        >
          <template v-if="blocked.length">In {{ blocked.length }} {{ blocked.length === 1 ? 'reserve' : 'reserves' }}</template>
          <template v-else>Every listed reserve has a usable price</template>
          <template v-if="paused.length">; {{ usd(supplyOf(paused)) }} paused while the US market is closed</template>
        </KpiCard>
      </template>

      <!-- The one action a depositor comes for. -->
      <section class="ax-card ax-col--12 wallet" aria-labelledby="wallet-title">
        <div class="wallet__text">
          <h2 id="wallet-title" class="ax-card__title">Check a wallet</h2>
          <p class="wallet__lede">See which deposits, loans and vault shares rely on a broken price, and where a loan would be liquidated.</p>
          <p v-if="stats?.walletsWatched" class="wallet__watched">
            <span class="ax-num">{{ stats.walletsWatched }}</span> {{ stats.walletsWatched === 1 ? 'wallet' : 'wallets' }}
            (<span class="ax-num">{{ usd(stats.valueWatchedUsd) }}</span> deposited) watched for personal alerts
          </p>
        </div>
        <WalletLookup class="wallet__lookup" @lookup="(address) => router.push({ name: 'positions', query: { address } })" />
      </section>

      <div v-if="switchboard?.length || largestFreeze || (!loading && noFallbackSupply)" class="ax-col--12 stories">
        <RouterLink v-if="switchboard && switchboard.length" class="story ax-card" :to="{ name: 'switchboard' }">
          <span class="story__kicker">Switchboard shut down on 25 Sep</span>
          <span class="story__text">
            <template v-if="switchboardListed.length">{{ switchboardListed.length }} listed reserves still depend on it.</template>
            <template v-else-if="switchboardUnlisted.length">No listed market depends on it; {{ switchboardUnlisted.length }} unlisted reserves still do.</template>
            <template v-else>No market depends on it any more.</template>
          </span>
          <span class="story__more">Switchboard exposure →</span>
        </RouterLink>
        <RouterLink v-if="largestFreeze" class="story ax-card" :to="{ name: 'reserve', params: { address: largestFreeze.incident.reserve } }">
          <span class="story__kicker">Frozen by market hours</span>
          <span class="story__text">
            {{ largestFreeze.incident.asset }} ({{ usd(largestFreeze.incident.totalSupplyUsd) }}) had no usable price for {{ largestFreeze.label }}
            while the US market was closed, so loans against it could not be liquidated.
          </span>
          <span class="story__more">{{ largestFreeze.incident.asset }} →</span>
        </RouterLink>
        <RouterLink v-if="!loading && noFallbackSupply" class="story ax-card" :to="{ name: 'reserves', query: { issue: 'NO_FALLBACK' } }">
          <span class="story__kicker">No fallback oracle</span>
          <span class="story__text">
            {{ usd(noFallbackSupply) }} ({{ Math.round((noFallbackSupply / totalSupply) * 100) }}% of listed supply) is priced by a single feed: if it
            stops, the price stops.
          </span>
          <span class="story__more">All reserves →</span>
        </RouterLink>
      </div>

      <template v-if="!error">
        <section class="ax-card ax-col--8" aria-labelledby="attention-title">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 id="attention-title" class="ax-card__title">Needs attention</h2>
              <p class="ax-card__subtitle">Critical issues first, then the largest warnings</p>
            </div>
            <div class="ax-card__actions">
              <RouterLink class="ax-btn ax-btn--secondary ax-btn--sm" :to="{ name: 'reserves', query: { health: 'issues' } }">All with issues</RouterLink>
            </div>
          </div>
          <ReserveTable v-if="loading || needsAttention.length" compact :rows="needsAttention" :loading-rows="loading ? 6 : 0" />
          <EmptyState v-else title="All clear">No listed reserve has a critical issue or a warning right now.</EmptyState>
        </section>

        <section class="ax-card ax-col--4" aria-labelledby="providers-title">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 id="providers-title" class="ax-card__title">Who prices the money</h2>
              <p class="ax-card__subtitle">Share of listed supply each oracle provider feeds into</p>
            </div>
          </div>
          <div class="ax-card__body">
            <ul v-if="loading" class="providers" aria-hidden="true">
              <li v-for="n in 6" :key="n">
                <span class="ax-skeleton ax-skeleton--line" :style="{ width: `${90 - n * 8}%` }"></span>
              </li>
            </ul>
            <ul v-else class="providers">
              <li v-for="p in providerShare" :key="p.provider">
                <div class="providers__row">
                  <span class="providers__name">{{ p.provider }}</span>
                  <span class="ax-num providers__value">{{ usd(p.value) }} <span class="providers__pct">{{ Math.round(p.share * 100) }}%</span></span>
                </div>
                <div class="providers__bar"><span :style="{ width: `${Math.max(2, p.share * 100)}%` }"></span></div>
              </li>
            </ul>
            <p class="providers__note">A reserve counts once for every provider its price depends on, so shares add up to more than 100%.</p>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Card subtitles stay at a readable line length. */
.ax-card__subtitle {
  max-width: 72ch;
}
.status {
  margin-block-start: var(--ax-space-1);
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.status__dot {
  display: inline-block;
  vertical-align: 0.05em;
  margin-inline-end: var(--ax-space-2);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--ax-text-subtle);
}
.status__dot--danger {
  background: var(--ax-danger-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ax-danger-500) 20%, transparent);
}
.status__dot--warning {
  background: var(--ax-warning-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ax-warning-500) 20%, transparent);
}
.status__dot--success {
  background: var(--ax-success-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ax-success-500) 20%, transparent);
}
.overview > .ax-alert {
  margin-block-end: var(--ax-space-6);
}

/* Wallet check: the pitch on the left, the form on the right; stacked on narrow screens. */
.wallet {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  align-items: center;
  gap: var(--ax-space-4) var(--ax-space-8);
  padding: var(--ax-space-5) var(--ax-space-6);
}
@media (max-width: 1100px) {
  .wallet {
    grid-template-columns: 1fr;
  }
}
.wallet__text {
  display: grid;
  gap: var(--ax-space-1);
}
.wallet__lede {
  margin: 0;
  max-width: 60ch;
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.wallet__watched {
  margin: var(--ax-space-1) 0 0;
  font-size: var(--ax-text-xs);
  color: var(--ax-text-subtle);
}
.wallet__lookup :deep(.lookup__input) {
  max-width: none;
}

.stories {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: inherit;
}
.story {
  display: grid;
  gap: var(--ax-space-2);
  align-content: start;
  padding: var(--ax-space-4) var(--ax-space-5);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s;
}
.story:hover {
  border-color: var(--ax-border-strong);
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
  color: var(--ax-text-muted);
}
.story__text {
  color: var(--ax-text-strong);
  font-size: var(--ax-text-sm);
  line-height: 1.5;
}
.story__more {
  margin-top: auto;
  font-size: var(--ax-text-sm);
  color: var(--ax-link);
  font-weight: 600;
}

.providers {
  display: grid;
  gap: var(--ax-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.providers__row {
  display: flex;
  justify-content: space-between;
  gap: var(--ax-space-3);
  font-size: var(--ax-text-sm);
  margin-bottom: var(--ax-space-1);
}
.providers__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ax-text-strong);
}
.providers__value {
  flex: 0 0 auto;
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.providers__pct {
  display: inline-block;
  min-width: 4ch;
  text-align: end;
  color: var(--ax-text-strong);
}
.providers__bar {
  height: 4px;
  border-radius: 2px;
  background: var(--ax-fill-hover);
  overflow: hidden;
}
.providers__bar span {
  display: block;
  height: 100%;
  background: var(--ax-accent);
}
.providers__note {
  margin: var(--ax-space-4) 0 0;
  color: var(--ax-text-subtle);
  font-size: var(--ax-text-xs);
}
</style>
