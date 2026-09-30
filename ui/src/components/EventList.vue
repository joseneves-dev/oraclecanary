<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import type { ReserveEvent } from '@/api/client'
import { dateTime, protocolName, usd } from '@/lib/format'

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
    <table class="ax-table ax-table--hover ax-table--compact">
      <thead class="ax-table__head">
        <tr>
          <th scope="col" class="ax-table__th">Started</th>
          <th v-if="!hideAsset" scope="col" class="ax-table__th">Reserve</th>
          <th scope="col" class="ax-table__th">Change</th>
          <th scope="col" class="ax-table__th">What changed</th>
          <th scope="col" class="ax-table__th ax-table__th--num">Score</th>
          <th v-if="!hideAsset" scope="col" class="ax-table__th ax-table__th--num">Supply</th>
        </tr>
      </thead>
      <tbody>
        <!-- Rows open the reserve (the asset link keeps it reachable by keyboard); pointless on its own page. -->
        <tr
          v-for="e in events"
          :key="e.id"
          class="ax-table__row"
          :class="{ 'row-link': !hideAsset }"
          @click="!hideAsset && router.push({ name: 'reserve', params: { address: e.reserve } })"
        >
          <td class="ax-table__td nowrap">{{ dateTime(e.occurredAt) }}</td>
          <td v-if="!hideAsset" class="ax-table__td">
            <RouterLink class="asset" :to="{ name: 'reserve', params: { address: e.reserve } }">{{ e.asset }}</RouterLink>
            <div class="muted">{{ protocolName(e.protocol) }} · {{ e.marketName }}</div>
          </td>
          <td class="ax-table__td">
            <span class="ax-badge ax-badge--soft ax-badge--pill" :class="DIRECTION[e.direction].badge">{{ DIRECTION[e.direction].label }}</span>
          </td>
          <td class="ax-table__td">
            <span v-for="c in e.started" :key="`s-${c.code}`" class="change change--started" :title="`${c.code} started failing (${c.severity})`">+ {{ c.code }}</span>
            <span v-for="c in e.resolved" :key="`r-${c.code}`" class="change change--resolved" :title="`${c.code} stopped failing`">− {{ c.code }}</span>
          </td>
          <td class="ax-table__td ax-table__td--num nowrap">{{ e.previousScore }} → {{ e.score }}</td>
          <td v-if="!hideAsset" class="ax-table__td ax-table__td--num nowrap">{{ usd(e.totalSupplyUsd) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.row-link {
  cursor: pointer;
}
.asset {
  font-weight: 600;
  color: var(--ax-text-strong);
}
.asset:hover {
  color: var(--ax-accent-text);
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
