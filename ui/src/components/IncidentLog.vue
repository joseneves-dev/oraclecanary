<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import type { ReserveIncident } from '@/api/client'
import ReserveTags from '@/components/ReserveTags.vue'
import { dateTime, duration, protocolName, usd } from '@/lib/format'

defineProps<{ incidents: ReserveIncident[] }>()

const router = useRouter()

/** The critical checks that caused an incident; tags such as MARKET_CLOSED are shown in their own column. */
const cause = (i: ReserveIncident) => i.checks.filter((c) => c.severity === 'critical').map((c) => c.code).join(', ') || '—'

/** Ended incidents have a duration; ongoing ones are measured up to now. */
const elapsed = (i: ReserveIncident) =>
  i.durationSeconds ?? Math.max(0, Math.round((Date.now() - Date.parse(i.startedAt)) / 1000))
</script>

<template>
  <div class="ax-table-wrap">
    <table class="ax-table ax-table--hover ax-table--compact">
      <thead class="ax-table__head">
        <tr>
          <th scope="col" class="ax-table__th">Reserve</th>
          <th scope="col" class="ax-table__th">Cause</th>
          <th scope="col" class="ax-table__th">Tags</th>
          <th scope="col" class="ax-table__th">Started</th>
          <th scope="col" class="ax-table__th">Ended</th>
          <th scope="col" class="ax-table__th ax-table__th--num">Duration</th>
          <th scope="col" class="ax-table__th ax-table__th--num">Exposed</th>
        </tr>
      </thead>
      <tbody>
        <!-- The whole row opens the reserve; the asset link keeps it reachable by keyboard. -->
        <tr v-for="i in incidents" :key="i.id" class="ax-table__row row-link" @click="router.push({ name: 'reserve', params: { address: i.reserve } })">
          <td class="ax-table__td">
            <RouterLink class="asset" :to="{ name: 'reserve', params: { address: i.reserve } }">{{ i.asset }}</RouterLink>
            <div class="muted">{{ protocolName(i.protocol) }} · {{ i.marketName }}</div>
          </td>
          <td class="ax-table__td codes">{{ cause(i) }}</td>
          <td class="ax-table__td"><ReserveTags :checks="i.checks" /></td>
          <td class="ax-table__td nowrap">
            <span v-if="i.startEstimated" title="Already failing when tracking started: worked out from the age of its price">≈ </span>{{ dateTime(i.startedAt) }}
          </td>
          <td class="ax-table__td nowrap">
            <template v-if="i.endedAt">{{ dateTime(i.endedAt) }}</template>
            <span v-else class="ax-badge ax-badge--soft ax-badge--pill ax-badge--danger">Ongoing</span>
          </td>
          <td class="ax-table__td ax-table__td--num nowrap">{{ duration(elapsed(i)) }}<span v-if="!i.endedAt" class="so-far"> so far</span></td>
          <td class="ax-table__td ax-table__td--num nowrap">{{ usd(i.totalSupplyUsd) }}</td>
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
.so-far {
  font-family: var(--ax-font-sans, inherit);
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.codes {
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-xs);
}
</style>
