<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { fetchLendingRates, type LendingRate } from '@/api/client'
import EmptyState from '@/components/EmptyState.vue'
import KpiCard from '@/components/KpiCard.vue'
import SeverityBadge from '@/components/SeverityBadge.vue'
import LentAgainstFacts from '@/components/rates/LentAgainstFacts.vue'
import { COMPOSITION, ago, pct, poolName, sourceLabel } from '@/components/rates/rates'
import { PROTOCOL_NAME, dateTime, solscanAccount, usd } from '@/lib/format'
import type { HealthState } from '@/lib/priceState'

const route = useRoute()
const router = useRouter()
const pools = ref<LendingRate[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const now = ref(Date.now())

async function load() {
  loading.value = true
  error.value = null
  try {
    pools.value = await fetchLendingRates()
    now.value = Date.now()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** Pools this small are mostly empty or test reserves; they are listed only on request. */
const MIN_POOL_USD = 100_000

/** Filters live in the URL, so they survive going back from a reserve and can be shared. */
const one = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
function setQuery(patch: Record<string, string>) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query)) if (typeof value === 'string') query[key] = value
  for (const [key, value] of Object.entries(patch)) {
    if (value) query[key] = value
    else delete query[key]
  }
  router.replace({ query })
}
const selectValue = (event: Event) => (event.target as HTMLSelectElement).value

const filters = computed(() => ({
  asset: one('asset'),
  protocol: Object.hasOwn(PROTOCOL_NAME, one('protocol')) ? one('protocol') : '',
  hideCritical: one('critical') === 'hide',
  showSmall: one('small') === '1',
}))
const filtered = computed(() => !!(filters.value.asset || filters.value.protocol || filters.value.hideCritical))
const clearFilters = () => setQuery({ asset: '', protocol: '', critical: '' })

/** Assets by mint, named after their largest pool, largest deposits first. */
const assets = computed(() => {
  const byMint = new Map<string, { mint: string; symbol: string; usd: number }>()
  for (const p of pools.value) {
    const a = byMint.get(p.mint) ?? { mint: p.mint, symbol: p.asset || p.mint.slice(0, 6), usd: 0 }
    a.usd += p.totalSupplyUsd
    byMint.set(p.mint, a)
  }
  return [...byMint.values()].filter((a) => a.usd >= MIN_POOL_USD).sort((a, b) => b.usd - a.usd)
})
const assetSymbol = computed(() => new Map(assets.value.map((a) => [a.mint, a.symbol])))

const large = computed(() => pools.value.filter((p) => filters.value.showSmall || p.totalSupplyUsd >= MIN_POOL_USD))
const smallCount = computed(() => pools.value.length - pools.value.filter((p) => p.totalSupplyUsd >= MIN_POOL_USD).length)

const shown = computed(() => {
  const f = filters.value
  return large.value.filter(
    (p) => (!f.asset || p.mint === f.asset) && (!f.protocol || p.protocol === f.protocol) && (!f.hideCritical || p.lentAgainst.criticalCount === 0),
  )
})

/** Rows grouped by asset, groups and rows by deposits: never by rate. */
const groups = computed(() => {
  const byMint = new Map<string, LendingRate[]>()
  for (const p of shown.value) byMint.set(p.mint, [...(byMint.get(p.mint) ?? []), p])
  return [...byMint.entries()]
    .map(([mint, rows]) => ({
      mint,
      symbol: assetSymbol.value.get(mint) ?? rows[0].asset,
      rows: [...rows].sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd),
      usd: rows.reduce((sum, r) => sum + r.totalSupplyUsd, 0),
    }))
    .sort((a, b) => b.usd - a.usd)
})

/** Each asset shows its largest pools; the rest open on request (all of them once one asset is chosen). */
const GROUP_ROWS = 5
const expanded = ref(new Set<string>())
const visibleRows = (g: { mint: string; rows: LendingRate[] }) =>
  filters.value.asset || expanded.value.has(g.mint) ? g.rows : g.rows.slice(0, GROUP_ROWS)
function toggleGroup(mint: string) {
  const next = new Set(expanded.value)
  if (next.has(mint)) next.delete(mint)
  else next.add(mint)
  expanded.value = next
}

const totalUsd = computed(() => shown.value.reduce((sum, p) => sum + p.totalSupplyUsd, 0))
const withCritical = computed(() => shown.value.filter((p) => p.lentAgainst.criticalCount > 0))

