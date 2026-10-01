<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ReserveSnapshot } from '@/api/client'
import { dateHour, dateTime, day, duration } from '@/lib/format'

/**
 * How old the reserve's price was, hour by hour, against the protocol's limit. A price past the
 * limit is one the protocol rejects: that is the moment the reserve stops working.
 */
const props = defineProps<{
  samples: ReserveSnapshot[]
  from: Date
  hours: number
  /** The protocol's limit on the price's age, in seconds. */
  maxAgeSeconds: number
}>()

const HOUR_MS = 3_600_000
/** Ages range from seconds to weeks; above this multiple of the limit, bars are cut and marked. */
const SCALE_LIMITS = 3
const ceiling = computed(() => props.maxAgeSeconds * SCALE_LIMITS)
const limitY = computed(() => 100 - 100 / SCALE_LIMITS)

const slots = computed(() => {
  const byHour = new Map(props.samples.map((s) => [Math.floor(Date.parse(s.hour) / HOUR_MS), s]))
  const first = Math.floor(props.from.getTime() / HOUR_MS)
  return Array.from({ length: props.hours }, (_, i) => ({ hour: new Date((first + i) * HOUR_MS), sample: byHour.get(first + i) ?? null }))
})

/**
 * Coloured from the checks recorded that hour, not from the age alone: a fixed price reports an age
 * but never goes stale, so it is never shown as rejected.
 */
const isStale = (s: ReserveSnapshot) => s.checks.some((c) => c.code === 'STALE')
const color = (s: ReserveSnapshot) =>
  isStale(s) ? 'var(--ax-viz-red)' : s.checks.some((c) => c.code === 'NEAR_STALE') ? 'var(--ax-viz-amber)' : 'var(--ax-viz-emerald)'

const hoursPastLimit = computed(() => props.samples.filter(isStale).length)
const withAge = computed(() => props.samples.filter((s) => s.priceAgeSeconds !== null).length)

/** Hours of the range with no record (before recording began, or missed). */
const notRecorded = computed(() => slots.value.filter((s) => !s.sample).length)

const hovered = ref<number | null>(null)
const shown = computed(() => (hovered.value !== null ? slots.value[hovered.value] : ([...slots.value].reverse().find((s) => s.sample) ?? null)))

const ticks = computed(() => {
  const count = 5
  return Array.from({ length: count }, (_, i) => {
    const slot = slots.value[Math.round((i * (slots.value.length - 1)) / (count - 1))]
    return props.hours <= 48 ? dateHour(slot.hour) : day(slot.hour)
  })
})
</script>

<template>
  <div class="chart">
    <p class="chart__summary">
      <span class="chart__legend"><i style="background: var(--ax-viz-red)" />Past the limit {{ hoursPastLimit }}h</span>
      <span class="chart__legend"><i class="chart__dash" />Limit: {{ duration(maxAgeSeconds) }}</span>
      <span v-if="notRecorded" class="chart__legend muted"><i class="chart__gap-swatch" />{{ notRecorded }}h not recorded</span>
      <span class="muted">Sampled hourly: the oldest price seen in each hour; the limit shown is today's</span>
    </p>
    <div class="chart__plot">
      <div class="chart__y" aria-hidden="true">
        <span>≥{{ duration(ceiling) }}</span><span>{{ duration(maxAgeSeconds) }}</span><span>0</span>
      </div>
      <svg
        class="chart__svg"
        :viewBox="`0 0 ${slots.length} 100`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="`Price age per hour: past the ${duration(maxAgeSeconds)} limit in ${hoursPastLimit} of ${withAge} recorded hours`"
        @mouseleave="hovered = null"
      >
        <line x1="0" :x2="slots.length" :y1="limitY" :y2="limitY" class="chart__limit" />
        <g v-for="(slot, i) in slots" :key="i" @mouseenter="hovered = i">
          <rect :x="i" y="0" width="1" height="100" fill="transparent" />
          <rect
            class="ax-chart-bar"
            v-if="slot.sample && slot.sample.priceAgeSeconds !== null"
            :x="i + 0.1"
            :y="100 - Math.max(2, Math.min(100, (slot.sample.priceAgeSeconds / ceiling) * 100))"
            width="0.8"
            :height="Math.max(2, Math.min(100, (slot.sample.priceAgeSeconds / ceiling) * 100))"
            :fill="color(slot.sample)"
            :opacity="hovered === null || hovered === i ? 1 : 0.45"
          />
          <rect v-else-if="!slot.sample" class="chart__gap" :x="i + 0.1" y="98" width="0.8" height="2"><title>Not recorded</title></rect>
        </g>
      </svg>
    </div>
    <div class="chart__x ax-chart-axis" aria-hidden="true">
      <span v-for="(tick, i) in ticks" :key="i">{{ tick }}</span>
    </div>
    <p class="chart__detail" aria-live="polite">
      <template v-if="shown?.sample && shown.sample.priceAgeSeconds !== null">
        <b>{{ dateTime(shown.hour) }}</b> · price up to {{ duration(shown.sample.priceAgeSeconds) }} old
        {{ isStale(shown.sample) ? '· past the limit: the protocol rejects it' : '' }}
      </template>
      <template v-else-if="shown">{{ dateTime(shown.hour) }} · not recorded</template>
      <template v-else>No price age recorded for this range yet.</template>
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
.chart__legend .chart__dash {
  height: 0;
  width: 14px;
  border-top: 2px dashed var(--ax-text-muted);
  border-radius: 0;
}
.chart__plot {
  display: grid;
  grid-template-columns: 3.5rem minmax(0, 1fr);
  grid-template-rows: 140px;
  gap: var(--ax-space-2);
}
.chart__y {
  position: relative;
  font-size: var(--ax-text-xs);
  color: var(--ax-text-muted);
  text-align: right;
}
.chart__y span {
  position: absolute;
  right: 0;
  line-height: 1;
}
.chart__y span:nth-child(1) {
  top: 0;
}
/* At the dashed line: the limit is a third of the scale. */
.chart__y span:nth-child(2) {
  top: calc(100% * 2 / 3);
  transform: translateY(-50%);
}
.chart__y span:nth-child(3) {
  bottom: 0;
}
.chart__svg {
  display: block;
  width: 100%;
  height: 140px;
}
/* Hours with no record: a faint baseline stub, so a gap reads as "not recorded" rather than as nothing. */
.chart__gap {
  fill: var(--ax-text-subtle);
  fill-opacity: 0.35;
}
.chart__legend .chart__gap-swatch {
  height: 3px;
  align-self: center;
  background: repeating-linear-gradient(90deg, var(--ax-text-subtle) 0 2px, transparent 2px 4px);
  opacity: 0.7;
}
.chart__limit {
  stroke: var(--ax-text-muted);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 5 4;
}
.chart__x {
  display: flex;
  justify-content: space-between;
  padding-left: calc(3.5rem + var(--ax-space-2));
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
