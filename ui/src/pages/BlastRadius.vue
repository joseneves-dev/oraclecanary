<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { fetchAllReserves, fetchReserves, type Reserve } from '@/api/client'
import BlastTable, { type BlastRow } from '@/components/blast/BlastTable.vue'
import FeedList from '@/components/blast/FeedList.vue'
import MarketBreakdown from '@/components/blast/MarketBreakdown.vue'
import ProviderPicker from '@/components/blast/ProviderPicker.vue'
import EmptyState from '@/components/EmptyState.vue'
import KpiCard from '@/components/KpiCard.vue'
import {
  SCOPE,
  SWITCHBOARD,
  type Exposure,
  type Reliance,
  dependencies,
  feedExposure,
  feedsOf,
  feedUses,
  isStructure,
  providerExposure,
  providerKey,
  providerSummaries,
} from '@/lib/blastRadius'
import { dateTime, protocolName, shortAddress, solscanAccount, usd } from '@/lib/format'
import { priceState } from '@/lib/priceState'

/**
 * "If an oracle fails": pick a provider (?provider=) or one feed account (?feed=) and see which
 * listed reserves would be left with no usable price and which keep one through a fallback. The
 * dependency rules live in lib/blastRadius.ts, tested against the indexer's own checks.
 */
const route = useRoute()