/** Where a row leads: the reserve's page, or the Earn pool's account on Solscan. */
const reserveLink = (p: LendingRate) => (p.kind === 'reserve' ? { name: 'reserve', params: { address: p.address } } : null)

const ownTitle = (p: LendingRate) => (p.providers.length ? `Price from ${p.providers.join(', ')}${p.checks.length ? ` · checks: ${p.checks.join(', ')}` : ''}` : '')
</script>

<template>
  <!-- One root: the layout pads every top-level block, which would stack the spacing. -->
  <div class="page">
    <div class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <h1 class="ax-page-head__title">Lending rates</h1>
          <p class="ax-page-head__subtitle">
            What each Kamino, marginfi and Jupiter Lend pool reports paying depositors, next to the oracle facts of the pool and of the collateral
            its deposits are lent against. If that collateral's price stops or is wrong, bad loans cannot be liquidated and losses fall on lenders.
          </p>
        </div>
      </div>
    </div>

    <section v-if="error" class="ax-card">
      <EmptyState tone="error" title="Can't reach the API right now">
        The rates come from the live API, which did not answer. Try again in a moment.
        <template #actions>
          <button type="button" class="ax-btn ax-btn--secondary ax-btn--sm" @click="load">Retry</button>
        </template>
      </EmptyState>
    </section>
    <div v-else class="ax-dash-grid" :aria-busy="loading">
      <KpiCard label="Supply pools" :loading="loading" :value="String(shown.length)" :hint="filters.showSmall ? 'Every pool with a reported rate' : 'Pools holding $100K or more'" />
      <KpiCard label="Deposits" :loading="loading" :value="usd(totalUsd)" />
      <KpiCard label="Assets" :loading="loading" :value="String(groups.length)" hint="Grouped by token, across protocols" />
      <KpiCard
        label="Critical collateral"
        :loading="loading"
        :value="String(withCritical.length)"
        :tone="withCritical.length ? 'danger' : undefined"
        :hint="withCritical.length ? `Pools lent against it, holding ${usd(withCritical.reduce((s, p) => s + p.totalSupplyUsd, 0))}` : 'No pool is lent against collateral with a critical issue now'"
      />

      <section class="ax-card ax-col--12" aria-label="Supply pools">
        <div class="ax-card__header toolbar">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">Supply pools by asset</h2>
            <p class="ax-card__subtitle">Largest deposits first. Rates as each protocol reports them, without token incentives.</p>
          </div>
          <div class="ax-card__actions toolbar__controls">
            <select class="ax-select ax-select--sm" aria-label="Filter by asset" :value="filters.asset" @change="setQuery({ asset: selectValue($event) })">
              <option value="">All assets</option>
              <option v-for="a in assets" :key="a.mint" :value="a.mint">{{ a.symbol }}</option>
            </select>
            <select class="ax-select ax-select--sm" aria-label="Filter by protocol" :value="filters.protocol" @change="setQuery({ protocol: selectValue($event) })">
              <option value="">All protocols</option>
              <option v-for="(name, id) in PROTOCOL_NAME" :key="id" :value="id">{{ name }}</option>
            </select>
            <label class="toggle">
              <input type="checkbox" class="ax-checkbox" :checked="filters.hideCritical" @change="setQuery({ critical: ($event.target as HTMLInputElement).checked ? 'hide' : '' })" />
              Hide pools with a critical issue in their collateral
            </label>
            <label v-if="smallCount" class="toggle">
              <input type="checkbox" class="ax-checkbox" :checked="filters.showSmall" @change="setQuery({ small: ($event.target as HTMLInputElement).checked ? '1' : '' })" />
              Show {{ smallCount }} pools under $100K
            </label>
            <button v-if="filtered" type="button" class="ax-btn ax-btn--ghost ax-btn--sm" @click="clearFilters">Clear filters</button>
          </div>
          <div class="legend" aria-label="Collateral bar legend">
            <span class="legend__title">Lent against:</span>
            <span v-for="c in COMPOSITION" :key="c.key" class="legend__item"><i class="legend__dot" :class="`legend__dot--${c.tone}`" aria-hidden="true"></i>{{ c.label }}</span>
            <span class="legend__item"><i class="legend__dot legend__dot--rest" aria-hidden="true"></i>Unreadable or no oracle</span>
          </div>
        </div>

        <div class="ax-table-wrap">
          <table class="ax-table ax-table--compact rates">
            <caption class="ax-visually-hidden">Supply pools grouped by asset, with their reported rates and the oracle facts of their collateral</caption>
            <thead class="ax-table__head">
              <tr>
                <th scope="col" class="ax-table__th col-pool">Pool</th>
                <th scope="col" class="ax-table__th ax-table__th--num col-apy">Supply APY</th>
                <th scope="col" class="ax-table__th ax-table__th--num col-supply">Deposits</th>
                <th scope="col" class="ax-table__th col-own">Pool's own price</th>
                <th scope="col" class="ax-table__th col-lent">Lent against</th>
              </tr>
            </thead>
            <tbody v-if="loading">
              <tr v-for="i in 6" :key="i" class="ax-table__row">
                <td v-for="j in 5" :key="j" class="ax-table__td"><span class="ax-skeleton ax-skeleton--line"></span></td>
              </tr>
            </tbody>
            <tbody v-for="g in groups" v-else :key="g.mint" class="group">
              <tr class="group__head">
                <th scope="rowgroup" colspan="5" class="group__cell">
                  <span class="group__symbol">{{ g.symbol }}</span>
                  <span class="group__meta"><span class="ax-num">{{ g.rows.length }}</span> {{ g.rows.length === 1 ? 'pool' : 'pools' }} · <span class="ax-num">{{ usd(g.usd) }}</span></span>
                </th>
              </tr>
              <tr v-for="p in visibleRows(g)" :key="p.address" class="ax-table__row">
                <td class="ax-table__td col-pool">
                  <RouterLink v-if="reserveLink(p)" :to="reserveLink(p)!" class="name">{{ poolName(p).market }}</RouterLink>
                  <a v-else :href="solscanAccount(p.address)" target="_blank" rel="noopener" class="name">{{ poolName(p).market }}</a>
                  <div class="muted">
                    <template v-if="poolName(p).protocol">{{ poolName(p).protocol }} · </template>{{ p.asset }}
                  </div>
                </td>
                <td class="ax-table__td ax-table__td--num col-apy">
                  <div class="apy ax-num">{{ pct(p.supplyApy) }}</div>
                  <div v-if="p.borrowApy !== null" class="sub">borrow {{ pct(p.borrowApy) }}</div>
                  <div v-if="p.rewardsApy" class="sub" title="Token incentives the source reports on top of the rate">+{{ pct(p.rewardsApy) }} incentives</div>
                  <div class="sub" :title="p.rateAt ? `${sourceLabel(p.rateSource)}, ${dateTime(p.rateAt)}` : undefined">
                    {{ sourceLabel(p.rateSource) }} · {{ ago(p.rateAt, now) }}
                  </div>
                </td>
                <td class="ax-table__td ax-table__td--num col-supply" data-label="Deposits">
                  <span class="ax-num">{{ usd(p.totalSupplyUsd) }}</span>
                </td>
                <td class="ax-table__td col-own">
                  <template v-if="p.healthState">
                    <span :title="ownTitle(p)"><SeverityBadge :severity="p.healthState as HealthState" /></span>
                    <div class="sub">{{ p.providers.length ? p.providers.join(', ') : 'No provider read' }}</div>
                  </template>
                  <span v-else class="sub" title="An Earn pool has no price of its own: the vaults that borrow from it price the loans">No oracle of its own</span>
                </td>
                <td class="ax-table__td col-lent" data-label="Lent against">
                  <LentAgainstFacts :facts="p.lentAgainst" />
                </td>
              </tr>
              <tr v-if="!filters.asset && g.rows.length > GROUP_ROWS" class="group__more">
                <td colspan="5" class="group__more-cell">
                  <button type="button" class="ax-btn ax-btn--ghost ax-btn--sm" :aria-expanded="expanded.has(g.mint)" @click="toggleGroup(g.mint)">
                    {{ expanded.has(g.mint) ? `Show the ${GROUP_ROWS} largest ${g.symbol} pools` : `Show all ${g.rows.length} ${g.symbol} pools` }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!loading && !pools.length" class="empty">No rates yet: they appear after the next indexer run.</p>
        <p v-else-if="!loading && !shown.length" class="empty">No pool matches these filters.</p>
      </section>

      <section class="ax-card ax-col--12 notes" aria-label="How to read this page">
        <h2 class="ax-card__title">How "lent against" is worked out</h2>
        <p>
          The protocols do not say which deposit backs which loan, so this is an approximation. For a Kamino reserve or a marginfi bank, the
          collateral is every other reserve in the same market, weighted by its deposits; reserves the protocol does not accept as collateral are
          left out. For a Jupiter Lend Earn pool, it is the collateral in every Jupiter Lend vault that borrows the pool's token. Deposits count
          whether or not they back a loan right now.
        </p>
        <p>
          "Fallback" means the price has no single feed it depends on. "Single feed" means one feed stopping stops the price. "Critical" counts
          collateral reserves holding $10K or more with a critical check now; a stock paused only by its closed market is not counted.
        </p>
        <p class="disclaimer">
          Rates come from each protocol's public API or on-chain state; oracle facts from OracleCanary's checks. Not investment advice or a
          recommendation; no protocol pays or is paid by OracleCanary. Rates change.
        </p>
      </section>
    </div>
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
  max-width: 80ch;
}
.toolbar {
  flex-wrap: wrap;
  gap: var(--ax-space-3);
}
.toolbar__controls {
  flex: 1 1 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-2);
}
.toolbar__controls .ax-select {
  width: auto;
  min-width: 0;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.legend {
  flex: 1 1 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--ax-space-3);
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.legend__title {
  color: var(--ax-text-subtle);
}
.legend__item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend__dot {
  width: 10px;
  height: 6px;
  border-radius: var(--ax-radius-pill);
}
.legend__dot--fallback {
  background: var(--ax-accent-500);
}
.legend__dot--single {
  background: var(--ax-warning-500);
}
.legend__dot--fixed {
  background: var(--ax-neutral-400);
}
.legend__dot--rest {
  background: var(--ax-border-strong);
}

.rates {
  min-width: 900px;
}
.col-pool {
  min-width: 180px;
}
.col-lent {
  min-width: 260px;
}
.group__head {
  background: var(--ax-surface-subtle);
}
.group__cell {
  padding: var(--ax-space-2) var(--ax-space-4);
  text-align: start;
  font-weight: 400;
  border-bottom: 1px solid var(--ax-border);
}
.group:not(:first-of-type) .group__cell {
  border-top: 1px solid var(--ax-border);
}
.group__symbol {
  color: var(--ax-text-strong);
  font-weight: 650;
  margin-inline-end: var(--ax-space-2);
}
.group__meta {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
.ax-table__td {
  vertical-align: top;
}
.name {
  color: var(--ax-text-strong);
  font-weight: 600;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.apy {
  color: var(--ax-text-strong);
  font-weight: 600;
}
.sub {
  color: var(--ax-text-subtle);
  font-size: var(--ax-text-xs);
  white-space: nowrap;
}
.group__more-cell {
  padding: var(--ax-space-1) var(--ax-space-3);
  border-bottom: 1px solid var(--ax-border);
}
.empty {
  padding: var(--ax-space-8);
  text-align: center;
  color: var(--ax-text-muted);
}
.notes {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-3);
  padding: var(--ax-space-5);
}
.notes p {
  margin: 0;
  max-width: 90ch;
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.notes .disclaimer {
  color: var(--ax-text-subtle);
  font-size: var(--ax-text-xs);
}

/* Phones: each pool becomes a card. Line 1 pool and rate, line 2 own price and deposits, then the collateral. */
@media (max-width: 640px) {
  .rates {
    min-width: 0;
  }
  .rates thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .rates tbody {
    display: block;
  }
  .rates .group__head {
    display: block;
  }
  .rates .group__cell,
  .rates .group__more,
  .rates .group__more-cell {
    display: block;
  }
  .rates .ax-table__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'pool apy'
      'own supply'
      'lent lent';
    gap: var(--ax-space-2) var(--ax-space-3);
    padding: var(--ax-space-3) var(--ax-space-4);
    border-bottom: 1px solid var(--ax-border);
  }
  .rates td {
    display: block;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .rates .col-pool {
    grid-area: pool;
  }
  .rates .col-apy {
    grid-area: apy;
    justify-self: end;
  }
  .rates .col-own {
    grid-area: own;
  }
  .rates .col-supply {
    grid-area: supply;
    justify-self: end;
    align-self: start;
  }
  .rates .col-lent {
    grid-area: lent;
  }
  .rates .col-supply::before,
  .rates .col-lent::before {
    content: attr(data-label) ' ';
    font-family: var(--ax-font-sans);
    font-size: var(--ax-text-xs);
    color: var(--ax-text-subtle);
  }
  .rates .col-lent::before {
    display: block;
    margin-block-end: 2px;
  }
}
</style>
