<script setup lang="ts">
/* How it works in three steps, each with a small diagram drawn from live data. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Reserve, ReserveIncident } from '@/api/client'
import { healthState, type HealthState } from '@/lib/priceState'
import { checkLabel, fmtAgo, fmtInt, fmtUsd, protocolName } from '@/composables/useLanding'

const props = defineProps<{
  lanes: { id: string; name: string; count: number | null }[]
  reserves: Reserve[] | null
  incidents: ReserveIncident[] | null
  lastChecked: number | null
  now: number
}>()

/** Scores in ten bins (0–9 … 90–100), each split by severity. */
const SEV: HealthState[] = ['critical', 'paused', 'warning', 'info', 'ok']
type Bin = Record<HealthState, number> & { total: number }
const bins = computed(() => {
  if (!props.reserves) return null
  const out: Bin[] = Array.from({ length: 10 }, () => ({ critical: 0, paused: 0, warning: 0, info: 0, ok: 0, total: 0 }))
  for (const r of props.reserves) {
    const b = out[Math.min(9, Math.floor(r.score / 10))]!
    b[healthState(r)]++
    b.total++
  }
  return out
})
/** Square-root scale, so the few low scores stay visible next to the many healthy ones. */
const maxRoot = computed(() => Math.sqrt(Math.max(1, ...(bins.value ?? []).map((b) => b.total))))
function segs(b: Bin) {
  const h = b.total ? 6 + 70 * (Math.sqrt(b.total) / maxRoot.value) : 0
  let y = 96
  return SEV.filter((s) => b[s] > 0).map((s) => {
    const sh = (b[s] / b.total) * h
    y -= sh
    return { s, y, h: sh }
  })
}

/** The latest real break; a market-hours pause only if nothing else is in the log. */
const latest = computed(() => {
  const list = props.incidents ?? []
  return list.find((i) => !i.checks.some((c) => c.code === 'MARKET_CLOSED')) ?? list[0] ?? null
})
const latestPaused = computed(() => !!latest.value?.checks.some((c) => c.code === 'MARKET_CLOSED'))
const latestWhy = computed(() => {
  const i = latest.value
  if (!i) return ''
  if (latestPaused.value) return 'paused, market closed'
  return [...new Set(i.checks.filter((c) => c.severity === 'critical').map((c) => checkLabel(c.code)))].join(', ')
})
</script>

