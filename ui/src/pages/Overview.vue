<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchReserves, type Reserve } from '@/api/client'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTable from '@/components/ReserveTable.vue'
import { usd } from '@/lib/format'

// Listed markets fit in one page of the API; unlisted ones hold junk tokens with arbitrary prices.
const MAX_RESERVES = 500
const ATTENTION_ROWS = 10

const reserves = ref<Reserve[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    reserves.value = await fetchReserves({ listed: true, itemsPerPage: MAX_RESERVES })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

const totalSupply = computed(() => reserves.value.reduce((sum, r) => sum + r.totalSupplyUsd, 0))
const critical = computed(() => reserves.value.filter((r) => r.severity === 'critical'))
const warnings = computed(() => reserves.value.filter((r) => r.severity === 'warning'))
const supplyAtRisk = computed(() => critical.value.reduce((sum, r) => sum + r.totalSupplyUsd, 0))

const needsAttention = computed(() =>
  reserves.value
    .filter((r) => r.severity === 'critical' || r.severity === 'warning')
    .sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)
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
  return Number.isFinite(latest) ? new Date(latest).toLocaleTimeString() : null
})
</script>

<template>
  <div class="ax-page-head">
    <div class="ax-page-head__row">
      <div>
        <h1 class="ax-page-head__title">Oracle health</h1>
        <p class="ax-page-head__subtitle">
          Which oracle every Solana lending market depends on, and whether it is healthy.
          <template v-if="lastChecked"> Last checked at {{ lastChecked }}.</template>
        </p>
      </div>
    </div>
  </div>

  <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>

  <div v-else class="ax-dash-grid" :aria-busy="loading">
    <KpiCard label="Reserves monitored" :value="loading ? '…' : String(reserves.length)" icon="table" tone="c1" hint="Kamino, markets listed in its app" />
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
      <ReserveTable :rows="needsAttention" />
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
