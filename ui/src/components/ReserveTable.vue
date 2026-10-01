<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Reserve, Severity } from '@/api/client'
import ReserveTags from '@/components/ReserveTags.vue'
import { SEVERITY_LABEL, SEVERITY_TONE, checkMessage, duration, protocolName, shortAddress, usd } from '@/lib/format'
import { hasTags } from '@/lib/tags'

export type SortKey = 'score' | 'totalSupplyUsd' | 'priceAgeSeconds' | 'asset'

const props = defineProps<{
  rows: Reserve[]
  /** When set, headers of sortable columns become buttons that emit `sort`. */
  sortKey?: SortKey
  sortDir?: 'asc' | 'desc'
  /** A summary for narrow cards: asset, health, main issue and supply only. */
  compact?: boolean
  /** Placeholder rows to show while there are no rows yet. */
  loadingRows?: number
  /** Leaves out the Oracles column, e.g. where every row has the same provider. */
  hideOracles?: boolean
}>()

const emit = defineEmits<{ sort: [key: SortKey] }>()

type Column = { key: SortKey | null; id: string; label: string; num?: boolean; full?: boolean }
const ALL_COLUMNS: Column[] = [
  { key: 'asset', id: 'asset', label: 'Asset' },
  { key: 'score', id: 'score', label: 'Health' },
  { key: null, id: 'issue', label: 'Main issue' },
  { key: null, id: 'tags', label: 'Tags', full: true },
  { key: null, id: 'oracles', label: 'Oracles', full: true },
  { key: 'priceAgeSeconds', id: 'age', label: 'Price age', num: true, full: true },
  { key: 'totalSupplyUsd', id: 'supply', label: 'Supply', num: true },
]
/** The Tags column only when a row has one (loading rows keep it, so the layout does not jump). */
const showTags = computed(() => !props.compact && (!props.rows.length || props.rows.some((r) => hasTags(r.checks))))
const columns = computed(() =>
  ALL_COLUMNS.filter((c) => (props.compact ? !c.full : (c.id !== 'tags' || showTags.value) && (c.id !== 'oracles' || !props.hideOracles))),
)

const isSortable = (key: SortKey | null): key is SortKey => key !== null && props.sortKey !== undefined
const ariaSort = (key: SortKey) => (props.sortKey === key ? (props.sortDir === 'asc' ? 'ascending' : 'descending') : 'none')

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'info']

/** The check a user should read first: the most severe one. */
function mainIssue(r: Reserve): string {
  for (const severity of SEVERITY_ORDER) {
    const check = r.checks.find((c) => c.severity === severity)
    if (check) return checkMessage(check.message)
  }
  return 'No issues found'
}

/** The protocol and market under the asset, without repeating a protocol name the market already carries. */
function subLine(r: Reserve): string {
  const market = r.market.name ?? shortAddress(r.market.address)
  const protocol = protocolName(r.protocol)
  return market.toLowerCase().startsWith(protocol.toLowerCase()) ? market : `${protocol} · ${market}`
}

/** Oracle chips shown in a row; the rest are counted in a "+n" chip. */
const MAX_ORACLES = 2
</script>