<template>
  <section id="how" class="lp-section" aria-labelledby="how-title">
    <div class="lp-wrap">
      <div class="lp-head">
        <span class="lp-kicker">How it works</span>
        <h2 id="how-title" class="lp-h2">From a price account on-chain to a message on your phone.</h2>
      </div>

      <ol class="steps">
        <!-- 01 -->
        <li class="step">
          <span class="step__no lp-num" aria-hidden="true">01</span>
          <h3 class="step__title">Read the chain</h3>
          <p class="step__body">
            Every five minutes, OracleCanary reads from Solana mainnet the oracle configuration and price accounts behind every listed reserve.
          </p>
          <div class="viz" aria-hidden="true">
            <svg viewBox="0 0 300 132" fill="none">
              <g v-for="(l, k) in lanes" :key="l.id">
                <text x="8" :y="30 + k * 38" class="v-label">{{ l.name }}</text>
                <text x="8" :y="44 + k * 38" class="v-num">{{ fmtInt(l.count) }} reserves</text>
                <path :d="`M120 ${34 + k * 38} C 170 ${34 + k * 38}, 190 66, 236 66`" class="v-wire" />
                <circle r="3" class="v-pulse" :style="{ offsetPath: `path('M120 ${34 + k * 38} C 170 ${34 + k * 38}, 190 66, 236 66')`, animationDelay: `${k * 0.5}s` }" />
              </g>
              <circle cx="252" cy="66" r="16" class="v-node" />
              <g transform="translate(241 55) scale(0.7)">
                <path d="M4 4 H16 A12 12 0 0 1 28 16 V28 H16 A12 12 0 0 1 4 16 V4 Z" class="v-canary" />
                <circle cx="20.5" cy="11.5" r="2.6" fill="#0A0C11" />
              </g>
            </svg>
            <p class="viz__cap lp-num">last read {{ fmtAgo(lastChecked, now) }}</p>
          </div>
        </li>

        <!-- 02 -->
        <li class="step">
          <span class="step__no lp-num" aria-hidden="true">02</span>
          <h3 class="step__title">Score each price</h3>
          <p class="step__body">Each reserve gets a price-health score from 0 to 100. Every failing check takes points off; the worst one sets its colour.</p>
          <div class="viz" aria-hidden="true">
            <svg viewBox="0 0 300 132" fill="none">
              <line x1="10" x2="290" y1="96.5" y2="96.5" class="v-axis" />
              <template v-if="bins">
                <g v-for="(b, k) in bins" :key="k">
                  <rect v-for="p in segs(b)" :key="p.s" :x="14 + k * 28" :y="p.y" width="20" :height="p.h" :class="`v-sev v-${p.s}`" />
                  <text v-if="b.total" :x="24 + k * 28" :y="(segs(b)[segs(b).length - 1]?.y ?? 96) - 5" text-anchor="middle" class="v-num">{{ b.total }}</text>
                </g>
              </template>
              <text x="14" y="114" class="v-num">0</text>
              <text x="286" y="114" text-anchor="end" class="v-num">100</text>
              <text x="150" y="114" text-anchor="middle" class="v-num">score</text>
            </svg>
            <p class="viz__cap lp-num">{{ reserves ? fmtInt(reserves.length) : '—' }} scores right now</p>
          </div>
        </li>

        <!-- 03 -->
        <li class="step">
          <span class="step__no lp-num" aria-hidden="true">03</span>
          <h3 class="step__title">Open an incident, send an alert</h3>
          <p class="step__body">
            When a price breaks, an incident opens and, for reserves holding $10K or more, the public Telegram channel gets a message.
          </p>
          <div class="viz" aria-hidden="true">
            <svg viewBox="0 0 300 132" fill="none">
              <path d="M0 104 H70 L78 96 L86 110 L94 104 H120 L128 80 L135 124 L142 104 H300" class="v-trace" />
              <path d="M120 104 L128 80 L135 124 L142 104" class="v-spike" />
              <circle cx="128" cy="80" r="4" class="v-crit-fill v-blink" />
            </svg>
            <div v-if="latest" class="msg">
              <span class="msg__dot" :class="{ 'is-ended': !!latest.endedAt, 'is-paused': latestPaused }" />
              <span class="msg__text">
                <b>{{ latest.asset }}</b> · {{ latestWhy || 'Critical' }}
                <small class="lp-num">{{ protocolName(latest.protocol) }} · {{ fmtUsd(latest.totalSupplyUsd) }} · {{ fmtAgo(Date.parse(latest.startedAt), now) }}</small>
              </span>
            </div>
            <p class="viz__cap lp-num">latest incident</p>
          </div>
        </li>
      </ol>

      <p class="more">
        <RouterLink to="/how-it-works" class="lp-link">How the checks work →</RouterLink>
        <a href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener" class="lp-link">Join the alert channel ↗</a>
      </p>
    </div>
  </section>
</template>

