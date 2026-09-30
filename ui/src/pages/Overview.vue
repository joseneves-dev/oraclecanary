<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchAllReserves, fetchIncidents, fetchReserves, fetchStats, type Reserve, type ReserveIncident, type Severity, type Stats } from '@/api/client'
import ReserveTable from '@/components/ReserveTable.vue'
import WalletLookup from '@/components/WalletLookup.vue'
import { time, usd } from '@/lib/format'
import { TELEGRAM_BOT, TELEGRAM_CHANNEL_URL as TELEGRAM_URL } from '@/lib/links'
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
  <!-- One wrapper: the layout pads each top-level block, which would stretch a bare card edge to edge. -->
  <div class="intro">
  <div class="top">
    <section class="ax-card ax-welcome hero" aria-labelledby="hero-title">
      <div class="ax-welcome__body">
        <div class="ax-welcome__text hero__text">
          <span class="ax-welcome__eyebrow">The canary in the coal mine for Solana lending</span>
          <h1 id="hero-title" class="hero__title">When a lending oracle fails, withdrawals and liquidations silently stop.</h1>
          <p class="hero__lead">
            OracleCanary checks the price behind every Kamino, marginfi and Jupiter Lend reserve every 5 minutes, raises the alarm when one
            breaks, and lets a transaction refuse a broken price on-chain. Is your money exposed? Check a wallet on Kamino or marginfi.
          </p>
          <WalletLookup large @lookup="(address) => router.push({ name: 'positions', query: { address } })" />
          <ul v-if="!loading && !error" class="facts" aria-label="Coverage">
            <li><b>{{ usd(totalSupply) }}</b> in deposits watched</li>
            <li><b>{{ reserves.length }}</b> listed reserves</li>
            <li><b>{{ protocolCount }}</b> protocols</li>
            <li>checked every <b>5 min</b></li>
            <li><b>open source</b>, free API</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- The monitor's own pulse, and where to go next. -->
    <section class="ax-card live" aria-labelledby="live-title" :aria-busy="loading">
      <div class="live__head">
        <span class="status__dot" :class="`status__dot--${statusTone}`" aria-hidden="true"></span>
        <h2 id="live-title" class="ax-eyebrow live__title">Live now</h2>
        <span v-if="lastChecked" class="live__time">checked at {{ lastChecked }}</span>
      </div>
      <p v-if="error" class="muted">Live data could not be loaded right now.</p>
      <div v-else class="live__stats">
        <RouterLink class="live__stat" :to="{ name: 'incidents' }">
          <span class="live__value" :class="{ 'live__value--danger': critical.length }">{{ loading ? '…' : critical.length }}</span>
          <span class="live__label">Critical</span>
        </RouterLink>
        <RouterLink class="live__stat" :to="{ name: 'reserves', query: { health: 'issues' } }">
          <span class="live__value" :class="{ 'live__value--warning': warnings.length }">{{ loading ? '…' : warnings.length }}</span>
          <span class="live__label">Warnings</span>
        </RouterLink>
      </div>
      <RouterLink v-if="!loading && !error" class="live__blocked" :class="{ 'live__blocked--none': !blocked.length }" :to="{ name: 'reserves', query: { health: 'critical' } }">
        <span class="live__value" :class="{ 'live__value--danger': blocked.length }">{{ usd(supplyOf(blocked)) }}</span>
        <span class="live__label">
          of deposits can't be priced right now<template v-if="blocked.length"> ({{ blocked.length }} {{ blocked.length === 1 ? 'reserve' : 'reserves' }})</template
          ><template v-if="paused.length">; {{ usd(supplyOf(paused)) }} paused while the US market is closed</template>
        </span>
      </RouterLink>
      <p v-if="stats?.walletsWatched" class="live__watched">
        {{ stats.walletsWatched }} {{ stats.walletsWatched === 1 ? 'wallet' : 'wallets' }} ({{ usd(stats.valueWatchedUsd) }} deposited) watched for personal alerts
      </p>
      <a class="ax-btn ax-btn--primary ax-btn--sm live__cta" :href="TELEGRAM_URL" target="_blank" rel="noopener">Get alerts on Telegram</a>
      <nav class="live__links" aria-label="More">
        <RouterLink :to="{ name: 'incidents' }">Incidents →</RouterLink>
        <RouterLink :to="{ name: 'how-it-works' }">How it works →</RouterLink>
        <a href="/api/docs" target="_blank" rel="noopener">Public API →</a>
      </nav>
    </section>
  </div>

  <div class="stories">
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
  </div>

  <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>

  <div v-else class="ax-dash-grid" :aria-busy="loading">
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

  <div class="ax-dash-grid">
    <h2 class="ax-col--12 audience__title">Who it's for</h2>
    <section class="ax-card ax-col--4 audience" aria-labelledby="for-people">
      <h3 id="for-people" class="audience__who">Depositors and borrowers</h3>
      <p>
        See which of your deposits, loans and vault shares rely on a broken price, and at what price a loan would be liquidated. Get a Telegram
        message when a price your account relies on breaks.
      </p>
      <div class="audience__links">
        <RouterLink :to="{ name: 'positions' }">Check a wallet →</RouterLink>
        <a :href="`https://t.me/${TELEGRAM_BOT}`" target="_blank" rel="noopener">Wallet alerts bot →</a>
      </div>
    </section>
    <section class="ax-card ax-col--4 audience" aria-labelledby="for-protocols">
      <h3 id="for-protocols" class="audience__who">Protocols and vault curators</h3>
      <p>
        An independent check of every reserve against the protocol's own rules, a record of every change to how a reserve is priced, and an
        on-chain guard that lets a program refuse to act on a broken price. Findings go to the team privately first.
      </p>
      <div class="audience__links">
        <RouterLink :to="{ name: 'how-it-works' }">Methodology and guard →</RouterLink>
        <RouterLink :to="{ name: 'incidents' }">Incidents →</RouterLink>
      </div>
    </section>
    <section class="ax-card ax-col--4 audience" aria-labelledby="for-integrators">
      <h3 id="for-integrators" class="audience__who">Integrators and researchers</h3>
      <p>
        A free public API in JSON and CSV: every reserve's health and history, incidents, configuration changes, and a signed attestation per
        reserve that a wallet, dashboard or program can check.
      </p>
      <div class="audience__links">
        <a href="/api/docs" target="_blank" rel="noopener">Public API →</a>
        <a href="https://github.com/joseneves-dev/oraclecanary" target="_blank" rel="noopener">Code on GitHub →</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* The action on the left, the monitor's pulse on the right; stacked on narrow screens. */