<template>
  <div class="ax-table-wrap">
    <table class="ax-table ax-table--hover ax-table--compact reserves" :class="{ 'reserves--compact': compact }">
      <caption class="ax-visually-hidden">Lending reserves and the health of their oracle feeds</caption>
      <thead class="ax-table__head">
        <tr>
          <th
            v-for="col in columns"
            :key="col.id"
            class="ax-table__th"
            :class="[{ 'ax-table__th--num': col.num }, `col-${col.id}`]"
            scope="col"
            :aria-sort="isSortable(col.key) ? ariaSort(col.key) : undefined"
          >
            <!-- The arrow sits right of the label, shown on hover and on the active column only. -->
            <button
              v-if="isSortable(col.key)"
              type="button"
              class="sort-button"
              :class="{ 'sort-button--active': sortKey === col.key }"
              @click="emit('sort', col.key)"
            >
              {{ col.label }}
              <svg v-if="sortKey !== col.key" class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9l4 -4l4 4" /><path d="M16 15l-4 4l-4 -4" /></svg>
              <svg v-else-if="sortDir === 'asc'" class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6 -6l6 6" /></svg>
              <svg v-else class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6" /></svg>
            </button>
            <template v-else>{{ col.label }}</template>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.address" class="ax-table__row">
          <td class="ax-table__td col-asset">
            <RouterLink :to="{ name: 'reserve', params: { address: r.address } }" class="asset-link">{{ r.asset || shortAddress(r.mint) }}</RouterLink>
            <span class="sub" :title="subLine(r)">
              {{ subLine(r) }}
            </span>
          </td>
          <td class="ax-table__td col-score" :title="`${SEVERITY_LABEL[r.severity]}: health score ${r.score} of 100`">
            <span class="health">
              <span class="score ax-num" :class="SEVERITY_TONE[r.severity] && `score--${SEVERITY_TONE[r.severity]}`">{{ r.score }}</span>
              <span class="meter" :class="SEVERITY_TONE[r.severity] && `meter--${SEVERITY_TONE[r.severity]}`" aria-hidden="true">
                <span :style="{ width: `${Math.max(0, Math.min(100, r.score))}%` }"></span>
              </span>
              <span class="ax-visually-hidden">{{ SEVERITY_LABEL[r.severity] }}</span>
            </span>
          </td>
          <td class="ax-table__td col-issue">
            <span class="issue" :title="mainIssue(r)">{{ mainIssue(r) }}</span>
          </td>
          <td v-if="showTags" class="ax-table__td col-tags"><ReserveTags :checks="r.checks" /></td>
          <td v-if="!compact && !hideOracles" class="ax-table__td col-oracles">
            <span v-if="r.providers.length" class="chips">
              <span v-for="p in r.providers.slice(0, MAX_ORACLES)" :key="p" class="ax-badge ax-badge--soft ax-badge--neutral chip" :title="p">{{ p }}</span>
              <span
                v-if="r.providers.length > MAX_ORACLES"
                class="ax-badge ax-badge--outline chip chip--more"
                :title="r.providers.slice(MAX_ORACLES).join(', ')"
                :aria-label="`and ${r.providers.slice(MAX_ORACLES).join(', ')}`"
                >+{{ r.providers.length - MAX_ORACLES }}</span
              >
            </span>
            <span v-else class="subtle">—</span>
          </td>
          <td v-if="!compact" class="ax-table__td ax-table__td--num nowrap col-age" data-label="Price age">
            <span v-if="r.price.ageSeconds === null" class="subtle" :title="`No price at all; the protocol accepts prices up to ${duration(r.price.maxAgeSeconds)} old`"
              >No price<span class="subtle"> / {{ duration(r.price.maxAgeSeconds) }}</span></span
            >
            <template v-else>
              <span :class="{ stale: r.price.isStale === true }">{{ duration(r.price.ageSeconds) }}</span><span class="subtle"> / {{ duration(r.price.maxAgeSeconds) }}</span>
            </template>
          </td>
          <td class="ax-table__td ax-table__td--num nowrap col-supply" data-label="Supply">{{ usd(r.totalSupplyUsd) }}</td>
        </tr>
        <!-- Placeholder rows while the first page loads. -->
        <template v-if="!rows.length && loadingRows">
          <tr v-for="n in loadingRows" :key="`skeleton-${n}`" class="skeleton-row" aria-hidden="true">
            <td v-for="col in columns" :key="col.id" class="ax-table__td" :class="`col-${col.id}`">
              <span class="ax-skeleton ax-skeleton--line" :style="{ width: col.id === 'issue' ? '90%' : '60%' }"></span>
              <span v-if="col.id === 'asset'" class="ax-skeleton ax-skeleton--line skeleton-sub"></span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>


<style scoped>
.reserves {
  min-width: 900px;
}
.reserves--compact {
  min-width: 560px;
}
.sort-button {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-1);
  font: inherit;
  color: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.sort-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.15s;
}
.sort-button:hover .sort-icon,
.sort-button:focus-visible .sort-icon {
  opacity: 0.6;
}
.sort-button--active {
  color: var(--ax-accent-text, var(--ax-accent));
}
.sort-button--active .sort-icon {
  opacity: 1;
}
.sort-button:focus-visible {
  outline: 2px solid var(--ax-accent);
  outline-offset: 2px;
  border-radius: var(--ax-radius-sm);
}

