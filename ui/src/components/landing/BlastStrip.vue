<script setup lang="ts">
/* "What if <provider> went down?": the live figure from lib/blastRadius, linking to the app's page. */
import { RouterLink } from 'vue-router'
import { fmtInt, fmtUsd } from '@/composables/useLanding'

defineProps<{
  blast: { provider: string; stopsUsd: number; stopsCount: number } | null
}>()

/** Display names for the oracle products the API lists by type. */
const NAMES: Record<string, string> = {
  PythLazer: 'Pyth Lazer',
  ChainlinkDataStreams: 'Chainlink Data Streams',
  ChainlinkNAV: 'Chainlink NAV',
  ChainlinkRWA: 'Chainlink RWA',
  ChainlinkExchangeRate: 'Chainlink exchange rate',
}
const name = (p: string) => NAMES[p] ?? p
</script>

<template>
  <div class="blast">
    <svg class="blast__glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="24" cy="24" r="5" />
      <path d="M24 19 V8 M24 29 V40 M19 24 H8 M29 24 H40" class="blast__wires" />
      <circle cx="24" cy="6" r="2.5" /><circle cx="24" cy="42" r="2.5" /><circle cx="6" cy="24" r="2.5" /><circle cx="42" cy="24" r="2.5" />
      <path d="M15 15 L33 33" class="blast__cut" />
    </svg>
    <div class="blast__text">
      <span class="blast__kicker">If an oracle fails</span>
      <p v-if="blast" class="blast__line">
        What if {{ name(blast.provider) }} went down?
        <b class="num">{{ fmtUsd(blast.stopsUsd) }}</b> across <b class="num">{{ fmtInt(blast.stopsCount) }}</b>
        {{ blast.stopsCount === 1 ? 'reserve' : 'reserves' }} would have no usable price.
      </p>
      <p v-else class="blast__line">What if one oracle provider went down? See which reserves would have no usable price.</p>
    </div>
    <RouterLink
      :to="blast ? { name: 'blast-radius', query: { provider: blast.provider } } : { name: 'blast-radius' }"
      class="lp-btn lp-btn--ghost blast__cta"
    >
      Play it out <span aria-hidden="true">→</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.blast {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  margin-top: 16px;
  padding: 18px 22px;
  border: 1px solid var(--lp-line);
  border-radius: 18px;
  background: var(--lp-panel);
}
.blast__glyph {
  width: 44px;
  height: 44px;
  color: var(--lp-ink-3);
}
.blast__cut {
  stroke: var(--lp-crit);
  stroke-width: 2.2;
}
.blast__text {
  min-width: 0;
}
.blast__kicker {
  display: block;
  margin-bottom: 4px;
  font-family: var(--lp-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--lp-ink-3);
}
.blast__line {
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
  color: var(--lp-ink-2);
}
.blast__line b {
  color: var(--lp-ink);
  font-weight: 600;
}
.num {
  font-family: var(--lp-mono);
  font-variant-numeric: tabular-nums;
}
.blast__cta {
  height: 42px;
  padding-inline: 18px;
}
@media (max-width: 640px) {
  .blast {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px 16px;
    padding: 16px;
  }
  .blast__glyph {
    width: 36px;
    height: 36px;
    align-self: start;
  }
  .blast__cta {
    grid-column: 1 / -1;
    width: 100%;
  }
  .blast__line {
    font-size: 15px;
  }
}
</style>
