<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchAllReserves, type Reserve } from '@/api/client'
import EmptyState from '@/components/EmptyState.vue'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTable from '@/components/ReserveTable.vue'
import { protocolName, usd } from '@/lib/format'

/**
 * Switchboard ended support for its Solana oracle on 25 Sep 2026. Reserves whose price depends on it
 * fail the DEPRECATED_PROVIDER check: critical when nothing else can replace it.
 */
const reserves = ref<Reserve[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    reserves.value = (await fetchAllReserves({ check: 'DEPRECATED_PROVIDER' })).sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** Pages of 25, like the Reserves list, so a long tail of near-identical rows does not fill the page. */
const PAGE_SIZE = 25
const page = ref(1)
const pageCount = computed(() => Math.max(1, Math.ceil(reserves.value.length / PAGE_SIZE)))
const pageRows = computed(() => reserves.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

const listed = computed(() => reserves.value.filter((r) => r.market.name))
const unlisted = computed(() => reserves.value.filter((r) => !r.market.name))
const broken = computed(() => reserves.value.filter((r) => r.checks.some((c) => c.code === 'DEPRECATED_PROVIDER' && c.severity === 'critical')))
const sum = (rows: Reserve[]) => rows.reduce((total, r) => total + r.totalSupplyUsd, 0)
const byProtocol = computed(() =>
  Object.entries(
    reserves.value.reduce<Record<string, number>>((counts, r) => ({ ...counts, [r.protocol]: (counts[r.protocol] ?? 0) + 1 }), {}),
  )
    .map(([protocol, count]) => `${count} on ${protocolName(protocol)}`)
    .join(', '),
)
</script>

<template>
  <!-- One root: the layout pads every top-level block, which would stack the spacing. -->
  <div class="page">
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

    <div class="ax-dash-grid" :aria-busy="loading">
      <KpiCard
        label="Listed markets"
        :loading="loading"
        :value="error ? '—' : String(listed.length)"
       
        :tone="listed.length ? 'danger' : undefined"
        :hint="error ? null : listed.length ? `${usd(sum(listed))} supplied still depends on Switchboard` : 'Every listed market has migrated'"
      />
      <KpiCard
        label="Unlisted markets"
        :loading="loading"
        :value="error ? '—' : String(unlisted.length)"
       
        :hint="error ? null : `${usd(sum(unlisted))} supplied, at market prices`"
      />
      <KpiCard
        label="Price cannot be produced"
        :loading="loading"
        :value="error ? '—' : String(broken.length)"
       
        :tone="broken.length ? 'danger' : undefined"
        hint="Nothing else can replace Switchboard: critical"
      />
      <KpiCard label="By protocol" :loading="loading" :value="error ? '—' : String(reserves.length)" :hint="error ? null : byProtocol || 'None'" />

      <section class="ax-card ax-col--12" aria-label="Reserves that still depend on Switchboard">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">Still depending on Switchboard</h2>
            <p class="ax-card__subtitle">
              Largest first. Unlisted markets are permissionless: anyone can create one, so these are not the protocols' own markets.
            </p>
          </div>
        </div>
        <EmptyState v-if="error" tone="error" title="Can't reach the API right now">
          This list comes from the live API, which did not answer. Try again in a moment.
          <template #actions>
            <button type="button" class="ax-btn ax-btn--secondary ax-btn--sm" @click="load">Retry</button>
          </template>
        </EmptyState>
        <ReserveTable v-else-if="loading || reserves.length" :rows="pageRows" :loading-rows="loading ? 8 : 0" />
        <EmptyState v-else title="No reserve depends on Switchboard any more" />
        <div v-if="!error && pageCount > 1" class="ax-card__footer pager">
          <span class="ax-num muted">Page {{ page }} of {{ pageCount }} · {{ reserves.length }} reserves</span>
          <nav class="ax-pagination" aria-label="Pagination">
            <button type="button" class="ax-pagination__prev" :disabled="page <= 1" aria-label="Previous page" @click="page--">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6l6 6" /></svg>
            </button>
            <button type="button" class="ax-pagination__next" :disabled="page >= pageCount" aria-label="Next page" @click="page++">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6l-6 6" /></svg>
            </button>
          </nav>
        </div>
      </section>

      <p class="sources ax-col--12">
        Sources:
        <a href="https://crypto.news/a-solana-oracles-support-ends-today-who-still-relies-on-its-prices/" target="_blank" rel="noopener">crypto.news</a>,
        <a href="https://cryptoticker.io/en/switchboard-oracle-shutdown-check-solana-defi/" target="_blank" rel="noopener">CryptoTicker</a>.
        Data: <a href="/api/reserves?check=DEPRECATED_PROVIDER" target="_blank" rel="noopener">/api/reserves?check=DEPRECATED_PROVIDER</a>
      </p>
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
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.sources {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
.sources a {
  color: var(--ax-accent-text);
}
</style>
