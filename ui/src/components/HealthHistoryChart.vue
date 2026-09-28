<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ReserveSnapshot, Severity } from '@/api/client'
import { dateHour, dateTime, day, duration, SEVERITY_LABEL } from '@/lib/format'

const props = defineProps<{
  samples: ReserveSnapshot[]
  /** Start of the first hour shown. */
  from: Date
  hours: number
}>()

const HOUR_MS = 3_600_000

const SEVERITY_COLOR: Record<Severity, string> = {
  ok: 'var(--ax-viz-emerald)',
  info: 'var(--ax-viz-cyan)',
  warning: 'var(--ax-viz-amber)',
  critical: 'var(--ax-viz-red)',
}

/** One slot per hour of the range; hours with no sample (before recording started) stay empty. */
const slots = computed(() => {
  const byHour = new Map(props.samples.map((s) => [Math.floor(Date.parse(s.hour) / HOUR_MS), s]))
  const first = Math.floor(props.from.getTime() / HOUR_MS)
  return Array.from({ length: props.hours }, (_, i) => ({ hour: new Date((first + i) * HOUR_MS), sample: byHour.get(first + i) ?? null }))
})

const hoursBySeverity = computed(() => {
  const counts: Record<Severity, number> = { ok: 0, info: 0, warning: 0, critical: 0 }
  for (const s of props.samples) counts[s.severity]++
  return counts
})

const hovered = ref<number | null>(null)
const shown = computed(() => {
  if (hovered.value !== null) return slots.value[hovered.value]
  // Otherwise the latest recorded hour.
  return [...slots.value].reverse().find((s) => s.sample) ?? null
})


/** A few evenly spaced labels along the time axis. */
const ticks = computed(() => {
  const count = 5
  return Array.from({ length: count }, (_, i) => {
    const slot = slots.value[Math.round((i * (slots.value.length - 1)) / (count - 1))]
    return props.hours <= 48 ? dateHour(slot.hour) : day(slot.hour)
  })
})

const describe = (sample: ReserveSnapshot) =>
  [
    `Score ${sample.score}`,
    SEVERITY_LABEL[sample.severity],
    sample.priceAgeSeconds !== null ? `price up to ${duration(sample.priceAgeSeconds)} old` : null,
    sample.checks.length ? sample.checks.map((c) => c.code).join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ')
</script>

<template>
  <div class="chart">
    <p class="chart__summary">
      <span v-for="severity in (['critical', 'warning', 'ok'] as const)" :key="severity" class="chart__legend">
        <i :style="{ background: SEVERITY_COLOR[severity] }" />{{ SEVERITY_LABEL[severity] }} {{ hoursBySeverity[severity] }}h
      </span>
      <span class="muted">of {{ samples.length }}h recorded</span>
    </p>

    <div class="chart__plot">
      <div class="chart__y" aria-hidden="true"><span>100</span><span>50</span><span>0</span></div>
      <svg
        class="chart__svg"
        :viewBox="`0 0 ${slots.length} 100`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="`Health score per hour: ${hoursBySeverity.critical} critical, ${hoursBySeverity.warning} warning and ${hoursBySeverity.ok} healthy hours`"
        @mouseleave="hovered = null"
      >
        <line v-for="y in [0, 50]" :key="y" x1="0" :x2="slots.length" :y1="y" :y2="y" class="chart__grid" />
        <g v-for="(slot, i) in slots" :key="i" @mouseenter="hovered = i">
          <!-- Full-height hit area so thin or low bars are easy to hover. -->
          <rect :x="i" y="0" width="1" height="100" fill="transparent" />
          <rect
            v-if="slot.sample"
            :x="i + 0.1"
            :y="100 - Math.max(slot.sample.score, 3)"
            width="0.8"
            :height="Math.max(slot.sample.score, 3)"
            :fill="SEVERITY_COLOR[slot.sample.severity]"
            :opacity="hovered === null || hovered === i ? 1 : 0.45"
          />
        </g>
      </svg>
    </div>
    <div class="chart__x" aria-hidden="true">
      <span v-for="(tick, i) in ticks" :key="i">{{ tick }}</span>
    </div>

    <p class="chart__detail" aria-live="polite">
      <template v-if="shown?.sample">
        <b>{{ dateTime(shown.hour) }}</b> · {{ describe(shown.sample) }}
      </template>
      <template v-else-if="shown">{{ dateTime(shown.hour) }} · not recorded</template>
      <template v-else>No history recorded for this range yet.</template>
    </p>
  </div>
</template>

<style scoped>
.chart {
  display: grid;
  gap: var(--ax-space-2);
}
.chart__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-4);
  font-size: var(--ax-text-sm);
}
.chart__legend {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-1);
}
.chart__legend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.chart__plot {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  grid-template-rows: 180px;
  gap: var(--ax-space-2);
}
.chart__y {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
  text-align: right;
}
.chart__svg {
  display: block;
  width: 100%;
  height: 180px;
}
.chart__grid {
  stroke: var(--ax-border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 3 3;
}
.chart__x {
  display: flex;
  justify-content: space-between;
  padding-left: calc(2rem + var(--ax-space-2));
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
}
.chart__detail {
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
  min-height: 1.5em;
}
.muted {
  color: var(--ax-text-muted);
}
</style>