<style scoped>
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
  position: relative;
}
.steps::before {
  /* the shaft, laid on its side: a depth rule with ticks joining the three steps */
  content: '';
  position: absolute;
  top: 20px;
  left: 21px;
  right: 0;
  height: 10px;
  border-top: 1px solid var(--lp-line-strong);
  background: repeating-linear-gradient(90deg, var(--lp-line-strong) 0 1px, transparent 1px 14px);
  -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent);
  mask-image: linear-gradient(90deg, #000 85%, transparent);
}
.step {
  position: relative;
  display: flex;
  flex-direction: column;
}
.step__no {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--lp-bg);
  border: 1px solid var(--lp-accent-line);
  color: var(--lp-accent-text);
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 0 0 6px var(--lp-bg), 0 0 24px -4px var(--lp-accent-glow);
  margin-bottom: 22px;
}
.step__title {
  margin: 0 0 8px;
  font-family: var(--lp-display);
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--lp-ink);
}
.step__body {
  margin: 0 0 18px;
  color: var(--lp-ink-2);
  font-size: 15px;
  line-height: 1.6;
  flex: 1;
}
.viz {
  position: relative;
  border: 1px solid var(--lp-line);
  border-radius: 16px;
  background: var(--lp-panel);
  padding: 14px 14px 10px;
}
.viz svg {
  display: block;
  width: 100%;
  height: auto;
}
.viz__cap {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--lp-ink-3);
  text-align: end;
}
.more {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 28px 0 0;
}

/* diagram palette */
.v-label {
  fill: var(--lp-ink);
  font: 600 12px var(--lp-sans);
}
.v-num {
  fill: var(--lp-ink-3);
  font: 500 10.5px var(--lp-mono);
}
.v-wire {
  stroke: var(--lp-line-strong);
  stroke-width: 1.2;
}
.v-pulse {
  fill: var(--lp-accent);
  offset-distance: 0%;
  animation: v-travel 2.4s ease-in infinite;
}
.v-node {
  fill: var(--lp-bg);
  stroke: var(--lp-accent-line);
}
.v-canary {
  fill: var(--lp-accent);
}
.v-axis {
  stroke: var(--lp-line-strong);
}
.v-sev {
  rx: 2px;
}
.v-critical {
  fill: var(--lp-crit);
}
.v-warning {
  fill: var(--lp-warn);
}
.v-info {
  fill: var(--lp-ink-3);
}
.v-paused {
  fill: var(--lp-info);
}
.v-ok {
  fill: var(--lp-ok);
}
.v-trace {
  stroke: var(--lp-line-strong);
  stroke-width: 1.5;
}
.v-spike {
  stroke: var(--lp-crit);
  stroke-width: 2;
}
.v-crit-fill {
  fill: var(--lp-crit);
}
.v-blink {
  animation: v-blink 2.4s ease-in-out infinite;
}
.msg {
  position: absolute;
  top: 14px;
  right: 14px;
  left: 36%;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 9px 11px;
  border-radius: 12px;
  background: var(--lp-bg);
  border: 1px solid var(--lp-line-strong);
  box-shadow: 0 10px 24px -16px rgba(0, 0, 0, 0.5);
}
.msg__dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--lp-crit);
}
.msg__dot.is-paused {
  background: var(--lp-info);
}
.msg__dot.is-ended {
  background: var(--lp-ink-3);
}
.msg__text {
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--lp-ink-2);
}
.msg__text b {
  color: var(--lp-ink);
}
.msg__text small {
  display: block;
  font-size: 11px;
  color: var(--lp-ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes v-travel {
  from {
    offset-distance: 0%;
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  to {
    offset-distance: 100%;
    opacity: 0.2;
  }
}
@keyframes v-blink {
  50% {
    opacity: 0.25;
  }
}
@keyframes v-pop {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@media (max-width: 960px) {
  .steps {
    grid-template-columns: minmax(0, 1fr);
    gap: 36px;
  }
  .steps::before {
    display: none;
  }
  .step {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    column-gap: 18px;
  }
  .step__no {
    grid-row: span 3;
    margin: 0;
  }
  .viz {
    grid-column: 2;
    max-width: 420px;
  }
}
@media (max-width: 600px) {
  .viz {
    display: none;
  }
  .step__body {
    margin-bottom: 0;
  }
  .steps {
    gap: 24px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .viz *,
  .msg {
    animation: none !important;
  }
  .v-pulse {
    display: none;
  }
}
</style>