/* The asset stays in view while the rest of the row scrolls sideways. */
.col-asset {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 150px;
  max-width: 220px;
  background: var(--ax-surface-solid);
  box-shadow: inset -1px 0 0 var(--ax-border);
}
@media (max-width: 576px) {
  .col-asset {
    min-width: 120px;
    max-width: 150px;
  }
}
th.col-asset {
  z-index: 2;
  background: linear-gradient(var(--ax-surface-subtle), var(--ax-surface-subtle)), var(--ax-surface-solid);
}
.ax-table__row:hover .col-asset {
  background: linear-gradient(var(--ax-fill-hover), var(--ax-fill-hover)), var(--ax-surface-solid);
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
.nowrap {
  white-space: nowrap;
}
.muted {
  color: var(--ax-text-muted);
}
.subtle {
  color: var(--ax-text-subtle);
}

.health {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
  white-space: nowrap;
}
.score {
  min-width: 2ch;
  text-align: end;
  font-family: var(--ax-font-mono);
  font-weight: 600;
  color: var(--ax-text-strong);
}
.score--danger {
  color: var(--ax-danger-500);
}
.score--warning {
  color: var(--ax-warning-500);
}
.meter {
  display: inline-block;
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--ax-fill-hover);
  box-shadow: inset 0 0 0 1px var(--ax-border);
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  background: var(--ax-text-subtle);
}
.meter--danger span {
  background: var(--ax-danger-500);
}
.meter--warning span {
  background: var(--ax-warning-500);
}

.col-issue {
  min-width: 220px;
  max-width: 320px;
}
.issue {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  font-size: var(--ax-text-xs);
  line-height: 1.45;
  color: var(--ax-text-muted);
}

.chips {
  display: inline-flex;
  flex-wrap: nowrap;
  gap: var(--ax-space-1);
}
.chip {
  display: inline-block;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ax-text-2xs, 0.6875rem);
}
.chip--more {
  cursor: help;
}
.stale {
  color: var(--ax-danger-500);
  font-weight: 600;
}
.skeleton-sub {
  display: block;
  width: 70%;
  margin-top: 6px;
}

/* Tags and oracles are details: below 1200px the row keeps what decides (health, issue, age, supply). */
@media (max-width: 1199px) {
  .col-tags,
  .col-oracles {
    display: none;
  }
  .reserves {
    min-width: 720px;
  }
}

/* Phones: each row becomes a card. Line 1 asset and health, line 2 the issue, line 3 age and supply. */
@media (max-width: 640px) {
  .reserves,
  .reserves--compact {
    min-width: 0;
  }
  .reserves thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .reserves tbody {
    display: block;
  }
  .reserves tr {
    display: grid;
    /* Health is pinned to the right edge, so it never shifts with the length of the market name. */
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'asset score'
      'issue issue'
      'age supply';
    gap: var(--ax-space-1) var(--ax-space-3);
    padding: var(--ax-space-3) var(--ax-space-4);
    border-bottom: 1px solid var(--ax-border);
  }
  .reserves td {
    display: block;
    padding: 0;
    border: 0;
  }
  .reserves .col-tags,
  .reserves .col-oracles {
    display: none;
  }
  .reserves .col-asset {
    grid-area: asset;
    position: static;
    min-width: 0;
    max-width: none;
    background: none;
    box-shadow: none;
  }
  .reserves .col-score {
    grid-area: score;
    align-self: start;
    justify-self: end;
  }
  .reserves .col-issue {
    grid-area: issue;
    min-width: 0;
    max-width: none;
  }
  .reserves .col-age {
    grid-area: age;
    text-align: start;
  }
  .reserves .col-supply {
    grid-area: supply;
    justify-self: end;
  }
  .reserves:not(.reserves--compact) .col-age::before,
  .reserves .col-supply::before {
    content: attr(data-label) ' ';
    font-family: var(--ax-font-sans);
    font-size: var(--ax-text-xs);
    color: var(--ax-text-subtle);
  }
  .reserves .skeleton-row .col-age,
  .reserves .skeleton-row .col-supply {
    display: none;
  }
}
</style>
