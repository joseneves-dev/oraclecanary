<script setup lang="ts">
/*
 * The reserve field: one mark per listed reserve, grouped by protocol, like a seismograph trace.
 * Height is the reserve's deposits on a log scale, colour its worst failing check. A lamp sweeps
 * across and briefly lights the marks; critical reserves pulse. Hover or tap for details; click
 * (or tap twice) to open the reserve.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Reserve, Severity } from '@/api/client'
import { checkLabel, fmtInt, fmtSeconds, fmtUsd, protocolName, SEVERITIES, SEVERITY_LABEL } from '@/composables/useLanding'

interface Lane {
  id: string
  name: string
  rows: Reserve[] | null
  count: number | null
  usd: number | null
}

const props = defineProps<{
  lanes: Lane[]
  bySeverity: Record<Severity, number> | null
  failed: boolean
}>()
const emit = defineEmits<{ retry: [] }>()
const router = useRouter()

const ready = computed(() => props.lanes.every((l) => l.rows))

/** Worst first, so each protocol reads as bands of colour. */
const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 }

/** Height: deposits on a log scale from $1K (floor) to $10B, as a share of the lane. */
function height(usd: number): number {
  const t = Math.log10(Math.max(usd, 1e3) / 1e3) / 7
  return 4 + 92 * Math.min(1, Math.max(0, t))
}

interface Mark {
  r: Reserve
  i: number
  y: number
  h: number
}

const segments = computed(() =>
  props.lanes.map((l) => {
    const rows = [...(l.rows ?? [])].sort(
      (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (b.totalSupplyUsd ?? 0) - (a.totalSupplyUsd ?? 0),
    )
    const marks: Mark[] = rows.map((r, i) => {
      const h = height(r.totalSupplyUsd ?? 0)
      return { r, i, h, y: 50 - h / 2 }
    })
    const critical = marks.filter((m) => m.r.severity === 'critical').length
    return { ...l, marks, critical, n: Math.max(1, marks.length) }
  }),
)

/** Faint stand-in bars while the reserves load. */
const placeholder = Array.from({ length: 64 }, (_, i) => {
  const h = 18 + 50 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.37))
  return { i, h, y: 50 - h / 2 }
})

/* ── hover / tap ─────────────────────────────────────────────────── */
const hover = ref<{ seg: number; idx: number; x: number; y: number; touch: boolean } | null>(null)
const hovered = computed(() => {
  const h = hover.value
  return h ? (segments.value[h.seg]?.marks[h.idx]?.r ?? null) : null
})

// A shown tooltip is fixed to the viewport: drop it on scroll, or on a tap outside the field.
const strip = ref<HTMLElement | null>(null)
function dismiss(e: Event) {
  if (!hover.value) return
  if (e.type === 'pointerdown' && strip.value?.contains(e.target as Node)) return
  hover.value = null
}
onMounted(() => {
  window.addEventListener('scroll', dismiss, { passive: true })
  document.addEventListener('pointerdown', dismiss)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', dismiss)
  document.removeEventListener('pointerdown', dismiss)
})

function pick(e: PointerEvent, seg: number): number | null {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const n = segments.value[seg]?.marks.length ?? 0
  if (!n) return null
  const idx = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n)))
  hover.value = {
    seg,
    idx,
    x: Math.min(window.innerWidth - 150, Math.max(150, rect.left + ((idx + 0.5) / n) * rect.width)),
    y: rect.top,
    touch: e.pointerType !== 'mouse',
  }
  return idx
}

function onMove(e: PointerEvent, seg: number) {
  if (e.pointerType === 'mouse') pick(e, seg)
}

function onDown(e: PointerEvent, seg: number) {
  if (e.pointerType === 'mouse') return
  const before = hover.value
  const idx = pick(e, seg)
  // Touch: the first tap shows the details, a second tap on the same mark opens it.
  if (idx != null && before && before.seg === seg && before.idx === idx) open(segments.value[seg]!.marks[idx]!.r)
}

