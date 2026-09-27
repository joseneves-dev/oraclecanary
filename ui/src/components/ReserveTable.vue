<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { Reserve } from '@/api/client'
import SeverityBadge from '@/components/SeverityBadge.vue'
import { duration, shortAddress, usd } from '@/lib/format'

export type SortKey = 'score' | 'totalSupplyUsd' | 'priceAgeSeconds' | 'asset'

const props = defineProps<{
  rows: Reserve[]
  /** When set, headers of sortable columns become buttons that emit `sort`. */
  sortKey?: SortKey
  sortDir?: 'asc' | 'desc'
}>()

const emit = defineEmits<{ sort: [key: SortKey] }>()

const sortable = (_key: SortKey) => props.sortKey !== undefined
const ariaSort = (key: SortKey) =>
  props.sortKey === key ? (props.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'

/** The check a user should read first: the first critical one, otherwise the first one. */
function mainIssue(r: Reserve): string {
  const check = r.checks.find((c) => c.severity === 'critical') ?? r.checks[0]
  return check ? check.message : 'No issues found'
}
</script>

<template>
  <div class="ax-table-wrap">
    <table class="ax-table ax-table--hover" style="min-width: 860px">
      <caption class="ax-visually-hidden">Lending reserves and the health of their oracle feeds</caption>
      <thead class="ax-table__head">
        <tr>
          <th
            v-for="col in [
              { key: 'asset', label: 'Asset' },
              { key: null, label: 'Market' },
              { key: 'score', label: 'Health' },
              { key: null, label: 'Main issue' },
              { key: null, label: 'Oracles' },
              { key: 'priceAgeSeconds', label: 'Price age' },
              { key: 'totalSupplyUsd', label: 'Supply', num: true },
            ] as { key: SortKey | null; label: string; num?: boolean }[]"
            :key="col.label"
            class="ax-table__th"
            :class="{ 'ax-table__th--sortable': col.key && sortable(col.key), 'ax-table__th--num': col.num }"
            scope="col"
            :aria-sort="col.key && sortable(col.key) ? ariaSort(col.key) : undefined"
            @click="col.key && sortable(col.key) && emit('sort', col.key)"
          >
            {{ col.label }}
            <template v-if="col.key && sortable(col.key)">
              <svg v-if="sortKey !== col.key" class="ax-table__sort" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity: 0.4"><path d="M8 9l4 -4l4 4" /><path d="M16 15l-4 4l-4 -4" /></svg>
              <svg v-else-if="sortDir === 'asc'" class="ax-table__sort" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6 -6l6 6" /></svg>
              <svg v-else class="ax-table__sort" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6" /></svg>
            </template>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.address" class="ax-table__row">
          <td class="ax-table__td">
            <RouterLink :to="{ name: 'reserve', params: { address: r.address } }" class="asset-link">{{ r.asset || shortAddress(r.mint) }}</RouterLink>
          </td>
          <td class="ax-table__td muted">{{ r.market.name ?? shortAddress(r.market.address) }}</td>
          <td class="ax-table__td">
            <span class="health">
              <SeverityBadge :severity="r.severity" />
              <span class="ax-num score">{{ r.score }}</span>
            </span>
          </td>
          <td class="ax-table__td issue">{{ mainIssue(r) }}</td>
          <td class="ax-table__td muted">{{ r.providers.join(', ') || '—' }}</td>
          <td class="ax-table__td ax-num" :class="{ stale: r.price.isStale }">
            {{ duration(r.price.ageSeconds) }}<span class="muted"> / {{ duration(r.price.maxAgeSeconds) }}</span>
          </td>
          <td class="ax-table__td ax-table__td--num ax-num">{{ usd(r.totalSupplyUsd) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.asset-link {
  color: var(--ax-text-strong);
  font-weight: 600;
}
.asset-link:hover {
  color: var(--ax-accent);
}
.muted {
  color: var(--ax-text-muted);
}
.health {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
}
.score {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-xs);
}
.issue {
  max-width: 320px;
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.stale {
  color: var(--ax-danger-500);
  font-weight: 600;
}
</style>
