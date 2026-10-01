<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchAllReserves, fetchIncidents, fetchReserves, fetchStats, type Reserve, type ReserveIncident, type Stats } from '@/api/client'
import EmptyState from '@/components/EmptyState.vue'
import KpiCard from '@/components/KpiCard.vue'
import ReserveField from '@/components/landing/ReserveField.vue'
import ReserveTable from '@/components/ReserveTable.vue'
import { buildLanes, countBySeverity } from '@/composables/useLanding'
import WalletLookup from '@/components/WalletLookup.vue'
import { duration, time, usd } from '@/lib/format'
import { SCOPE, providerSummaries } from '@/lib/blastRadius'
import { openIncidents, pausedReserves } from '@/lib/incidents'
import { healthState, priceState } from '@/lib/priceState'

const router = useRouter()
/** Warnings shown in Needs attention; most are the same single-feed issue, so the rest are counted. */
const ATTENTION_WARNINGS = 5

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

async function load() {
  const { signal } = controller
  loading.value = true
  error.value = null
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
}
onMounted(load)

const noFallback = computed(() => reserves.value.filter((r) => r.checks.some((c) => c.code === 'NO_FALLBACK')))
const noFallbackSupply = computed(() => noFallback.value.reduce((sum, r) => sum + r.totalSupplyUsd, 0))

/** The largest stock-market closure recorded: a tokenized stock left without a fresh price for hours. */
const largestFreeze = computed(() => {
  const seconds = (i: ReserveIncident) => i.durationSeconds ?? Math.max(0, (Date.now() - Date.parse(i.startedAt)) / 1000)
  // At least an hour long, so a closure noticed for a few minutes is not told as a story.
  const closures = incidents.value.filter((i) => i.checks.some((c) => c.code === 'MARKET_CLOSED') && seconds(i) >= 3600)
  const largest = [...closures].sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)[0]
  if (!largest) return null
  const age = reserves.value.find((r) => r.address === largest.reserve)?.price.ageSeconds ?? null
  return { incident: largest, ongoing: !largest.endedAt, label: duration(Math.round(seconds(largest))), age: age === null ? null : duration(age) }
})

const switchboardListed = computed(() => switchboard.value?.filter((r) => r.market.name) ?? [])
const switchboardUnlisted = computed(() => switchboard.value?.filter((r) => !r.market.name) ?? [])

const totalSupply = computed(() => reserves.value.reduce((sum, r) => sum + r.totalSupplyUsd, 0))
const protocolCount = computed(() => new Set(reserves.value.map((r) => r.protocol)).size)
/** Same definition as the Incidents page and the front page. */
const openNow = computed(() => openIncidents(reserves.value))
/** Stocks paused only because the US market is closed: expected, so counted apart from incidents. */
const pausedNow = computed(() => pausedReserves(reserves.value))
const warnings = computed(() => reserves.value.filter((r) => r.severity === 'warning'))
/**
 * Deposits whose price the protocol cannot use right now, apart from stocks paused by their closed
 * market. Reserves this small (e.g. vaults left empty) would only add noise to the figure.
 */
const BLOCKED_MIN_USD = 1_000
const blocked = computed(() => reserves.value.filter((r) => r.totalSupplyUsd >= BLOCKED_MIN_USD && priceState(r) === 'blocked'))
const paused = computed(() => reserves.value.filter((r) => r.totalSupplyUsd >= BLOCKED_MIN_USD && priceState(r) === 'paused'))
const supplyOf = (list: Reserve[]) => list.reduce((sum, r) => sum + r.totalSupplyUsd, 0)

/** Critical reserves under the $1K floor: told apart, so the figures above them stay meaningful. */
const smallCritical = computed(() => reserves.value.filter((r) => healthState(r) === 'critical' && r.totalSupplyUsd < BLOCKED_MIN_USD))

