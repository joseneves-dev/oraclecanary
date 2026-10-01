<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { FeedSummary } from '@/lib/blastRadius'
import AxIcon from '@/components/AxIcon.vue'
import { shortAddress, solscanAccount, usd } from '@/lib/format'
import { EXTERNAL_LINK_ICON } from './market'

/** Oracle accounts behind a provider: each opens the reserves that read it. */
defineProps<{ feeds: FeedSummary[]; caption: string }>()
</script>

<template>
  <div class="ax-table-wrap">
    <table class="ax-table ax-table--compact feeds">
      <caption class="ax-visually-hidden">{{ caption }}</caption>
      <thead class="ax-table__head">
        <tr>
          <th class="ax-table__th" scope="col">Feed account</th>
          <th class="ax-table__th" scope="col">Provider</th>
          <th class="ax-table__th ax-table__th--num" scope="col">Reserves</th>
          <th class="ax-table__th ax-table__th--num" scope="col">Would stop</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="f in feeds" :key="f.account" class="ax-table__row">
          <td class="ax-table__td col-account" data-label="Feed">
            <RouterLink :to="{ query: { feed: f.account } }" class="account ax-num" :title="f.account">{{ shortAddress(f.account) }}</RouterLink>
            <a :href="solscanAccount(f.account)" target="_blank" rel="noopener" class="solscan" aria-label="View on Solscan" title="View on Solscan"
              ><AxIcon :path="EXTERNAL_LINK_ICON" :size="14"
            /></a>
          </td>
          <td class="ax-table__td col-provider" data-label="Provider">{{ f.provider }}</td>
          <td class="ax-table__td ax-table__td--num col-count" data-label="Reserves">{{ f.count }}</td>
          <td class="ax-table__td ax-table__td--num col-stops" data-label="Would stop">
            <span :class="{ stops: f.stopsCount }">{{ usd(f.stopsUsd) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.account {
  font-family: var(--ax-font-mono);
  font-weight: 600;
  color: var(--ax-text-strong);
}
.account:hover {
  color: var(--ax-accent-text);
}
.solscan {
  display: inline-flex;
  vertical-align: -2px;
  margin-inline-start: var(--ax-space-2);
  font-size: var(--ax-text-xs);
  color: var(--ax-text-subtle);
}
.solscan:hover {
  color: var(--ax-accent-text);
}
.stops {
  color: var(--ax-sev-crit-text);
  font-weight: 600;
}
.subtle {
  color: var(--ax-text-subtle);
  font-size: var(--ax-text-xs);
}
td {
  white-space: nowrap;
}
@media (max-width: 640px) {
  .feeds thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .feeds tbody {
    display: block;
  }
  .feeds tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'account stops'
      'provider count';
    gap: var(--ax-space-1) var(--ax-space-3);
    padding: var(--ax-space-3) var(--ax-space-4);
    border-bottom: 1px solid var(--ax-border);
  }
  .feeds td {
    display: block;
    padding: 0;
    border: 0;
  }
  .col-account {
    grid-area: account;
  }
  .col-provider {
    grid-area: provider;
    font-size: var(--ax-text-xs);
    color: var(--ax-text-muted);
  }
  .col-count {
    grid-area: count;
    justify-self: end;
    font-size: var(--ax-text-xs);
    color: var(--ax-text-muted);
  }
  .col-count::after {
    content: ' reserves';
  }
  .col-stops {
    grid-area: stops;
    justify-self: end;
  }
}
</style>