function onClick(e: MouseEvent, seg: number) {
  if ((e as PointerEvent).pointerType && (e as PointerEvent).pointerType !== 'mouse') return
  const h = hover.value
  if (h && h.seg === seg) open(segments.value[seg]!.marks[h.idx]!.r)
}

function open(r: Reserve) {
  void router.push({ name: 'reserve', params: { address: r.address } })
}

function worstCheck(r: Reserve): string | null {
  const order: Record<string, number> = { critical: 3, warning: 2, info: 1 }
  const c = [...r.checks].sort((a, b) => (order[b.severity] ?? 0) - (order[a.severity] ?? 0))[0]
  return c ? checkLabel(c.code) : null
}
</script>

<template>
  <section class="field" aria-labelledby="field-title">
    <slot />
    <header class="field__head">
      <div class="field__title">
        <span class="lp-kicker" id="field-title">Reserve field</span>
        <span class="field__sub">One mark per listed reserve · height = deposits (log) · colour = price health</span>
      </div>
      <ul class="field__legend" aria-label="Reserves by price health">
        <li v-for="s in SEVERITIES" :key="s" :class="`sev-${s}`">
          <i class="dot" aria-hidden="true" />{{ SEVERITY_LABEL[s] }}
          <b class="lp-num">{{ bySeverity ? fmtInt(bySeverity[s]) : '—' }}</b>
        </li>
      </ul>
    </header>

    <div class="field__strip" :class="{ 'is-loading': !ready, 'is-failed': failed && !ready }" ref="strip" @pointerleave="(e: PointerEvent) => { if (e.pointerType === 'mouse') hover = null }">
      <!-- base layer -->
      <div class="field__layer">
        <div v-for="(s, si) in segments" :key="s.id" class="seg" :style="{ '--n': s.n }">
          <div class="seg__label">
            <span class="seg__name">{{ s.name }}</span>
            <span class="seg__meta lp-num">{{ fmtInt(s.count) }} · {{ fmtUsd(s.usd) }}</span>
          </div>
          <div
            class="seg__plot"
            @pointermove="onMove($event, si)"
            @pointerdown="onDown($event, si)"
            @click="onClick($event, si)"
          >
            <svg v-if="ready" :viewBox="`0 0 ${s.n} 100`" preserveAspectRatio="none" role="img" :aria-label="`${s.name}: ${s.marks.length} reserves`">
              <line x1="0" x2="100%" y1="50" y2="50" class="axis" vector-effect="non-scaling-stroke" />
              <rect
                v-if="hover && hover.seg === si"
                :x="hover.idx"
                y="0"
                width="1"
                height="100"
                class="hover-col"
              />
              <rect
                v-for="m in s.marks.filter((m) => m.r.severity === 'critical')"
                :key="'c' + m.r.address"
                :x="m.i - 0.6"
                y="0"
                width="2.2"
                height="100"
                class="crit-col"
              />
              <rect
                v-for="m in s.marks"
                :key="m.r.address"
                :x="m.i + 0.16"
                :y="m.y"
                width="0.68"
                :height="m.h"
                rx="0.3"
                :class="['bar', `sev-${m.r.severity}`, { 'is-hover': hover && hover.seg === si && hover.idx === m.i }]"
              />
            </svg>
            <svg v-else viewBox="0 0 64 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2="64" y1="50" y2="50" class="axis" vector-effect="non-scaling-stroke" />
              <rect v-for="p in placeholder" :key="p.i" :x="p.i + 0.2" :y="p.y" width="0.6" :height="p.h" rx="0.3" class="ph-bar" />
            </svg>
          </div>
        </div>
      </div>

      <!-- the lamp: a brighter copy of the marks, revealed where the scan line passes -->
      <div class="field__layer field__layer--lit" aria-hidden="true">
        <div v-for="s in segments" :key="s.id" class="seg" :style="{ '--n': s.n }">
          <div class="seg__label" style="visibility: hidden">
            <span class="seg__name">{{ s.name }}</span><span class="seg__meta">&nbsp;</span>
          </div>
          <div class="seg__plot">
            <svg v-if="ready" :viewBox="`0 0 ${s.n} 100`" preserveAspectRatio="none">
              <rect v-for="m in s.marks" :key="m.r.address" :x="m.i + 0.16" :y="m.y" width="0.68" :height="m.h" rx="0.3" :class="['bar', `sev-${m.r.severity}`]" />
            </svg>
            <svg v-else viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="0" x2="100" y1="50" y2="50" class="axis axis--lit" vector-effect="non-scaling-stroke" />
            </svg>
          </div>
        </div>
      </div>
      <div class="field__scan" aria-hidden="true" />

      <!-- critical reserves: one pulsing tag per lane over its red band, keyboard reachable -->
      <div class="field__beacons">
        <div v-for="s in segments" :key="s.id" class="seg" :style="{ '--n': s.n }">
          <div class="seg__label" style="visibility: hidden" aria-hidden="true">
            <span class="seg__name">{{ s.name }}</span><span class="seg__meta">&nbsp;</span>
          </div>
          <div class="seg__plot seg__plot--beacons">
            <RouterLink
              v-if="s.critical"
              class="beacon"
              :to="{ name: 'reserves', query: { health: 'critical', protocol: s.id } }"
              :aria-label="`${s.critical} critical ${s.critical === 1 ? 'reserve' : 'reserves'} on ${s.name}`"
            >
              <i aria-hidden="true" />{{ s.critical }} critical
            </RouterLink>
          </div>
        </div>
      </div>

      <p v-if="failed && !ready" class="field__state">
        Could not read the reserves right now.
        <button type="button" class="lp-link" @click="emit('retry')">Try again</button>
      </p>
      <p v-else-if="!ready" class="field__state lp-num">Reading the chain…</p>
    </div>

    <footer class="field__foot">
      <span class="field__hint">
        <span class="only-fine">Hover a mark for its price health, click to open it.</span>
        <span class="only-coarse">Tap a mark for its price health, tap again to open it.</span>
      </span>
      <RouterLink :to="{ name: 'reserves' }" class="lp-link">All reserves →</RouterLink>
    </footer>

    <Teleport to="body">
      <div
        v-if="hover && hovered"
        class="lp-tip"
        :class="`sev-${hovered.severity}`"
        :style="{ left: `${hover.x}px`, top: `${hover.y}px` }"
        role="tooltip"
      >
        <div class="lp-tip__row">
          <b class="lp-tip__asset">{{ hovered.asset }}</b>
          <span class="lp-tip__score lp-num"><i class="lp-tip__dot" />{{ hovered.score }}<small>/100</small></span>
        </div>
        <div class="lp-tip__meta">{{ protocolName(hovered.protocol) }}<template v-if="hovered.market?.name"> · {{ hovered.market.name }}</template></div>
        <dl class="lp-tip__grid lp-num">
          <dt>Price age</dt>
          <dd>{{ fmtSeconds(hovered.price?.ageSeconds) }}<template v-if="hovered.price?.maxAgeSeconds"> / {{ fmtSeconds(hovered.price.maxAgeSeconds) }}</template></dd>
          <dt>Deposits</dt>
          <dd>{{ fmtUsd(hovered.totalSupplyUsd) }}</dd>
          <dt>Worst check</dt>
          <dd>{{ worstCheck(hovered) ?? 'None failing' }}</dd>
        </dl>
        <p class="lp-tip__hint">{{ hover.touch ? 'Tap again to open' : 'Click to open' }} →</p>
      </div>
    </Teleport>
  </section>
