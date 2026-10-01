<script setup lang="ts">
import { computed } from 'vue'
import type { Reserve } from '@/api/client'
import { protocolName, shortAddress, usd } from '@/lib/format'

/**
 * Where a failure lands: per protocol, then per market, the deposits whose price would stop (red)
 * and those that keep a price through a fallback (grey). Bars share one scale across the card.
 */
const props = defineProps<{ stops: Reserve[]; keeps: Reserve[] }>()

interface Line {
  key: string
  name: string
  stopsUsd: number
  stopsCount: number
  keepsUsd: number
  keepsCount: number
}

const groups = computed(() => {
  const protocols = new Map<string, { protocol: string; total: Line; markets: Map<string, Line> }>()
  const blank = (key: string, name: string): Line => ({ key, name, stopsUsd: 0, stopsCount: 0, keepsUsd: 0, keepsCount: 0 })
  const add = (r: Reserve, stops: boolean) => {
    const p = protocols.get(r.protocol) ?? { protocol: r.protocol, total: blank(r.protocol, protocolName(r.protocol)), markets: new Map<string, Line>() }
    const m = p.markets.get(r.market.address) ?? blank(r.market.address, r.market.name ?? shortAddress(r.market.address))
    for (const line of [p.total, m]) {
      if (stops) {
        line.stopsUsd += r.totalSupplyUsd
        line.stopsCount++
      } else {
        line.keepsUsd += r.totalSupplyUsd
        line.keepsCount++
      }
    }
    p.markets.set(r.market.address, m)
    protocols.set(r.protocol, p)
  }
  props.stops.forEach((r) => add(r, true))
  props.keeps.forEach((r) => add(r, false))
  const order = (a: Line, b: Line) => b.stopsUsd - a.stopsUsd || b.keepsUsd - a.keepsUsd
  return [...protocols.values()]
    .map((p) => ({ ...p.total, markets: [...p.markets.values()].sort(order) }))
    .sort(order)
})

/** Markets shown per protocol; the rest are summed in one line, so a long tail does not fill the card. */
const TOP = 8
const rest = (markets: Line[]) => {
  const tail = markets.slice(TOP)
  return { count: tail.length, stopsUsd: tail.reduce((s, m) => s + m.stopsUsd, 0), keepsUsd: tail.reduce((s, m) => s + m.keepsUsd, 0) }
}

const max = computed(() => Math.max(1, ...groups.value.flatMap((g) => g.markets.map((m) => m.stopsUsd + m.keepsUsd))))
const width = (value: number) => `${(value / max.value) * 100}%`
const counts = (l: Line) =>
  [l.stopsCount ? `${usd(l.stopsUsd)} stops (${l.stopsCount})` : '', l.keepsCount ? `${usd(l.keepsUsd)} keeps a price (${l.keepsCount})` : '']
    .filter(Boolean)
    .join(' · ')
</script>

<template>
  <div class="breakdown">
    <section v-for="g in groups" :key="g.key" class="breakdown__protocol" :aria-label="g.name">
      <div class="breakdown__head">
        <h3 class="breakdown__title">{{ g.name }}</h3>
        <span class="breakdown__sum ax-num">{{ counts(g) }}</span>
      </div>
      <ul class="breakdown__list">
        <li v-for="m in g.markets.slice(0, TOP)" :key="m.key" class="breakdown__market">
          <div class="breakdown__row">
            <span class="breakdown__name" :title="m.name">{{ m.name }}</span>
            <span class="breakdown__value ax-num">
              <span v-if="m.stopsCount" class="stops">{{ usd(m.stopsUsd) }}</span>
              <span v-if="m.stopsCount && m.keepsCount" class="sep"> · </span>
              <span v-if="m.keepsCount" class="keeps">{{ usd(m.keepsUsd) }}</span>
            </span>
          </div>
          <div class="breakdown__bar" aria-hidden="true">
            <span class="bar bar--stops" :style="{ width: width(m.stopsUsd) }"></span>
            <span class="bar bar--keeps" :style="{ width: width(m.keepsUsd) }"></span>
          </div>
        </li>
        <li v-if="g.markets.length > TOP" class="breakdown__rest">
          {{ rest(g.markets).count }} more {{ rest(g.markets).count === 1 ? 'market' : 'markets' }}:
          <span v-if="rest(g.markets).stopsUsd" class="stops ax-num">{{ usd(rest(g.markets).stopsUsd) }}</span>
          <span v-if="rest(g.markets).stopsUsd && rest(g.markets).keepsUsd" class="sep"> · </span>
          <span v-if="rest(g.markets).keepsUsd" class="keeps ax-num">{{ usd(rest(g.markets).keepsUsd) }}</span>
        </li>
      </ul>
    </section>
    <p class="legend">
      <span class="legend__item"><span class="swatch swatch--stops"></span>No usable price</span>
      <span class="legend__item"><span class="swatch swatch--keeps"></span>Keeps a price through a fallback</span>
    </p>
  </div>
</template>

<style scoped>
.breakdown {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-5);
}
.breakdown__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--ax-space-1) var(--ax-space-3);
  margin-bottom: var(--ax-space-2);
}
.breakdown__title {
  margin: 0;
  font-size: var(--ax-text-sm);
  font-weight: var(--ax-weight-semibold);
  color: var(--ax-text-strong);
}
.breakdown__sum {
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.breakdown__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-3);
}
.breakdown__rest {
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.breakdown__row {
  display: flex;
  justify-content: space-between;
  gap: var(--ax-space-3);
  font-size: var(--ax-text-sm);
  margin-bottom: var(--ax-space-1);
}
.breakdown__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ax-text);
}
.breakdown__value {
  flex: 0 0 auto;
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-xs);
}
.stops {
  color: var(--ax-sev-crit-text);
  font-weight: 600;
}
.keeps,
.sep {
  color: var(--ax-text-muted);
}
.breakdown__bar {
  display: flex;
  gap: 2px;
  height: 6px;
  border-radius: 3px;
  background: var(--ax-fill-hover);
  overflow: hidden;
}
.bar {
  display: block;
  height: 100%;
}
.bar--stops {
  background: var(--ax-sev-crit);
}
.bar--keeps {
  background: var(--ax-text-subtle);
  opacity: 0.55;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-2) var(--ax-space-5);
  margin: 0;
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.legend__item {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.swatch--stops {
  background: var(--ax-sev-crit);
}
.swatch--keeps {
  background: var(--ax-text-subtle);
  opacity: 0.55;
}
@media print {
  .bar,
  .swatch {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}
</style>
