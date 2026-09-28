<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import type { ReserveIncident } from '@/api/client'
import MarketClosedBadge from '@/components/MarketClosedBadge.vue'
import { dateTime, duration, usd } from '@/lib/format'

defineProps<{ incidents: ReserveIncident[] }>()

const router = useRouter()

/** Ended incidents have a duration; ongoing ones are measured up to now. */
const elapsed = (i: ReserveIncident) =>
  i.durationSeconds ?? Math.max(0, Math.round((Date.now() - Date.parse(i.startedAt)) / 1000))
</script>

<template>
  <div class="ax-table-wrap">
    <table class="ax-table ax-table--hover">
      <thead>
        <tr>
          <th scope="col">Reserve</th>
          <th scope="col">Cause</th>
          <th scope="col">Started</th>
          <th scope="col">Ended</th>
          <th scope="col" class="num">Duration</th>
          <th scope="col" class="num">Exposed</th>
        </tr>
      </thead>
      <tbody>
        <!-- The whole row opens the reserve; the asset link keeps it reachable by keyboard. -->
        <tr v-for="i in incidents" :key="i.id" class="row-link" @click="router.push({ name: 'reserve', params: { address: i.reserve } })">
          <td>
            <RouterLink :to="{ name: 'reserve', params: { address: i.reserve } }">{{ i.asset }}</RouterLink>
            <div class="muted">{{ i.protocol }} · {{ i.marketName }}</div>
          </td>
          <td>
            <span class="codes">{{ i.checks.filter((c) => c.code !== 'MARKET_CLOSED').map((c) => c.code).join(', ') }}</span>
            <MarketClosedBadge :checks="i.checks" />
          </td>
          <td class="nowrap">
            <span v-if="i.startEstimated" title="Already failing when tracking started: worked out from the age of its price">≈ </span>{{ dateTime(i.startedAt) }}
          </td>
          <td class="nowrap">
            <template v-if="i.endedAt">{{ dateTime(i.endedAt) }}</template>
            <span v-else class="ax-badge ax-badge--soft ax-badge--pill ax-badge--danger">Ongoing</span>
          </td>
          <td class="num ax-num nowrap">{{ duration(elapsed(i)) }}<span v-if="!i.endedAt" class="muted"> so far</span></td>
          <td class="num ax-num">{{ usd(i.totalSupplyUsd) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.row-link {
  cursor: pointer;
}
th {
  text-align: left;
}
.num {
  text-align: right;
}
.nowrap {
  white-space: nowrap;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
.codes {
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-xs);
}
</style>
