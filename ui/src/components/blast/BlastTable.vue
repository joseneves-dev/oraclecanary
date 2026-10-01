<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { Reserve } from '@/api/client'
import type { Reliance } from '@/lib/blastRadius'
import { HEALTH_BADGE, HEALTH_LABEL, protocolName, shortAddress, usd } from '@/lib/format'
import { healthState } from '@/lib/priceState'

export interface BlastRow {
  reserve: Reserve
  reliance: Reliance
  /** What else the price can come from, or also needs, in a few words. */
  note: string
  /** Scope only: the entries of the price account the reserve's chain multiplies. */
  entries?: number[]
}

/**
 * Reserves reached by a failure: what happens to each price, what else it can come from, and its
 * health now. Rows past the first page are revealed on request, and always when printing.
 */
const props = defineProps<{ rows: BlastRow[]; caption: string; showEntries?: boolean }>()

const PAGE = 25
const showAll = ref(false)
const shown = computed(() => (showAll.value ? props.rows : props.rows.slice(0, PAGE)))

const expand = () => (showAll.value = true)
onMounted(() => window.addEventListener('beforeprint', expand))
onBeforeUnmount(() => window.removeEventListener('beforeprint', expand))

const RELIANCE_LABEL: Record<Reliance, string> = { required: 'No usable price', fallback: 'Keeps a price', structure: 'Rate or peg only' }
const RELIANCE_BADGE: Record<Reliance, string> = { required: 'ax-badge--danger', fallback: 'ax-badge--success', structure: 'ax-badge--neutral' }

function market(r: Reserve): string {
  const name = r.market.name ?? shortAddress(r.market.address)
  const protocol = protocolName(r.protocol)
  return name.toLowerCase().startsWith(protocol.toLowerCase()) ? name : `${protocol} · ${name}`
}

</script>

<template>
  <div class="ax-table-wrap">
    <table class="ax-table ax-table--compact blast">
      <caption class="ax-visually-hidden">{{ caption }}</caption>
      <thead class="ax-table__head">
        <tr>
          <th class="ax-table__th col-asset" scope="col">Asset</th>
          <th class="ax-table__th col-effect" scope="col">If it stops</th>
          <th class="ax-table__th col-others" scope="col">Other sources</th>
          <th v-if="showEntries" class="ax-table__th col-entries" scope="col">Scope entries</th>
          <th class="ax-table__th col-now" scope="col">Health now</th>
          <th class="ax-table__th ax-table__th--num col-supply" scope="col">Supply</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in shown" :key="row.reserve.address" class="ax-table__row">
          <td class="ax-table__td col-asset">
            <RouterLink :to="{ name: 'reserve', params: { address: row.reserve.address } }" class="asset-link">{{
              row.reserve.asset || shortAddress(row.reserve.mint)
            }}</RouterLink>
            <span class="sub" :title="market(row.reserve)">{{ market(row.reserve) }}</span>
          </td>
          <td class="ax-table__td col-effect">
            <span class="ax-badge ax-badge--soft" :class="RELIANCE_BADGE[row.reliance]">{{ RELIANCE_LABEL[row.reliance] }}</span>
          </td>
          <td class="ax-table__td col-others">
            <span class="others">{{ row.note }}</span>
          </td>
          <td v-if="showEntries" class="ax-table__td col-entries ax-num">
            {{ row.entries?.length ? row.entries.map((e) => `#${e}`).join(' × ') : '—' }}
          </td>
          <td class="ax-table__td col-now">
            <span class="ax-badge ax-badge--soft" :class="HEALTH_BADGE[healthState(row.reserve)]">{{ HEALTH_LABEL[healthState(row.reserve)] }}</span>
          </td>
          <td class="ax-table__td ax-table__td--num col-supply" data-label="Supply">{{ usd(row.reserve.totalSupplyUsd) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-if="rows.length > PAGE" class="more">
    <button v-if="!showAll" type="button" class="ax-btn ax-btn--secondary ax-btn--sm" @click="showAll = true">Show all {{ rows.length }} reserves</button>
    <button v-else type="button" class="ax-btn ax-btn--ghost ax-btn--sm" @click="showAll = false">Show the largest {{ PAGE }}</button>
  </div>
</template>

<style scoped>
.blast {
  min-width: 760px;
}
.col-asset {
  min-width: 150px;
  max-width: 240px;
}
.asset-link {
  display: block;
  color: var(--ax-text-strong);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-link:hover {
  color: var(--ax-accent-text);
}
.sub {
  display: block;
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.col-effect,
.col-now {
  white-space: nowrap;
}
.others {
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.col-entries {
  font-size: var(--ax-text-xs);
  white-space: nowrap;
}
.col-supply {
  white-space: nowrap;
}
.more {
  display: flex;
  justify-content: center;
  padding: var(--ax-space-3);
  border-top: 1px solid var(--ax-border);
}

/* Phones: each row becomes a card. Asset and supply, then the effect and health, then the sources. */
@media (max-width: 640px) {
  .blast {
    min-width: 0;
  }
  .blast thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .blast tbody {
    display: block;
  }
  .blast tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'asset supply'
      'effect now'
      'others others'
      'entries entries';
    gap: var(--ax-space-1) var(--ax-space-3);
    padding: var(--ax-space-3) var(--ax-space-4);
    border-bottom: 1px solid var(--ax-border);
  }
  .blast td {
    display: block;
    padding: 0;
    border: 0;
  }
  .blast .col-asset {
    grid-area: asset;
    min-width: 0;
    max-width: none;
  }
  .blast .col-supply {
    grid-area: supply;
    justify-self: end;
    font-weight: 600;
  }
  .blast .col-effect {
    grid-area: effect;
  }
  .blast .col-now {
    grid-area: now;
    justify-self: end;
  }
  .blast .col-others {
    grid-area: others;
  }
  .blast .col-entries {
    grid-area: entries;
  }
  .blast .col-entries::before {
    content: 'Scope entries ';
    color: var(--ax-text-subtle);
  }
}

@media print {
  .more {
    display: none;
  }
  .blast {
    min-width: 0;
  }
}
</style>
