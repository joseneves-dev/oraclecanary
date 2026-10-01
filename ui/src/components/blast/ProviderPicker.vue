<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { SCOPE, SWITCHBOARD, type ProviderSummary } from '@/lib/blastRadius'
import { usd } from '@/lib/format'

/**
 * Chooses the provider whose failure the page plays out. Oracles first (Switchboard pinned, as the
 * one that did fail), then Kamino's Scope aggregator, then the rates and pegs that are not oracles.
 */
const props = defineProps<{ summaries: ProviderSummary[]; selected: string | null; loading?: boolean }>()

const oracles = computed(() => {
  const list = props.summaries.filter((s) => !s.structure && s.provider !== SCOPE)
  const switchboard = list.find((s) => s.provider === SWITCHBOARD) ?? emptySummary(SWITCHBOARD)
  return [switchboard, ...list.filter((s) => s.provider !== SWITCHBOARD && s.stopsCount)]
})
/** Oracles read only with a fallback beside them: no price stops with them, so they are tucked away. */
const backedUp = computed(() => props.summaries.filter((s) => !s.structure && s.provider !== SCOPE && s.provider !== SWITCHBOARD && !s.stopsCount))
const relay = computed(() => props.summaries.filter((s) => s.provider === SCOPE))
const structure = computed(() => props.summaries.filter((s) => s.structure).sort((a, b) => b.totalUsd - a.totalUsd))

function emptySummary(provider: string): ProviderSummary {
  return { provider, structure: false, stopsUsd: 0, stopsCount: 0, keepsUsd: 0, keepsCount: 0, totalUsd: 0, count: 0 }
}

/** The chip's figure: what stops for an oracle, what uses it for a rate or peg. */
const figure = (s: ProviderSummary) => !s.count ? 'none listed' : (s.structure || !s.stopsCount ? `${usd(s.totalUsd)} in ${s.count}` : `${usd(s.stopsUsd)} in ${s.stopsCount}`)
const title = (s: ProviderSummary) =>
  s.structure
    ? `${s.count} reserves holding ${usd(s.totalUsd)} use ${s.provider}`
    : `If ${s.provider} stopped: ${usd(s.stopsUsd)} in ${s.stopsCount} reserves would have no usable price; ${usd(s.keepsUsd)} in ${s.keepsCount} more keeps one`
</script>