/** The plain-language answer at the top of the page, from the same figures as the tiles. */
const verdict = computed(() => {
  const n = blocked.value.length
  const head = n
    ? `${n} ${n === 1 ? 'reserve' : 'reserves'} holding ${usd(supplyOf(blocked.value))} ${n === 1 ? 'has' : 'have'} a price the protocol can't use right now`
    : 'No reserve holding $1K or more is blocked by a broken price'
  const pausedPart = paused.value.length ? `; ${usd(supplyOf(paused.value))} is paused while the US market is closed` : ''
  const m = smallCritical.value.length
  const smallPart = m ? ` ${m} critical ${m === 1 ? 'reserve holds' : 'reserves hold'} under $1K.` : ''
  return `${head}${pausedPart}.${smallPart}`
})

/**
 * The largest single dependency today: the oracle provider whose failure alone would leave the most
 * listed supply with no usable price (lib/blastRadius.ts). Scope is Kamino's relay, not an oracle
 * provider, so it is left out here.
 */
const largestDependency = computed(() => {
  if (!reserves.value.length) return null
  return providerSummaries(reserves.value).find((p) => !p.structure && p.provider !== SCOPE && p.stopsCount > 0) ?? null
})
const blastTo = computed(() => ({ name: 'blast-radius', query: largestDependency.value ? { provider: largestDependency.value.provider } : {} }))

const bySupply = (a: Reserve, b: Reserve) => b.totalSupplyUsd - a.totalSupplyUsd
const bigCritical = computed(() => reserves.value.filter((r) => healthState(r) === 'critical' && r.totalSupplyUsd >= BLOCKED_MIN_USD).sort(bySupply))
const warningRows = computed(() => reserves.value.filter((r) => healthState(r) === 'warning').sort(bySupply))
/** Broken prices holding $1K or more first, then market-hours pauses, then the largest warnings. */
const needsAttention = computed(() => [...bigCritical.value, ...pausedNow.value, ...warningRows.value.slice(0, ATTENTION_WARNINGS)])
const moreWarnings = computed(() => Math.max(0, warningRows.value.length - ATTENTION_WARNINGS))

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

const latestCheck = computed(() => Math.max(...reserves.value.map((r) => Date.parse(r.checkedAt))))
const lastChecked = computed(() => (Number.isFinite(latestCheck.value) ? time(latestCheck.value) : null))
/** Checks run every 5 minutes; three missed runs in a row mean the figures are no longer live. */
const STALE_AFTER_MS = 15 * 60_000
const fresh = computed(() => Number.isFinite(latestCheck.value) && Date.now() - latestCheck.value < STALE_AFTER_MS)
/** The status dot is about the data only: grey offline, amber when not live, green when fresh. Health is in the tiles. */
const statusTone = computed(() => (error.value || loading.value ? 'muted' : fresh.value ? 'success' : 'warning'))
</script>

