<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchReserve, type Reserve } from '@/api/client'
import KpiCard from '@/components/KpiCard.vue'
import SeverityBadge from '@/components/SeverityBadge.vue'
import { duration, shortAddress, solscanAccount, usd } from '@/lib/format'

const props = defineProps<{ address: string }>()

const reserve = ref<Reserve | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

watch(
  () => props.address,
  async (address) => {
    loading.value = true
    error.value = null
    try {
      reserve.value = await fetchReserve(address)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
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
  ].filter((row): row is { label: string; value: string; extra?: string | null } => row.value !== null)
</script>

<template>
  <p v-if="loading" class="state">Loading…</p>
  <div v-else-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>
  <div v-else-if="!reserve" class="state">
    <p>No reserve with address <code>{{ address }}</code>.</p>
    <RouterLink :to="{ name: 'reserves' }" class="ax-btn ax-btn--secondary ax-btn--sm">Back to reserves</RouterLink>
  </div>

  <template v-else>
    <div class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <h1 class="ax-page-head__title title">
            {{ reserve.asset || shortAddress(reserve.mint) }}
            <SeverityBadge :severity="reserve.severity" />
          </h1>
          <p class="ax-page-head__subtitle">
            {{ reserve.protocol }} · {{ reserve.market.name ?? 'Unlisted market' }} · checked {{ new Date(reserve.checkedAt).toLocaleString() }}
          </p>
        </div>
      </div>
    </div>

    <div class="ax-dash-grid">
      <KpiCard label="Health score" :value="`${reserve.score} / 100`" icon="layout-dashboard" tone="c1" />
      <KpiCard label="Supply" :value="usd(reserve.totalSupplyUsd)" icon="table" tone="c2" />
      <KpiCard
        label="Price age"
        :value="duration(reserve.price.ageSeconds)"
        icon="history"
        :tone="reserve.price.isStale ? 'c3' : 'c4'"
        :hint="`The protocol rejects prices older than ${duration(reserve.price.maxAgeSeconds)}`"
      />
      <KpiCard label="Oracle providers" :value="String(reserve.providers.length)" icon="book" tone="c4" :hint="reserve.providers.join(', ') || 'None found'" />

      <section class="ax-card ax-col--6" aria-label="Health checks">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">Health checks</h2>
            <p class="ax-card__subtitle">{{ reserve.checks.length ? `${reserve.checks.length} issue(s) found` : 'All checks passed' }}</p>
          </div>
        </div>
        <div class="ax-card__body">
          <ul v-if="reserve.checks.length" class="checks">
            <li v-for="c in reserve.checks" :key="c.code" class="checks__item">
              <SeverityBadge :severity="c.severity" />
              <div>
                <b class="ax-mono checks__code">{{ c.code }}</b>
                <p class="checks__message">{{ c.message }}</p>
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
                <span v-if="row.extra" class="muted"> {{ row.extra }}</span>
              </dd>
            </template>
          </dl>
        </div>
      </section>
    </div>
  </template>
</template>

<style scoped>
.title {
  display: flex;
  align-items: center;
  gap: var(--ax-space-3);
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
.checks__item {
  display: grid;
  grid-template-columns: auto 1fr;
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
.accounts dt {
  color: var(--ax-text-muted);
}
</style>