<template>
  <div class="picker">
    <div v-if="loading" class="picker__row" aria-hidden="true">
      <span v-for="n in 6" :key="n" class="ax-skeleton ax-skeleton--line picker__skeleton"></span>
    </div>
    <template v-else>
      <div class="picker__group" role="group" aria-labelledby="picker-oracles">
        <span id="picker-oracles" class="picker__label">Oracles</span>
        <div class="picker__row">
          <RouterLink
            v-for="s in oracles"
            :key="s.provider"
            :to="{ query: { provider: s.provider } }"
            class="chip"
            :class="{ 'chip--active': selected === s.provider, 'chip--dead': s.provider === SWITCHBOARD }"
            :aria-current="selected === s.provider ? 'true' : undefined"
            :title="title(s)"
          >
            <span class="chip__name">{{ s.provider }}</span>
            <span v-if="s.provider === SWITCHBOARD" class="chip__tag">shut down</span>
            <span class="chip__figure ax-num">{{ figure(s) }}</span>
          </RouterLink>
        </div>
      </div>
      <div v-if="relay.length" class="picker__group" role="group" aria-labelledby="picker-relay">
        <span id="picker-relay" class="picker__label">Aggregator</span>
        <div class="picker__row">
          <RouterLink
            v-for="s in relay"
            :key="s.provider"
            :to="{ query: { provider: s.provider } }"
            class="chip"
            :class="{ 'chip--active': selected === s.provider }"
            :aria-current="selected === s.provider ? 'true' : undefined"
            :title="title(s)"
          >
            <span class="chip__name">{{ s.provider }}</span>
            <span class="chip__figure ax-num">{{ figure(s) }}</span>
          </RouterLink>
        </div>
      </div>
      <details v-if="backedUp.length" class="picker__group picker__more" :open="backedUp.some((s) => s.provider === selected)">
        <summary class="picker__label picker__summary">Not relied on alone ({{ backedUp.length }})</summary>
        <div class="picker__row">
          <RouterLink
            v-for="s in backedUp"
            :key="s.provider"
            :to="{ query: { provider: s.provider } }"
            class="chip chip--quiet"
            :class="{ 'chip--active': selected === s.provider }"
            :aria-current="selected === s.provider ? 'true' : undefined"
            :title="title(s)"
          >
            <span class="chip__name">{{ s.provider }}</span>
            <span class="chip__figure ax-num">{{ figure(s) }}</span>
          </RouterLink>
        </div>
      </details>
      <details v-if="structure.length" class="picker__group picker__more" :open="structure.some((s) => s.provider === selected)">
        <summary class="picker__label picker__summary">Rates and pegs, not oracles ({{ structure.length }})</summary>
        <div class="picker__row">
          <RouterLink
            v-for="s in structure"
            :key="s.provider"
            :to="{ query: { provider: s.provider } }"
            class="chip chip--quiet"
            :class="{ 'chip--active': selected === s.provider }"
            :aria-current="selected === s.provider ? 'true' : undefined"
            :title="title(s)"
          >
            <span class="chip__name">{{ s.provider }}</span>
            <span class="chip__figure ax-num">{{ figure(s) }}</span>
          </RouterLink>
        </div>
      </details>
      <p class="picker__note">Figures: the deposits whose price would stop with it, and in how many reserves; for the rest, the deposits that read it.</p>
    </template>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-3);
}
.picker__group {
  display: grid;
  grid-template-columns: 7.5rem minmax(0, 1fr);
  gap: var(--ax-space-3);
  align-items: start;
}
.picker__label {
  padding-top: 6px;
  font-size: var(--ax-text-xs);
  font-weight: var(--ax-weight-semibold);
  color: var(--ax-text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.picker__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-2);
}
.picker__more {
  display: block;
}
.picker__more .picker__row {
  margin-top: var(--ax-space-2);
}
.picker__summary {
  cursor: pointer;
  padding-top: 0;
  width: max-content;
}
.picker__summary:hover {
  color: var(--ax-text-strong);
}
.picker__note {
  margin: 0;
  font-size: var(--ax-text-xs);
  color: var(--ax-text-subtle);
}
.picker__skeleton {
  width: 7rem;
  height: 30px;
  border-radius: 999px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid var(--ax-border);
  border-radius: 999px;
  background: var(--ax-surface-solid);
  color: var(--ax-text);
  font-size: var(--ax-text-sm);
  text-decoration: none;
  white-space: nowrap;
  transition: border-color 0.15s, background-color 0.15s;
}
.chip:hover {
  border-color: var(--ax-border-strong);
}
.chip:focus-visible {
  outline: 2px solid var(--ax-focus-ring, var(--ax-accent));
  outline-offset: 2px;
}
.chip__name {
  font-weight: var(--ax-weight-semibold);
  color: var(--ax-text-strong);
}
.chip__figure {
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.chip__tag {
  font-size: var(--ax-text-2xs, 0.6875rem);
  font-weight: var(--ax-weight-semibold);
  color: var(--ax-sev-crit-text);
  background: var(--ax-sev-crit-wash);
  border-radius: 999px;
  padding: 1px 6px;
}
.chip--quiet .chip__name {
  font-weight: var(--ax-weight-medium, 500);
  color: var(--ax-text);
}
.chip--active {
  border-color: var(--ax-accent);
  background: var(--ax-accent-wash);
}
.chip--active .chip__name,
.chip--active .chip__figure {
  color: var(--ax-accent-text);
}

@media (max-width: 576px) {
  .picker__group {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ax-space-2);
  }
  .picker__label {
    padding-top: 0;
  }
}
</style>
