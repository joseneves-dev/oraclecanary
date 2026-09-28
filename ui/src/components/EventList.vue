<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import type { ReserveEvent } from '@/api/client'
import { dateTime, usd } from '@/lib/format'

defineProps<{
  events: ReserveEvent[]
  /** Hide the asset column, e.g. on a reserve's own page. */
  hideAsset?: boolean
}>()

const router = useRouter()

const DIRECTION: Record<ReserveEvent['direction'], { label: string; badge: string }> = {
  degraded: { label: 'Degraded', badge: 'ax-badge--danger' },
  recovered: { label: 'Recovered', badge: 'ax-badge--success' },
  changed: { label: 'Changed', badge: 'ax-badge--info' },
}

</script>

<template>
  <div class="ax-table-wrap">
    <table class="ax-table ax-table--hover">
      <thead>
        <tr>
          <th scope="col">Started</th>
          <th v-if="!hideAsset" scope="col">Reserve</th>
          <th scope="col">Change</th>
          <th scope="col">What changed</th>
          <th scope="col" class="num">Score</th>
          <th v-if="!hideAsset" scope="col" class="num">Supply</th>
        </tr>
      </thead>
      <tbody>
        <!-- Rows open the reserve (the asset link keeps it reachable by keyboard); pointless on its own page. -->
        <tr
          v-for="e in events"
          :key="e.id"
          :class="{ 'row-link': !hideAsset }"
          @click="!hideAsset && router.push({ name: 'reserve', params: { address: e.reserve } })"
        >
          <td class="nowrap">{{ dateTime(e.occurredAt) }}</td>
          <td v-if="!hideAsset">
            <RouterLink :to="{ name: 'reserve', params: { address: e.reserve } }">{{ e.asset }}</RouterLink>
            <div class="muted">{{ e.protocol }} · {{ e.marketName }}</div>
          </td>
          <td>
            <span class="ax-badge ax-badge--soft ax-badge--pill" :class="DIRECTION[e.direction].badge">{{ DIRECTION[e.direction].label }}</span>
          </td>
          <td>
            <span v-for="c in e.started" :key="`s-${c.code}`" class="change change--started" :title="`${c.code} started failing (${c.severity})`">+ {{ c.code }}</span>
            <span v-for="c in e.resolved" :key="`r-${c.code}`" class="change change--resolved" :title="`${c.code} stopped failing`">− {{ c.code }}</span>
          </td>
          <td class="num ax-num nowrap">{{ e.previousScore }} → {{ e.score }}</td>
          <td v-if="!hideAsset" class="num ax-num">{{ usd(e.totalSupplyUsd) }}</td>
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
.change {
  display: inline-block;
  margin-right: var(--ax-space-2);
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-xs);
}
.change--started {
  color: var(--ax-danger-500);
}
.change--resolved {
  color: var(--ax-success-500);
}
</style>