<template>
  <!-- One root: the layout pads each top-level block, so separate blocks would stack their padding. -->
  <div class="overview">
    <header class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <h1 class="ax-page-head__title">Overview</h1>
          <p class="ax-page-head__subtitle verdict" aria-live="polite">
            <span v-if="loading" class="ax-skeleton ax-skeleton--line verdict__skeleton" aria-hidden="true"></span>
            <template v-else-if="error">Live data could not be loaded right now.</template>
            <template v-else>{{ verdict }}</template>
          </p>
          <p class="status">
            <span class="status__dot" :class="`status__dot--${statusTone}`" aria-hidden="true"></span>
            <template v-if="error">Offline</template>
            <template v-else-if="loading">Loading the latest check…</template>
            <template v-else>
              {{ fresh ? 'Live' : 'Not updated recently' }} · {{ reserves.length }} listed reserves on {{ protocolCount }} protocols, checked every 5
              minutes<template v-if="lastChecked"
                >, last at <span class="ax-num">{{ lastChecked }}</span></template
              >
            </template>
          </p>
        </div>
      </div>
    </header>

    <div class="ax-dash-grid" :aria-busy="loading">
      <!-- Only tiles whose link opens a list of exactly what they count are links. -->
      <KpiCard
        label="Deposits watched"
        :loading="loading"
        :value="error ? '—' : usd(totalSupply)"
        :hint="error ? null : `In ${reserves.length} listed reserves on Kamino, marginfi and Jupiter Lend`"
        :to="error ? undefined : { name: 'reserves' }"
      />
      <KpiCard
        label="Open incidents"
        :loading="loading"
        :value="error ? '—' : String(openNow.length)"
        :tone="openNow.length ? 'danger' : undefined"
        :hint="
          error
            ? null
            : `Listed reserves with a broken price and money in them${pausedNow.length ? `; +${pausedNow.length} paused while the US market is closed` : ''}`
        "
        :to="error ? undefined : { name: 'incidents' }"
      />
      <KpiCard
        label="Warnings"
        :loading="loading"
        :value="error ? '—' : String(warnings.length)"
        :tone="warnings.length ? 'warning' : undefined"
        :hint="error ? null : 'Listed reserves whose worst issue is a warning'"
      />
      <KpiCard label="Money blocked now" :loading="loading" :value="error ? '—' : usd(supplyOf(blocked))" :tone="blocked.length ? 'danger' : undefined">
        <template v-if="!error">
          <template v-if="blocked.length">In {{ blocked.length }} {{ blocked.length === 1 ? 'reserve' : 'reserves' }}</template>
          <template v-else>Nothing holding $1K or more is blocked</template>
          <template v-if="paused.length">; {{ usd(supplyOf(paused)) }} paused while the US market is closed</template>
        </template>
      </KpiCard>

      <section v-if="error" class="ax-card ax-col--12">
        <EmptyState tone="error" title="Can't reach the API right now">
          The figures on this page come from the live API, which did not answer. Try again in a moment.
          <template #actions>
            <button type="button" class="ax-btn ax-btn--secondary ax-btn--sm" @click="load">Retry</button>
          </template>
        </EmptyState>
      </section>

      <!-- The front page's reserve field, so the same picture greets the visitor inside the app. -->
      <div v-if="!error" class="ax-col--12">
        <ReserveField compact :lanes="buildLanes(loading ? null : reserves)" :by-severity="loading ? null : countBySeverity(reserves)" />
        <p class="field-more"><RouterLink :to="{ name: 'rates' }">Compare lending rates →</RouterLink></p>
      </div>

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

      <!-- Two tools that go further than today's health: what would stop if an oracle failed, and rates. -->
      <section class="ax-card ax-col--12 tools" aria-label="Explore">
        <div class="tools__item">
          <h2 class="ax-card__title">If an oracle fails</h2>
          <p class="tools__text">Pick an oracle and see which reserves would have no usable price without it.</p>
          <p v-if="loading" class="tools__fact"><span class="ax-skeleton ax-skeleton--line tools__skeleton" aria-hidden="true"></span></p>
          <p v-else-if="largestDependency" class="tools__fact">
            Largest single dependency today: <b>{{ largestDependency.provider }}</b>,
            <span class="ax-num">{{ usd(largestDependency.stopsUsd) }}</span> in {{ largestDependency.stopsCount }}
            {{ largestDependency.stopsCount === 1 ? 'reserve' : 'reserves' }} that would have no usable price without it.
          </p>
          <RouterLink class="tools__link" :to="blastTo">Play it out →</RouterLink>
        </div>
        <div class="tools__item">
          <h2 class="ax-card__title">Lending rates</h2>
          <p class="tools__text">Supply APY next to the oracle health of the collateral behind it.</p>
          <RouterLink class="tools__link" :to="{ name: 'rates' }">Compare rates →</RouterLink>
        </div>
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
            <template v-if="largestFreeze.ongoing">
              <!-- The same figure as the reserve's row: the age of its last price. -->
              {{ largestFreeze.incident.asset }} ({{ usd(largestFreeze.incident.totalSupplyUsd) }}) is paused while the US market is
              closed<template v-if="largestFreeze.age">: its last price is {{ largestFreeze.age }} old</template>, so loans against it cannot be liquidated.
            </template>
            <template v-else>
              {{ largestFreeze.incident.asset }} ({{ usd(largestFreeze.incident.totalSupplyUsd) }}) had no usable price for {{ largestFreeze.label }}
              while the US market was closed, so loans against it could not be liquidated.
            </template>
          </span>
          <span class="story__more">{{ largestFreeze.incident.asset }} →</span>
        </RouterLink>
        <div v-if="!loading && noFallbackSupply" class="story ax-card">
          <span class="story__kicker">No fallback oracle</span>
          <span class="story__text">
            {{ usd(noFallbackSupply) }} ({{ Math.round((noFallbackSupply / totalSupply) * 100) }}% of listed supply) is priced by a single feed: if it
            stops, the price stops.
          </span>
          <span class="story__links">
            <RouterLink class="story__more" :to="{ name: 'reserves', query: { issue: 'NO_FALLBACK' } }">All reserves →</RouterLink>
            <RouterLink class="story__more" :to="blastTo">See what stops if one feed fails →</RouterLink>
          </span>
        </div>
      </div>

      <template v-if="!error">
        <section class="ax-card ax-col--8" aria-labelledby="attention-title">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 id="attention-title" class="ax-card__title">Needs attention</h2>
              <p class="ax-card__subtitle">Broken prices holding $1K or more first, then market-hours pauses, then the largest warnings</p>
            </div>
            <div class="ax-card__actions">
              <RouterLink class="ax-btn ax-btn--secondary ax-btn--sm" :to="{ name: 'reserves', query: { health: 'issues' } }">All with issues</RouterLink>
            </div>
          </div>
          <template v-if="loading || needsAttention.length">
            <ReserveTable compact :rows="needsAttention" :loading-rows="loading ? 6 : 0" />
            <div v-if="!loading && (moreWarnings || smallCritical.length)" class="attention-note">
              <p v-if="moreWarnings">
                + {{ moreWarnings }} more {{ moreWarnings === 1 ? 'reserve' : 'reserves' }} with a warning.
                <RouterLink :to="{ name: 'reserves', query: { health: 'issues' } }">All with issues →</RouterLink>
              </p>
              <p v-if="smallCritical.length">
                + {{ smallCritical.length }} critical {{ smallCritical.length === 1 ? 'reserve' : 'reserves' }} holding under $1K.
                <RouterLink :to="{ name: 'reserves', query: { health: 'critical' } }">All with score ≤ 50 →</RouterLink>
              </p>
            </div>
          </template>
          <EmptyState v-else title="All clear">No reserve holding $1K or more has a broken price, and none has a warning.</EmptyState>
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
              <li v-for="n in 8" :key="n">
                <div class="providers__row">
                  <span class="ax-skeleton ax-skeleton--line" :style="{ width: `${48 - n * 3}%` }"></span>
                  <span class="ax-skeleton ax-skeleton--line" style="width: 22%"></span>
                </div>
                <div class="providers__bar"></div>
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
.verdict {
  max-width: 72ch;
  color: var(--ax-text-strong);
}
.verdict__skeleton {
  display: block;
  width: min(520px, 90%);
  height: 1.1em;
}
.status {
  margin-block-start: var(--ax-space-2);
  font-size: var(--ax-text-xs);
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

.field-more {
  margin: var(--ax-space-2) 0 0;
  text-align: end;
  font-size: var(--ax-text-sm);
}
.field-more a,
.tools__link {
  color: var(--ax-link, var(--ax-accent-text));
  font-weight: 600;
}
.tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 0;
}
.tools__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ax-space-2);
  padding: var(--ax-space-5) var(--ax-space-6);
}
.tools__item + .tools__item {
  border-inline-start: 1px solid var(--ax-border);
}
@media (max-width: 768px) {
  .tools {
    grid-template-columns: 1fr;
  }
  .tools__item + .tools__item {
    border-inline-start: 0;
    border-block-start: 1px solid var(--ax-border);
  }
}
.tools__text,
.tools__fact {
  margin: 0;
  max-width: 64ch;
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.tools__fact b {
  color: var(--ax-text-strong);
}
.tools__skeleton {
  display: block;
  width: 70%;
}
.tools__link {
  margin-top: auto;
  font-size: var(--ax-text-sm);
}
.story__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-1) var(--ax-space-4);
  margin-top: auto;
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

.attention-note {
  display: grid;
  gap: var(--ax-space-1);
  margin: 0;
  padding: var(--ax-space-3) var(--ax-space-6);
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
  border-top: 1px solid var(--ax-border);
}
.attention-note a {
  color: var(--ax-link, var(--ax-accent-text));
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
