<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchAllReserves, type Reserve } from '@/api/client'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTable from '@/components/ReserveTable.vue'
import { usd } from '@/lib/format'

/**
 * Switchboard ended support for its Solana oracle on 25 Sep 2026. Reserves whose price depends on it
 * fail the DEPRECATED_PROVIDER check: critical when nothing else can replace it.
 */
const reserves = ref<Reserve[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    reserves.value = (await fetchAllReserves({ check: 'DEPRECATED_PROVIDER' })).sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

const PROTOCOL_NAMES: Record<string, string> = { kamino: 'Kamino', 'jupiter-lend': 'Jupiter Lend', marginfi: 'marginfi' }

const listed = computed(() => reserves.value.filter((r) => r.market.name))
const unlisted = computed(() => reserves.value.filter((r) => !r.market.name))
const broken = computed(() => reserves.value.filter((r) => r.checks.some((c) => c.code === 'DEPRECATED_PROVIDER' && c.severity === 'critical')))
const sum = (rows: Reserve[]) => rows.reduce((total, r) => total + r.totalSupplyUsd, 0)
const byProtocol = computed(() =>
  Object.entries(
    reserves.value.reduce<Record<string, number>>((counts, r) => ({ ...counts, [r.protocol]: (counts[r.protocol] ?? 0) + 1 }), {}),
  )
    .map(([protocol, count]) => `${count} on ${PROTOCOL_NAMES[protocol] ?? protocol}`)
    .join(', '),
)
</script>

<template>
  <div class="ax-page-head">
    <div class="ax-page-head__row">
      <div>
        <h1 class="ax-page-head__title">Switchboard exposure</h1>
        <p class="ax-page-head__subtitle">
          Switchboard ended support for its Solana oracle on 25 Sep 2026. The press asked who still relies on its prices; this is the
          live answer, from every reserve of Kamino, marginfi and Jupiter Lend.
        </p>
      </div>
    </div>
  </div>

  <div v-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>

  <div v-else class="ax-dash-grid" :aria-busy="loading">
    <KpiCard
      label="Listed markets"
      :value="loading ? '…' : String(listed.length)"
      icon="layout-dashboard"
      :tone="listed.length ? 'c3' : 'c4'"
      :hint="loading ? undefined : listed.length ? `${usd(sum(listed))} supplied still depends on Switchboard` : 'Every listed market has migrated'"
    />
    <KpiCard
      label="Unlisted markets"
      :value="loading ? '…' : String(unlisted.length)"
      icon="table"
      tone="c3"
      :hint="loading ? undefined : `${usd(sum(unlisted))} supplied, at market prices`"
    />
    <KpiCard
      label="Price cannot be produced"
      :value="loading ? '…' : String(broken.length)"
      icon="alert-triangle"
      tone="c3"
      hint="Nothing else can replace Switchboard: critical"
    />
    <KpiCard label="By protocol" :value="loading ? '…' : String(reserves.length)" icon="book" tone="c2" :hint="loading ? undefined : byProtocol || 'None'" />

    <section class="ax-card ax-col--12" aria-label="Reserves that still depend on Switchboard">
      <div class="ax-card__header">
        <div class="ax-card__titles">
          <h2 class="ax-card__title">Still depending on Switchboard</h2>
          <p class="ax-card__subtitle">
            Largest first. Unlisted markets are permissionless: anyone can create one, so these are not the protocols' own markets.
          </p>
        </div>
      </div>
      <ReserveTable v-if="loading || reserves.length" :rows="reserves" />
      <p v-else class="empty">No reserve depends on Switchboard any more.</p>
    </section>

    <p class="sources ax-col--12">
      Sources:
      <a href="https://crypto.news/a-solana-oracles-support-ends-today-who-still-relies-on-its-prices/" target="_blank" rel="noopener">crypto.news</a>,
      <a href="https://cryptoticker.io/en/switchboard-oracle-shutdown-check-solana-defi/" target="_blank" rel="noopener">CryptoTicker</a>.
      Data: <a href="/api/reserves?check=DEPRECATED_PROVIDER" target="_blank" rel="noopener">/api/reserves?check=DEPRECATED_PROVIDER</a>
    </p>
  </div>
</template>

<style scoped>
.empty {
  padding: var(--ax-space-8);
  text-align: center;
  color: var(--ax-text-muted);
}
.sources {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
.sources a {
  color: var(--ax-accent);
}
</style>
