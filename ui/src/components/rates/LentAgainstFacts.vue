<script setup lang="ts">
import { computed } from 'vue'
import type { LentAgainst } from '@/api/client'
import { usd } from '@/lib/format'
import { COMPOSITION, pct } from './rates'

/**
 * What a pool's deposits are lent against, as facts: the collateral's value, how its prices are
 * built (a bar of shares by value) and chips for the facts that apply to part of it.
 */
const props = defineProps<{ facts: LentAgainst }>()

const segments = computed(() => {
  const f = props.facts
  const known = COMPOSITION.map((c) => ({ ...c, share: Math.max(0, f[c.key]) }))
  const rest = Math.max(0, 1 - known.reduce((sum, s) => sum + s.share, 0))
  return [...known, { key: 'rest' as const, label: 'Unreadable or no oracle', tone: 'rest', share: rest }].filter((s) => s.share >= 0.0005)
})

const summary = computed(() =>
  segments.value.map((s) => `${pct(s.share, 0)} ${s.label.toLowerCase()}`).join(', '),
)

const criticalTitle = computed(() => {
  const f = props.facts
  if (!f.criticalCount) return ''
  const more = f.criticalCount - f.criticalAssets.length
  return `Critical now: ${f.criticalAssets.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
})
</script>

<template>
  <div v-if="facts.reserves === 0 || facts.collateralUsd <= 0" class="none">No collateral found</div>
  <div v-else class="facts">
    <div class="facts__head">
      <span class="ax-num facts__usd">{{ usd(facts.collateralUsd) }}</span>
      <span class="facts__count">in {{ facts.reserves }} {{ facts.basis === 'vaults' ? (facts.reserves === 1 ? 'vault' : 'vaults') : facts.reserves === 1 ? 'reserve' : 'reserves' }}</span>
    </div>
    <div class="bar" role="img" :aria-label="`Collateral prices: ${summary}`">
      <span
        v-for="s in segments"
        :key="s.key"
        class="bar__seg"
        :class="`bar__seg--${s.tone}`"
        :style="{ flexGrow: s.share }"
        :title="`${pct(s.share, 1)} ${s.label.toLowerCase()}`"
      ></span>
    </div>
    <div class="chips">
      <span v-if="facts.withFallbackShare >= 0.0005" class="chip" title="Share of the collateral whose price has a fallback"><i class="dot dot--fallback" aria-hidden="true"></i>{{ pct(facts.withFallbackShare, 0) }} fallback</span>
      <span v-if="facts.singleFeedShare >= 0.0005" class="chip" title="Share of the collateral whose price depends on one feed with no fallback: if it stops, the price stops">
        <i class="dot dot--single" aria-hidden="true"></i>{{ pct(facts.singleFeedShare, 0) }} single feed
      </span>
      <span v-if="facts.fixedPriceShare >= 0.0005" class="chip" title="Share of the collateral priced at a fixed value that does not follow the market">
        <i class="dot dot--fixed" aria-hidden="true"></i>{{ pct(facts.fixedPriceShare, 0) }} fixed price
      </span>
      <span v-if="facts.marketHoursShare >= 0.0005" class="ax-badge ax-badge--pill ax-badge--outline ax-badge--neutral" title="Share of the collateral that is tokenized US stocks: their prices pause while the stock market is closed">
        {{ pct(facts.marketHoursShare, 0) }} market hours
      </span>
      <span v-if="facts.windingDownShare >= 0.0005" class="ax-badge ax-badge--pill ax-badge--outline ax-badge--neutral" title="Share of the collateral in reserves being wound down">
        {{ pct(facts.windingDownShare, 0) }} winding down
      </span>
      <span v-if="facts.criticalCount" class="ax-badge ax-badge--pill ax-badge--soft ax-badge--danger" :title="criticalTitle">
        {{ facts.criticalCount }} critical · {{ usd(facts.criticalUsd) }}<span class="ax-visually-hidden">. {{ criticalTitle }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.facts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.facts__head {
  display: flex;
  align-items: baseline;
  gap: var(--ax-space-1);
  font-size: var(--ax-text-sm);
}
.facts__usd {
  color: var(--ax-text-strong);
  font-weight: 600;
}
.facts__count {
  color: var(--ax-text-subtle);
  font-size: var(--ax-text-xs);
}
.bar {
  display: flex;
  gap: 2px;
  height: 6px;
  width: 100%;
  max-width: 260px;
  border-radius: var(--ax-radius-pill);
  overflow: hidden;
}
.bar__seg {
  flex-basis: 0;
  min-width: 2px;
}
.bar__seg--fallback,
.dot--fallback {
  background: var(--ax-accent-500);
}
.bar__seg--single,
.dot--single {
  background: var(--ax-warning-500);
}
.bar__seg--fixed,
.dot--fixed {
  background: var(--ax-neutral-400);
}
.bar__seg--rest {
  background: var(--ax-border-strong);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--ax-space-2);
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.chips .ax-badge {
  white-space: nowrap;
}
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: var(--ax-radius-pill);
}
.none {
  color: var(--ax-text-subtle);
  font-size: var(--ax-text-sm);
}
</style>
