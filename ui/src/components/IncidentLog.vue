<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import type { ReserveIncident } from '@/api/client'
import ReserveTags from '@/components/ReserveTags.vue'
import { dateTime, duration, protocolName, usd } from '@/lib/format'
import { priceState } from '@/lib/priceState'

defineProps<{ incidents: ReserveIncident[] }>()

const router = useRouter()

/** The critical checks that caused an incident; tags such as MARKET_CLOSED are shown in their own column. */
const cause = (i: ReserveIncident) => i.checks.filter((c) => c.severity === 'critical').map((c) => c.code).join(', ') || '—'

/** A stock paused by its closed market, with nothing else wrong: said in words, as on My positions. */
const marketClosed = (i: ReserveIncident) => priceState({ checks: i.checks, severity: 'critical' }) === 'paused'

/** Ended incidents have a duration; ongoing ones are measured up to now. */
const elapsed = (i: ReserveIncident) =>
  i.durationSeconds ?? Math.max(0, Math.round((Date.now() - Date.parse(i.startedAt)) / 1000))
</script>

<template>
  <div class="ax-table-wrap">
    <table class="ax-table ax-table--hover ax-table--compact log">
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
          <td class="ax-table__td">
            <span v-if="marketClosed(i)" class="closed" :title="cause(i)">Market closed</span>
            <span v-else class="codes">{{ cause(i) }}</span>
          </td>
          <td class="ax-table__td"><ReserveTags :checks="i.checks" /></td>
          <td class="ax-table__td nowrap" data-label="Started">
            <span v-if="i.startEstimated" title="Already failing when tracking started: worked out from the age of its price">≈ </span>{{ dateTime(i.startedAt) }}
          </td>
          <td class="ax-table__td nowrap" data-label="Ended">
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
.closed {
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
  white-space: nowrap;
}
.codes {
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-xs);
}
/* Phones: each incident becomes a card. */
@media (max-width: 640px) {
  .log thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .log,
  .log tbody {
    display: block;
  }
  .log tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'reserve exposed'
      'cause tags'
      'started duration'
      'ended ended';
    gap: var(--ax-space-1) var(--ax-space-3);
    padding: var(--ax-space-3) var(--ax-space-4);
    border-bottom: 1px solid var(--ax-border);
  }
  .log td {
    display: block;
    padding: 0;
    border: 0;
  }
  .log td:nth-child(1) { grid-area: reserve; }
  .log td:nth-child(2) { grid-area: cause; }
  .log td:nth-child(3) { grid-area: tags; justify-self: end; }
  .log td:nth-child(4) { grid-area: started; }
  .log td:nth-child(5) { grid-area: ended; }
  .log td:nth-child(6) { grid-area: duration; }
  .log td:nth-child(7) { grid-area: exposed; }
  .log td[data-label]::before {
    content: attr(data-label) ' ';
    font-size: var(--ax-text-xs);
    color: var(--ax-text-subtle);
  }
}
</style>