const reserves = ref<Reserve[]>([])
/** Reserves in unlisted markets still reading Switchboard: told apart, as on the Overview. */
const switchboardUnlisted = ref<Reserve[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const controller = new AbortController()
onBeforeUnmount(() => controller.abort())

async function load() {
  const { signal } = controller
  loading.value = true
  error.value = null
  fetchReserves({ check: 'DEPRECATED_PROVIDER', itemsPerPage: 500 }, signal).then(
    (rows) => (switchboardUnlisted.value = rows.filter((r) => !r.market.name)),
    () => {},
  )
  try {
    // Unlisted markets hold junk tokens with arbitrary prices, so the figures are for listed ones.
    reserves.value = await fetchAllReserves({ listed: true }, signal)
  } catch (e) {
    if (!signal.aborted) error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const queryValue = (key: string) => {
  const v = route.query[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
const feed = computed(() => queryValue('feed'))
/** The provider played out; Switchboard, the one that did fail, when none is asked for. */
const provider = computed(() => (feed.value ? null : providerKey(queryValue('provider') ?? SWITCHBOARD)))

const summaries = computed(() => providerSummaries(reserves.value))
const supplyOf = (rows: Reserve[]) => rows.reduce((sum, r) => sum + r.totalSupplyUsd, 0)
const totalSupply = computed(() => supplyOf(reserves.value))

/* ── Oracle-blocked right now: the Overview's "Money blocked now", by the same rule. ── */
const BLOCKED_MIN_USD = 1_000
const blocked = computed(() => reserves.value.filter((r) => r.totalSupplyUsd >= BLOCKED_MIN_USD && priceState(r) === 'blocked'))
const paused = computed(() => reserves.value.filter((r) => r.totalSupplyUsd >= BLOCKED_MIN_USD && priceState(r) === 'paused'))

/** The Overview's verdict, after the figure. */
const nowText = computed(() => {
  const count = blocked.value.length
  const head = count
    ? ` in ${n(count, 'reserve')} ${count === 1 ? 'has' : 'have'} a price the protocol can't use right now`
    : 'Nothing holding $1K or more is blocked by a broken price'
  const pausedPart = paused.value.length ? `; ${usd(supplyOf(paused.value))} is paused while the US market is closed` : ''
  return `${head}${pausedPart}.`
})

/* ── The scenario ── */
const exposure = computed<Exposure<Reserve> & { provider: string | null }>(() =>
  feed.value ? feedExposure(reserves.value, feed.value) : { ...providerExposure(reserves.value, provider.value!), provider: provider.value },
)
/** The provider behind what is shown: the one picked, or the feed account's. */
const subject = computed(() => provider.value ?? exposure.value.provider)
const structureView = computed(() => !!provider.value && isStructure(provider.value))
const reached = computed(() => exposure.value.stops.length + exposure.value.keeps.length + exposure.value.structure.length)

/** What else a price can come from, or also needs, beside `exclude`. */
function note(r: Reserve, reliance: Reliance, exclude: string | null): string {
  const deps = dependencies(r).filter((d) => d.provider !== exclude && d.provider !== SCOPE && d.reliance !== 'structure')
  const names = (want: Reliance) => deps.filter((d) => d.reliance === want).map((d) => d.provider)
  if (reliance === 'fallback') return names('fallback').length ? `Falls back on ${names('fallback').join(', ')}` : 'Has another source'
  if (reliance === 'structure') return deps.length ? `Priced by ${deps.map((d) => d.provider).join(', ')}` : 'No oracle'
  if (names('required').length) return `Also needs ${names('required').join(', ')}`
  if (exclude === SCOPE && names('fallback').length) return `Reads ${names('fallback').join(' or ')}, all through Scope`
  return 'No other source'
}

function rowsOf(e: Exposure<Reserve>): BlastRow[] {
  const exclude = subject.value
  return [...e.stops, ...e.keeps, ...e.structure].map((r) => {
    const use = feed.value ? feedUses(r).find((u) => u.account === feed.value) : undefined
    const reliance: Reliance = use?.reliance ?? (e.stops.includes(r) ? 'required' : e.keeps.includes(r) ? 'fallback' : 'structure')
    const entries = use?.entries ?? (exclude === SCOPE ? r.oracleAccounts.scopeChain : undefined)
    return { reserve: r, reliance, note: note(r, reliance, exclude), entries: entries?.length ? entries : undefined }
  })
}
const rows = computed(() => rowsOf(exposure.value))
const showEntries = computed(() => rows.value.some((r) => r.entries))

const largest = computed(() => exposure.value.stops[0] ?? null)
const blockedAmongStops = computed(() => exposure.value.stops.filter((r) => r.totalSupplyUsd >= BLOCKED_MIN_USD && priceState(r) === 'blocked'))

/** Switchboard outside the listed markets: the reserves that still had nothing else when it shut down. */
const unlistedSwitchboard = computed(() => providerExposure(switchboardUnlisted.value, SWITCHBOARD))
const unlistedRows = computed(() => rowsOf(unlistedSwitchboard.value))

/* ── Feeds behind the provider ── */
const directFeeds = computed(() => (provider.value && !structureView.value ? feedsOf(reserves.value, provider.value) : []))
/** Kamino reads every oracle through Scope price accounts; the accounts behind each entry are not listed. */
const scopeAccounts = computed(() => {
  if (!provider.value || provider.value === SCOPE || structureView.value) return []
  const kamino = [...exposure.value.stops, ...exposure.value.keeps].filter((r) => r.protocol === 'kamino' && r.oracleAccounts.scopePrices)
  const counts = new Map<string, number>()
  for (const r of kamino) counts.set(r.oracleAccounts.scopePrices!, (counts.get(r.oracleAccounts.scopePrices!) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([account, count]) => ({ account, count }))
})

/* ── Words ── */
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const name = computed(() => (subject.value === SCOPE ? "Kamino's Scope price accounts" : subject.value ?? 'this feed'))

const eyebrow = computed(() => {
  if (feed.value) return `Feed account · ${exposure.value.provider ?? 'not read by any listed reserve'}`
  if (provider.value === SWITCHBOARD) return 'Switchboard · shut down on 25 Sep 2026'
  if (provider.value === SCOPE) return 'Price relay · Kamino'
  if (structureView.value) return 'Rate or peg · not an oracle'
  return 'Oracle provider'
})

const headline = computed(() => {
  const e = exposure.value
  if (structureView.value) return `${usd(e.structureUsd)} across ${n(e.structure.length, 'reserve')} multiplies in ${provider.value}.`
  if (!reached.value) {
    if (feed.value) return 'No listed reserve reads this account.'
    return provider.value === SWITCHBOARD ? 'Switchboard has shut down, and no listed reserve depends on it any more.' : `No listed reserve reads ${provider.value}.`
  }
  const what = feed.value ? `If feed ${shortAddress(feed.value)} stopped updating` : provider.value === SWITCHBOARD ? 'Switchboard has shut down:' : `If ${name.value} stopped`
  if (provider.value === SWITCHBOARD) {
    return e.stops.length
      ? `${what} ${usd(e.stopsUsd)} across ${n(e.stops.length, 'listed reserve')} has no usable price.`
      : `${what} every listed reserve that still reads it has another source.`
  }
  if (!e.stops.length) return `${what}, no listed reserve would lose its price.`
  return `${what}, ${usd(e.stopsUsd)} across ${n(e.stops.length, 'reserve')} would have no usable price.`
})

const consequence = computed(() => {
  const e = exposure.value
  if (structureView.value) {
    return 'It is a rate or peg read from the token’s own program, not an oracle feed, so it is shown for completeness but never counted as a point of failure.'
  }
  const parts: string[] = []
  if (e.stops.length) parts.push('Borrowing, withdrawals and liquidations that need those prices would fail until it came back.')
  if (e.keeps.length) parts.push(`${usd(e.keepsUsd)} more in ${n(e.keeps.length, 'reserve')} keeps a price through a fallback.`)
  if (provider.value === SCOPE) parts.push('Scope copies oracle prices into the accounts Kamino reads, so a fallback between oracles inside Scope does not help if Scope itself stops.')
  if (provider.value === SWITCHBOARD) parts.push('No listed market on Kamino, marginfi or Jupiter Lend relies on it alone now.')
  return parts.join(' ')
})

const latestCheck = computed(() => Math.max(...reserves.value.map((r) => Date.parse(r.checkedAt))))
const checkedLabel = computed(() => (Number.isFinite(latestCheck.value) ? dateTime(latestCheck.value) : null))
const marketName = (r: Reserve) => r.market.name ?? shortAddress(r.market.address)

const print = () => window.print()
</script>

<template>
  <!-- One root: the layout pads each top-level block, so separate blocks would stack their padding. -->
  <div class="page">
    <div class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <h1 class="ax-page-head__title">If an oracle fails</h1>
          <p class="ax-page-head__subtitle">
            Pick an oracle, or a single feed account, and see every listed reserve on Kamino, marginfi and Jupiter Lend whose price would stop
            with it, and every one that would keep a price through a fallback.
          </p>
        </div>
        <div class="ax-page-head__actions no-print">
          <button type="button" class="ax-btn ax-btn--secondary ax-btn--sm" :disabled="loading || !!error" @click="print">Print or save as PDF</button>
        </div>
      </div>
    </div>

    <!-- Oracle-blocked right now: the Overview's "Money blocked now", by the same rule. -->
    <section class="now" :class="{ 'now--bad': blocked.length }" aria-label="Oracle-blocked right now" :aria-busy="loading">
      <span class="now__dot" aria-hidden="true"></span>
      <span class="now__label">Oracle-blocked right now</span>
      <span v-if="loading" class="ax-skeleton ax-skeleton--line now__skeleton" aria-hidden="true"></span>
      <span v-else-if="error" class="now__text">Unavailable</span>
      <span v-else class="now__text"><strong v-if="blocked.length" class="ax-num">{{ usd(supplyOf(blocked)) }}</strong>{{ nowText }}</span>
      <RouterLink v-if="!loading && !error" :to="{ name: 'incidents' }" class="now__link no-print">Incidents</RouterLink>
    </section>

    <section class="ax-card picker-card no-print" aria-label="Choose an oracle">
      <ProviderPicker :summaries="summaries" :selected="provider" :loading="loading" />
    </section>

    <section v-if="error" class="ax-card">
      <EmptyState tone="error" title="Can't reach the API right now">
        The figures on this page come from the live API, which did not answer. Try again in a moment.
        <template #actions>
          <button type="button" class="ax-btn ax-btn--secondary ax-btn--sm" @click="load">Retry</button>
        </template>
      </EmptyState>
    </section>

    <template v-else>
      <!-- The answer, in one sentence. -->
      <section class="ax-card hero" :class="{ 'hero--bad': exposure.stops.length && !structureView }" aria-labelledby="blast-headline" :aria-busy="loading">
        <p class="hero__eyebrow">{{ eyebrow }}</p>
        <template v-if="loading">
          <span class="ax-skeleton ax-skeleton--line" style="width: 70%; height: 1.75rem" aria-hidden="true"></span>
          <span class="ax-skeleton ax-skeleton--line" style="width: 50%" aria-hidden="true"></span>
        </template>
        <template v-else>
          <h2 id="blast-headline" class="hero__title">{{ headline }}</h2>
          <p v-if="consequence" class="hero__text">{{ consequence }}</p>
          <p v-if="feed" class="hero__feed">
            <code class="ax-num">{{ feed }}</code>
            <a :href="solscanAccount(feed)" target="_blank" rel="noopener">View on Solscan</a>
            <RouterLink v-if="exposure.provider" :to="{ query: { provider: exposure.provider } }" class="no-print">All of {{ exposure.provider }}</RouterLink>
          </p>
          <p class="hero__asof">Listed markets · checked {{ checkedLabel ?? '—' }}</p>
        </template>
      </section>

      <div v-if="!structureView && (loading || reached)" class="ax-dash-grid kpis">
        <KpiCard
          label="Would have no usable price"
          :loading="loading"
          :value="usd(exposure.stopsUsd)"
          :tone="exposure.stops.length ? 'danger' : undefined"
          :hint="exposure.stops.length ? `In ${n(exposure.stops.length, 'reserve')}, ${Math.round((exposure.stopsUsd / (totalSupply || 1)) * 100)}% of listed supply` : 'No reserve relies on it alone'"
        />
        <KpiCard
          label="Keeps a price"
          :loading="loading"
          :value="usd(exposure.keepsUsd)"
          :hint="exposure.keeps.length ? `In ${n(exposure.keeps.length, 'reserve')}, through a fallback` : 'No reserve has a fallback for it'"
        />
        <KpiCard
          label="Largest reserve hit"
          :loading="loading"
          :value="largest ? largest.asset || shortAddress(largest.mint) : '—'"
          :hint="largest ? `${usd(largest.totalSupplyUsd)} · ${protocolName(largest.protocol)} · ${marketName(largest)}` : 'None'"
        />
        <KpiCard
          label="Already blocked"
          :loading="loading"
          :value="String(blockedAmongStops.length)"
          :tone="blockedAmongStops.length ? 'danger' : undefined"
          :hint="blockedAmongStops.length ? `${usd(supplyOf(blockedAmongStops))} of it has no usable price now` : 'None of these prices is blocked now'"
        />
      </div>

      <div v-if="!loading && reached" class="ax-dash-grid">
        <section v-if="!structureView" class="ax-card breakdown-card" :class="feed ? 'ax-col--12' : 'ax-col--5'" aria-labelledby="where-title">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 id="where-title" class="ax-card__title">Where it lands</h2>
              <p class="ax-card__subtitle">By protocol and market, at the protocols' own prices</p>
            </div>
          </div>
          <div class="ax-card__body">
            <MarketBreakdown :stops="exposure.stops" :keeps="exposure.keeps" />
          </div>
        </section>

        <section v-if="!feed && !structureView" class="ax-card ax-col--7 feeds-card" aria-labelledby="feeds-title">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 id="feeds-title" class="ax-card__title">Feed accounts</h2>
              <p class="ax-card__subtitle">Open one to see only the reserves that read it</p>
            </div>
          </div>
          <FeedList v-if="directFeeds.length" :feeds="directFeeds" :caption="`Feed accounts of ${provider}`" />
          <p v-if="scopeAccounts.length" class="scope-note" :class="{ 'scope-note--first': !directFeeds.length }">
            Kamino reads {{ provider }} through Scope price accounts, which copy it into an entry of their own; the {{ provider }} accounts behind each
            entry are not listed here. Scope accounts that carry it:
            <template v-for="(s, i) in scopeAccounts" :key="s.account">
              <RouterLink :to="{ query: { feed: s.account } }" class="ax-num">{{ shortAddress(s.account) }}</RouterLink>
              ({{ n(s.count, 'reserve') }}){{ i < scopeAccounts.length - 1 ? ', ' : '.' }}
            </template>
          </p>
          <EmptyState v-if="!directFeeds.length && !scopeAccounts.length" tone="none" compact title="No feed account listed" />
        </section>

        <section class="ax-card ax-col--12" aria-labelledby="reserves-title">
          <div class="ax-card__header">
            <div class="ax-card__titles">
              <h2 id="reserves-title" class="ax-card__title">Reserves reached</h2>
              <p class="ax-card__subtitle">
                {{ structureView ? 'Every listed reserve that uses it, largest first' : 'Prices that would stop first, then those that keep one; largest first in each' }}
              </p>
            </div>
          </div>
          <BlastTable :rows="rows" :caption="`Reserves reached if ${name} stopped`" :show-entries="showEntries" />
        </section>
      </div>

      <section v-if="provider === SWITCHBOARD && !loading && unlistedSwitchboard.stops.length + unlistedSwitchboard.keeps.length" class="ax-card" aria-labelledby="unlisted-title">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 id="unlisted-title" class="ax-card__title">Who still depended on it: unlisted markets</h2>
            <p class="ax-card__subtitle">
              {{ usd(unlistedSwitchboard.stopsUsd) }} across {{ n(unlistedSwitchboard.stops.length, 'reserve') }} {{ unlistedSwitchboard.stops.length === 1 ? 'has' : 'have' }} no other source<template
                v-if="unlistedSwitchboard.keeps.length"
                >, and {{ usd(unlistedSwitchboard.keepsUsd) }} in {{ n(unlistedSwitchboard.keeps.length, 'more') }} has one</template
              >. These markets are permissionless, not the protocols' own, and their supply is valued at market prices.
              <RouterLink :to="{ name: 'switchboard' }" class="no-print">Switchboard exposure</RouterLink>
            </p>
          </div>
        </div>
        <BlastTable :rows="unlistedRows" caption="Unlisted reserves that still read Switchboard" />
      </section>

      <section class="ax-card method" aria-labelledby="method-title">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 id="method-title" class="ax-card__title">How this is worked out</h2>
          </div>
        </div>
        <div class="ax-card__body method__body">
          <p>
            <strong>No usable price</strong> means the protocol would refuse the reserve's price once it is older than its limit: on Kamino, marginfi and
            Jupiter Lend, borrowing, withdrawals and liquidations that need it would fail until the price came back. Deposits stay where they are; this page
            does not predict liquidations.
          </p>
          <ul>
            <li>
              <strong>Kamino</strong> reads every price from a Scope price account. The reserve's chain multiplies its entries, so each is required; inside an
              entry, multiplied sources are all required and fallback sources only fail together. A fallback that is itself too old to be used counts as none.
            </li>
            <li><strong>marginfi</strong> prices each bank from exactly one oracle account, so that account is always required.</li>
            <li><strong>Jupiter Lend</strong> multiplies or divides every source of a vault's oracle in turn, so every market source is required.</li>
            <li>
              Staking rates, pool pegs, exchange rates, maturity discounts and fixed prices describe the token rather than its market: they are listed under
              <em>Rates and pegs</em> but never counted as a point of failure.
            </li>
            <li>
              Each oracle product counts as its own provider, as everywhere on this site (Chainlink and ChainlinkX are two). A fallback between two products of
              the same company would not survive that whole company going down.
            </li>
            <li>
              Listed markets only, with supply at the protocols' own prices, from the same checks as the rest of the site, refreshed every 5 minutes.
              <em>Oracle-blocked right now</em> counts reserves holding $1K or more whose price the protocol can't use, with market-hours pauses shown apart,
              exactly as the Overview's <em>Money blocked now</em>.
            </li>
          </ul>
          <p class="method__data">
            Data: <a href="/api/reserves?listed=true" target="_blank" rel="noopener">/api/reserves?listed=true</a> · rules:
            <RouterLink :to="{ name: 'how-it-works' }">How it works</RouterLink>
          </p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-6);
}
.page > .ax-page-head {
  margin-block-end: 0;
}
.ax-page-head__subtitle,
.ax-card__subtitle {
  max-width: 78ch;
}

/* Oracle-blocked right now */
.now {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ax-space-2) var(--ax-space-3);
  padding: var(--ax-space-3) var(--ax-space-5);
  border: 1px solid var(--ax-border);
  border-radius: var(--ax-radius-md);
  background: var(--ax-surface-solid);
  font-size: var(--ax-text-sm);
}
.now--bad {
  border-color: color-mix(in srgb, var(--ax-sev-crit) 35%, var(--ax-border));
  background: var(--ax-sev-crit-wash);
}
.now__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ax-sev-ok);
}
.now--bad .now__dot {
  background: var(--ax-sev-crit);
}
.now__label {
  font-size: var(--ax-text-xs);
  font-weight: var(--ax-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ax-text-subtle);
}
.now__text {
  color: var(--ax-text);
}
.now--bad .now__text strong {
  color: var(--ax-sev-crit-text);
}
.now__link {
  margin-inline-start: auto;
  font-size: var(--ax-text-xs);
  color: var(--ax-accent-text);
}
.now__skeleton {
  width: 18rem;
}

.picker-card {
  padding: var(--ax-space-5) var(--ax-space-6);
}

/* The answer */
.hero {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-3);
  padding: var(--ax-space-6) var(--ax-space-8, 2rem);
  border-inline-start: 4px solid var(--ax-border-strong);
}
.hero--bad {
  border-inline-start-color: var(--ax-sev-crit);
}
.hero__eyebrow {
  margin: 0;
  font-size: var(--ax-text-xs);
  font-weight: var(--ax-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ax-text-subtle);
}
.hero__title {
  margin: 0;
  max-width: 40ch;
  font-size: var(--ax-text-2xl);
  line-height: 1.25;
  font-weight: var(--ax-weight-semibold);
  color: var(--ax-text-strong);
  text-wrap: balance;
}
.hero__text {
  margin: 0;
  max-width: 78ch;
  color: var(--ax-text-muted);
}
.hero__feed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-2) var(--ax-space-4);
  margin: 0;
  font-size: var(--ax-text-sm);
}
.hero__feed code {
  font-family: var(--ax-font-mono);
  overflow-wrap: anywhere;
  color: var(--ax-text-strong);
}
.hero__feed a {
  color: var(--ax-accent-text);
}
.hero__asof {
  margin: 0;
  font-size: var(--ax-text-xs);
  color: var(--ax-text-subtle);
}