</template>

<style>
@property --lp-scan {
  syntax: '<percentage>';
  inherits: true;
  initial-value: -20%;
}
@keyframes lp-scan {
  0% {
    --lp-scan: -12%;
  }
  78%,
  100% {
    --lp-scan: 112%;
  }
}
.lp-tip {
  position: fixed;
  z-index: 100;
  transform: translate(-50%, calc(-100% - 10px));
  min-width: 220px;
  max-width: 280px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--lp-tip-bg, #16140f);
  color: var(--lp-tip-ink, #f5f1e6);
  border: 1px solid rgba(255, 240, 200, 0.14);
  box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.55);
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 13px;
  pointer-events: none;
}
.lp-tip__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.lp-tip__asset {
  color: #fff8e6;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 16px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-tip__score {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--ax-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  font-weight: 600;
}
.lp-tip__score small {
  opacity: 0.55;
  font-weight: 500;
}
.lp-tip__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sev, #4ade80);
}
.lp-tip.sev-ok {
  --sev: #4ade80;
}
.lp-tip.sev-info {
  --sev: #8fb3d9;
}
.lp-tip.sev-warning {
  --sev: #fb923c;
}
.lp-tip.sev-critical {
  --sev: #f87171;
}
.lp-tip__meta {
  color: rgba(245, 241, 230, 0.6);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-tip__grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 240, 200, 0.1);
  font-family: var(--ax-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  font-size: 12px;
}
.lp-tip__hint {
  margin: 10px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: #fde047;
}
.lp-tip__grid dt {
  color: rgba(245, 241, 230, 0.5);
}
.lp-tip__grid dd {
  margin: 0;
  text-align: end;
}
</style>