.top {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: var(--ax-space-4);
  margin-bottom: var(--ax-space-4);
}
@media (max-width: 1100px) {
  .top {
    grid-template-columns: 1fr;
  }
}
.hero__text {
  gap: var(--ax-space-3);
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
  max-width: 64ch;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-2) var(--ax-space-5);
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.facts b {
  font-family: var(--ax-font-display);
  color: var(--ax-text-strong);
}
.audience__title {
  font-family: var(--ax-font-display);
  font-size: var(--ax-text-lg);
  color: var(--ax-text-strong);
  margin: 0;
}
.audience {
  display: grid;
  gap: var(--ax-space-3);
  align-content: start;
  padding: var(--ax-space-5);
  font-size: var(--ax-text-sm);
}
.audience__who {
  font-size: var(--ax-text-md, 1rem);
  font-weight: 600;
  color: var(--ax-text-strong);
  margin: 0;
}
.audience__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-4);
}
.audience__links a {
  color: var(--ax-link);
  font-weight: 600;
}
.live {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-4);
  padding: var(--ax-space-5);
}
.live__head {
  display: flex;
  align-items: center;
  gap: var(--ax-space-2);
}
.live__title {
  margin: 0;
}
.live__time {
  margin-inline-start: auto;
  font-size: var(--ax-text-xs);
  color: var(--ax-text-subtle);
}
.live__stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--ax-space-2);
}
.live__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ax-space-3);
  border: 1px solid var(--ax-border);
  border-radius: var(--ax-radius-md);
  background: var(--ax-surface-subtle);
  color: inherit;
  text-decoration: none;
}
a.live__stat:hover {
  border-color: var(--ax-border-strong);
}
.live__value {
  font-family: var(--ax-font-display);
  font-size: var(--ax-text-xl);
  font-weight: var(--ax-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--ax-text-strong);
}
.live__value--danger {
  color: var(--ax-danger-500);
}
.live__value--warning {
  color: var(--ax-warning-500);
}
.live__label {
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.live__blocked {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ax-space-3);
  border: 1px solid color-mix(in srgb, var(--ax-danger-500) 35%, var(--ax-border));
  border-radius: var(--ax-radius-md);
  background: color-mix(in srgb, var(--ax-danger-500) 6%, var(--ax-surface-subtle));
  color: inherit;
  text-decoration: none;
}
.live__blocked--none {
  border-color: var(--ax-border);
  background: var(--ax-surface-subtle);
}
.live__watched {
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.live__cta {
  justify-content: center;
}
.live__links {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--ax-space-2);
  font-size: var(--ax-text-sm);
}
.live__links a {
  color: var(--ax-link);
  font-weight: 600;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
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
.stories {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--ax-space-4);
}
/* The grid below brings its own top padding. */
.intro {
  padding-block-end: 0 !important;
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
