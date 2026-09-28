<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchVault, type Vault } from '@/api/client'
import KpiCard from '@/components/KpiCard.vue'
import SeverityBadge from '@/components/SeverityBadge.vue'
import { dateTime, shortAddress, solscanAccount, usd } from '@/lib/format'

const props = defineProps<{ address: string }>()

const vault = ref<Vault | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

watch(
  () => props.address,
  async (address, _previous, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    loading.value = true
    error.value = null
    try {
      vault.value = await fetchVault(address, controller.signal)
    } catch (e) {
      if (!controller.signal.aborted) error.value = (e as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  },
  { immediate: true },
)

const percent = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`
</script>

<template>
  <p v-if="loading" class="state">Loading…</p>
  <div v-else-if="error" class="ax-alert ax-alert--danger" role="alert">{{ error }}</div>
  <div v-else-if="!vault" class="state">
    <p>No vault with address <code>{{ address }}</code>.</p>
    <RouterLink :to="{ name: 'vaults' }" class="ax-btn ax-btn--secondary ax-btn--sm">Back to vaults</RouterLink>
  </div>

  <template v-else>
    <div class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <div class="title">
            <h1 class="ax-page-head__title">{{ vault.name }}</h1>
            <SeverityBadge :severity="vault.worstSeverity" />
          </div>
          <p class="ax-page-head__subtitle">
            Kamino vault{{ vault.curator ? ` curated by ${vault.curator}` : '' }} · {{ vault.token ?? 'unknown token' }} · checked
            {{ dateTime(vault.checkedAt) }} ·
            <a :href="solscanAccount(vault.address)" target="_blank" rel="noopener" class="ax-mono">{{ shortAddress(vault.address) }}</a>
          </p>
        </div>
      </div>
    </div>

    <div class="ax-dash-grid">
      <KpiCard label="Deposits" :value="usd(vault.totalUsd)" icon="layout-dashboard" tone="c2" :hint="`${usd(vault.idleUsd)} not lent out`" />
      <KpiCard
        label="At risk now"
        :value="usd(vault.atRiskUsd)"
        icon="alert-triangle"
        :tone="vault.atRiskUsd > 0 ? 'c3' : 'c4'"
        :hint="vault.totalUsd ? `${percent(vault.atRiskUsd / vault.totalUsd)} of deposits` : undefined"
      />
      <KpiCard label="With warnings" :value="usd(vault.warningUsd)" icon="bell" tone="c4" hint="Mostly single-oracle prices" />
      <KpiCard label="Reserves" :value="String(vault.allocations.length)" icon="table" tone="c1" hint="Where the deposits are lent" />

      <section class="ax-card ax-col--12" aria-label="Allocations">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">Where the deposits are</h2>
            <p class="ax-card__subtitle">
              Each reserve the vault lends into, its oracle health, and problems of the collateral borrowers post in the same market.
            </p>
          </div>
        </div>
        <div class="ax-table-wrap">
          <table class="ax-table" style="min-width: 820px">
            <thead class="ax-table__head">
              <tr>
                <th scope="col" class="ax-table__th">Reserve</th>
                <th scope="col" class="ax-table__th">Health</th>
                <th scope="col" class="ax-table__th ax-table__th--num">Amount</th>
                <th scope="col" class="ax-table__th">Share</th>
                <th scope="col" class="ax-table__th">Oracle issue</th>
                <th scope="col" class="ax-table__th">Collateral in this market</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in vault.allocations" :key="a.reserve" class="ax-table__row">
                <td class="ax-table__td">
                  <!-- A reserve the indexer does not check (hidden or closed by the protocol) has no page. -->
                  <template v-if="a.asset">
                    <RouterLink :to="{ name: 'reserve', params: { address: a.reserve } }" class="name">{{ a.asset }}</RouterLink>
                    <div class="muted">{{ a.marketName ?? 'Unlisted market' }}</div>
                  </template>
                  <template v-else>
                    <a :href="solscanAccount(a.reserve)" target="_blank" rel="noopener" class="name ax-mono">{{ shortAddress(a.reserve) }}</a>
                    <div class="muted">Not monitored</div>
                  </template>
                </td>
                <td class="ax-table__td"><SeverityBadge :severity="a.severity" /></td>
                <td class="ax-table__td ax-table__td--num ax-num">{{ usd(a.usd) }}</td>
                <td class="ax-table__td share">
                  <span class="ax-num">{{ percent(a.share) }}</span>
                  <span class="bar"><span :style="{ width: `${Math.max(2, a.share * 100)}%` }"></span></span>
                </td>
                <td class="ax-table__td muted issue">{{ a.mainIssue ?? 'No issues found' }}</td>
                <td class="ax-table__td issue">
                  <ul v-if="a.collateralIssues.length" class="collateral">
                    <li v-for="c in a.collateralIssues" :key="c">{{ c }}</li>
                  </ul>
                  <span v-else class="muted">{{ a.asset ? 'No critical issue' : 'Unknown' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </template>
</template>

<style scoped>
.title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-3);
}
.state {
  padding: var(--ax-space-8);
  display: grid;
  gap: var(--ax-space-4);
  justify-items: start;
}
th {
  text-align: left;
}
.name {
  color: var(--ax-text-strong);
  font-weight: 600;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.issue {
  max-width: 300px;
  font-size: var(--ax-text-sm);
}
.share {
  min-width: 120px;
}
.bar {
  display: block;
  height: 6px;
  margin-top: var(--ax-space-1);
  border-radius: 999px;
  background: var(--ax-surface-subtle);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--ax-accent);
}
.collateral {
  display: grid;
  gap: var(--ax-space-1);
  color: var(--ax-danger-500);
}
</style>