<style scoped>
.field {
  position: relative;
  border: 1px solid var(--lp-line);
  border-radius: 20px;
  background: var(--lp-panel);
  box-shadow: var(--lp-panel-shadow);
  padding: 20px 24px 16px;
  overflow: hidden;
}
.field::before {
  /* instrument grid */
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--lp-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--lp-grid) 1px, transparent 1px);
  background-size: 100% 24px, 24px 100%;
  mask-image: linear-gradient(180deg, transparent, #000 25%, #000 75%, transparent);
  pointer-events: none;
}
.field > * {
  position: relative;
}
.field__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 24px;
  margin-bottom: 18px;
}
.field__title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field__sub {
  color: var(--lp-ink-3);
  font-size: 13px;
}
.field__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
  color: var(--lp-ink-2);
}
.field__legend li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.field__legend b {
  color: var(--lp-ink);
  font-weight: 600;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--c);
}
.sev-ok {
  --c: var(--lp-ok);
}
.sev-info {
  --c: var(--lp-info);
}
.sev-warning {
  --c: var(--lp-warn);
}
.sev-critical {
  --c: var(--lp-crit);
}

/* strip */
.field__strip {
  position: relative;
  animation: lp-scan 9s linear infinite;
}
.field__layer {
  display: flex;
  gap: 18px;
}
.field__layer--lit,
.field__beacons {
  position: absolute;
  inset: 0;
  display: flex;
  gap: 18px;
  pointer-events: none;
}
.field__layer--lit {
  -webkit-mask-image: linear-gradient(
    90deg,
    transparent calc(var(--lp-scan) - 16%),
    rgba(0, 0, 0, 0.35) calc(var(--lp-scan) - 6%),
    #000 var(--lp-scan),
    transparent calc(var(--lp-scan) + 0.4%)
  );
  mask-image: linear-gradient(
    90deg,
    transparent calc(var(--lp-scan) - 16%),
    rgba(0, 0, 0, 0.35) calc(var(--lp-scan) - 6%),
    #000 var(--lp-scan),
    transparent calc(var(--lp-scan) + 0.4%)
  );
}
.field__scan {
  position: absolute;
  top: -6px;
  bottom: 22px;
  left: var(--lp-scan);
  width: 1px;
  background: linear-gradient(180deg, transparent, var(--lp-accent) 20%, var(--lp-accent) 80%, transparent);
  box-shadow: 0 0 14px 2px var(--lp-accent-glow);
  pointer-events: none;
}
.seg {
  flex: var(--n) 1 0;
  min-width: 22%;
  display: flex;
  flex-direction: column-reverse;
  gap: 10px;
}
.seg__plot {
  position: relative;
  height: 170px;
  cursor: crosshair;
  touch-action: pan-y;
}
.seg__plot svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.seg__label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0 8px;
  padding-top: 8px;
  border-top: 1px solid var(--lp-line-strong);
  font-size: 13px;
  white-space: nowrap;
}
.seg__name {
  color: var(--lp-ink);
  font-weight: 600;
}
.seg__meta {
  color: var(--lp-ink-3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.axis {
  stroke: var(--lp-line-strong);
  stroke-width: 1;
}
.axis--lit {
  stroke: var(--lp-accent);
  stroke-width: 2;
}
.crit-col {
  fill: var(--lp-crit);
  opacity: 0.14;
}
.hover-col {
  fill: var(--lp-fill-strong);
}

.bar {
  fill: var(--c);
  opacity: 0.42;
  transition: opacity 0.2s;
}
.bar.sev-ok {
  opacity: var(--lp-bar-ok, 0.3);
}
.bar.sev-warning,
.bar.sev-info {
  opacity: var(--lp-bar-warn, 0.5);
}
.bar.sev-critical {
  opacity: 1;
  animation: lp-pulse 1.6s ease-in-out infinite;
}
.bar.is-hover {
  opacity: 1;
  fill: var(--lp-ink);
  animation: none;
}
.field__layer--lit .bar {
  opacity: 1;
  animation: none;
}
.field__layer--lit .bar.sev-ok {
  fill: var(--lp-accent);
}
.field__layer--lit .bar.sev-info {
  fill: var(--lp-accent);
}

.seg__plot--beacons {
  cursor: default;
}
.beacon {
  position: absolute;
  top: -14px;
  left: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 7px;
  border-radius: 999px;
  background: var(--lp-panel);
  border: 1px solid color-mix(in srgb, var(--lp-crit) 55%, transparent);
  color: var(--lp-crit-text);
  font: 600 11.5px/1.2 var(--lp-mono);
  white-space: nowrap;
  text-decoration: none;
  pointer-events: auto;
  z-index: 2;
}
.beacon i {
  position: relative;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--lp-crit);
}
.beacon i::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid var(--lp-crit);
  animation: lp-ring 1.8s ease-out infinite;
}
.beacon:hover {
  border-color: var(--lp-crit);
}
.beacon:focus-visible {
  outline: 2px solid var(--lp-focus);
  outline-offset: 3px;
}
.ph-bar {
  fill: var(--lp-line-strong);
  animation: lp-ph 1.6s ease-in-out infinite;
}
.is-failed .ph-bar {
  opacity: 0.3;
  animation: none;
}
.is-failed .field__layer--lit,
.is-failed .field__scan {
  display: none;
}
@keyframes lp-ph {
  50% {
    opacity: 0.4;
  }
}