.kpis {
  margin: 0;
}
.scope-note {
  margin: 0;
  padding: var(--ax-space-4) var(--ax-space-6);
  font-size: var(--ax-text-xs);
  line-height: 1.6;
  color: var(--ax-text-muted);
  border-top: 1px solid var(--ax-border);
}
.scope-note--first {
  border-top: 0;
  padding-top: 0;
}
.scope-note a {
  color: var(--ax-accent-text);
}

.method__body {
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
  max-width: 90ch;
}
.method__body p {
  margin: 0 0 var(--ax-space-3);
}
.method__body ul {
  margin: 0 0 var(--ax-space-3);
  padding-inline-start: 1.2em;
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-2);
}
.method__body strong {
  color: var(--ax-text-strong);
}
.method__body a,
.ax-card__subtitle a {
  color: var(--ax-accent-text);
}
.method__data {
  font-size: var(--ax-text-xs);
}

@media (max-width: 992px) {
  .breakdown-card,
  .feeds-card {
    grid-column: 1 / -1;
  }
}
@media (max-width: 576px) {
  .hero {
    padding: var(--ax-space-5);
  }
  .hero__title {
    font-size: var(--ax-text-xl);
  }
  .picker-card {
    padding: var(--ax-space-4);
  }
  .now {
    padding: var(--ax-space-3) var(--ax-space-4);
  }
  .now__link {
    margin-inline-start: 0;
  }
}

/* A clean page for an oracle review: no app chrome or controls, every row shown. */
@media print {
  :global(.ax-sidebar),
  :global(.ax-header),
  :global(.ax-footer),
  :global(.ax-ambient),
  :global(.oc-skip),
  :global(.ax-backdrop),
  .no-print {
    display: none !important;
  }
  :global(.ax-shell) {
    margin: 0 !important;
  }
  :global(.ax-main) {
    padding-block-start: 0 !important;
  }
  .page {
    gap: var(--ax-space-4);
  }
  .hero,
  .now,
  .kpis,
  .breakdown-card {
    break-inside: avoid;
    box-shadow: none;
  }
  .breakdown-card {
    grid-column: 1 / -1;
  }
  .now--bad,
  .hero--bad {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}
</style>