.field__state {
  position: absolute;
  top: 58px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--lp-panel);
  border: 1px solid var(--lp-line);
  color: var(--lp-ink-2);
  font-size: 13px;
  white-space: nowrap;
}
.field__foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--lp-ink-3);
}
.only-coarse {
  display: none;
}
@media (hover: none) {
  .only-fine {
    display: none;
  }
  .only-coarse {
    display: inline;
  }
}

@keyframes lp-pulse {
  50% {
    opacity: 0.45;
  }
}
@keyframes lp-ring {
  from {
    transform: scale(0.6);
    opacity: 1;
  }
  to {
    transform: scale(2.4);
    opacity: 0;
  }
}

@media (max-width: 760px) {
  .field {
    padding: 16px 14px 14px;
    border-radius: 16px;
  }
  .field__layer,
  .field__layer--lit,
  .field__beacons {
    flex-direction: column;
    gap: 14px;
  }
  .seg {
    flex: none;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
  }
  .seg__label {
    border-top: 0;
    padding-top: 0;
  }
  .seg__plot {
    height: 72px;
  }
  .beacon {
    top: -24px;
    left: 50%;
    transform: translateX(-50%);
  }
  .field__scan {
    top: 0;
    bottom: 0;
  }
  .field__foot {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .field__strip {
    animation: none;
  }
  .field__layer--lit,
  .field__scan {
    display: none;
  }
  .bar.sev-critical,
  .beacon i::after,
  .ph-bar {
    animation: none;
  }
}
</style>
