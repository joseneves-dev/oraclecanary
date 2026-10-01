<script setup lang="ts">
/* What goes wrong with a lending oracle, each with how many listed reserves have it right now. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Severity } from '@/api/client'
import { fmtInt, fmtUsd } from '@/composables/useLanding'

const props = defineProps<{
  failing: (codes: string[], severity?: Severity, excludePaused?: boolean) => { count: number; usd: number } | null
}>()

interface Card {
  key: string
  codes: string[]
  /** Count only checks at this severity, so the number matches the sentence. */
  severity?: Severity
  /** Leave out stocks paused by market hours (counted on their own card). */
  excludePaused?: boolean
  issue: string
  tone: 'crit' | 'risk' | 'info'
  tag?: string
  title: string
  body: string
}

const cards: Card[] = [
  {
    key: 'stale',
    codes: ['STALE'],
    excludePaused: true,
    issue: 'STALE',
    tone: 'crit',
    title: 'Stale price',
    body: 'The price is older than the protocol accepts, so it rejects it: borrowing, withdrawals and liquidations fail until a fresh price lands.',
  },
  {
    key: 'fallback',
    codes: ['NO_FALLBACK'],
    issue: 'NO_FALLBACK',
    tone: 'risk',
    tag: 'Risk, not an outage',
    title: 'No fallback oracle',
    body: 'Works today; if that one feed stops, the price stops.',
  },
  {
    key: 'shutdown',
    codes: ['DEPRECATED_PROVIDER'],
    severity: 'critical',
    issue: 'DEPRECATED_PROVIDER',
    tone: 'crit',
    title: 'Shut-down oracle',
    body: 'Switchboard shut down on 25 Sep 2026. A reserve still reading only its feed has no working price.',
  },
  {
    key: 'diverge',
    codes: ['SOURCES_DIVERGE', 'WIDE_CONFIDENCE'],
    issue: 'SOURCES_DIVERGE',
    tone: 'risk',
    title: 'Sources disagree',
    body: 'Two price sources that do not match, or Pyth unsure of its own price: collateral can be overvalued, or borrowers liquidated early.',
  },
  {
    key: 'hours',
    codes: ['MARKET_CLOSED'],
    issue: 'MARKET_CLOSED',
    tone: 'info',
    title: 'Market hours',
    body: 'Tokenized-stock prices stop when the US market closes (some feeds run until 20:00 New York time), and so do their reserves.',
  },
]

const rows = computed(() => cards.map((c) => ({ ...c, live: props.failing(c.codes, c.severity, c.excludePaused) })))
</script>

<template>
  <section class="lp-section" aria-labelledby="wrong-title">
    <div class="lp-wrap">
      <div class="lp-head">
        <span class="lp-kicker">What goes wrong</span>
        <h2 id="wrong-title" class="lp-h2">Five ways a price stops being safe to lend against.</h2>
        <p class="lp-lede">Checked every five minutes on every listed reserve they apply to. The counts are live.</p>
      </div>

      <ol class="cards">
        <li v-for="(c, i) in rows" :key="c.key" class="card" :class="`tone-${c.tone}`">
          <div class="card__top">
            <span class="card__no lp-num">{{ String(i + 1).padStart(2, '0') }}</span>
            <svg class="card__glyph" viewBox="0 0 64 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <template v-if="c.key === 'stale'">
                <path d="M2 24 L8 18 L13 21 L19 10 L24 15 L28 13" />
                <path class="g-flat" d="M28 13 H62" stroke-dasharray="3 4" />
                <circle cx="28" cy="13" r="2.2" fill="currentColor" />
              </template>
              <template v-else-if="c.key === 'fallback'">
                <circle cx="6" cy="16" r="3" />
                <path d="M9 16 H40" />
                <circle cx="44" cy="16" r="4" fill="currentColor" />
                <path class="g-ghost" d="M9 16 C 18 16, 20 27, 30 27 H 38" stroke-dasharray="2 4" />
              </template>
              <template v-else-if="c.key === 'shutdown'">
                <circle cx="32" cy="16" r="10" />
                <path d="M32 3 V13" />
                <path d="M18 28 L46 4" />
              </template>
              <template v-else-if="c.key === 'diverge'">
                <path d="M2 18 C 14 18, 20 16, 30 16 S 50 12, 62 8" />
                <path class="g-drift" d="M30 16 C 40 16, 48 22, 62 26" stroke-dasharray="3 3" />
                <circle cx="30" cy="16" r="2.2" fill="currentColor" />
              </template>
              <template v-else>
                <path d="M2 22 L10 16 L16 19 L22 12" />
                <path d="M22 12 H44" stroke-dasharray="1 4" />
                <path d="M44 12 L50 16 L56 10 L62 14" />
                <path d="M31 4 a5 5 0 1 0 5 6 a4 4 0 0 1 -5 -6 z" fill="currentColor" stroke="none" />
              </template>
            </svg>
          </div>
          <h3 class="card__title">{{ c.title }}</h3>
          <p class="card__body">{{ c.body }}</p>
          <span v-if="c.tag" class="card__tag">{{ c.tag }}</span>
          <div class="card__live">
            <template v-if="!c.live">
              <span class="card__count lp-num">—</span>
            </template>
            <template v-else-if="c.live.count === 0">
              <span class="card__none">None right now <span aria-hidden="true">✓</span></span>
            </template>
            <template v-else>
              <span class="card__count lp-num">{{ fmtInt(c.live.count) }}</span>
              <span class="card__unit">
                {{ c.live.count === 1 ? 'reserve' : 'reserves' }} · <span class="lp-num">{{ fmtUsd(c.live.usd) }}</span>
              </span>
            </template>
          </div>
          <RouterLink :to="{ name: 'reserves', query: { issue: c.issue } }" class="card__link" :aria-label="`See reserves: ${c.title.toLowerCase()}`">
            <span aria-hidden="true">→</span>
          </RouterLink>
        </li>
      </ol>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.cards {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  background: var(--lp-line);
  border: 1px solid var(--lp-line);
  border-radius: 18px;
  overflow: hidden;
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px 20px 20px;
  background: var(--lp-bg);
  transition: background-color 0.2s;
}
.card:hover {
  background: var(--lp-panel);
}
.tone-crit {
  --tone: var(--lp-crit);
  --tone-text: var(--lp-crit-text);
}
.tone-risk {
  --tone: color-mix(in srgb, var(--lp-warn) 70%, var(--lp-ink-3));
  --tone-text: var(--lp-ink);
}
.tone-info {
  --tone: var(--lp-info);
  --tone-text: var(--lp-ink);
}
.card__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.card__no {
  font-size: 12px;
  color: var(--lp-ink-3);
}
.card__glyph {
  width: 64px;
  height: 32px;
  color: var(--tone);
}
.g-ghost {
  opacity: 0.45;
}
.g-flat {
  animation: lp-dash 1.8s linear infinite;
}
.card__tag {
  align-self: flex-start;
  padding: 2px 8px;
  font-family: var(--lp-sans);
  letter-spacing: 0;
  border-radius: 999px;
  border: 1px solid var(--lp-line-strong);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--lp-ink-2);
}
.card__title {
  margin: 0;
  font-family: var(--lp-display);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--lp-ink);
}
.card__body {
  margin: 0;
  color: var(--lp-ink-2);
  font-size: 14px;
  line-height: 1.55;
  flex: 1;
}
.card__live {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-height: 46px;
  padding: 14px 22px 0 0;
  margin-top: 6px;
  border-top: 1px dashed var(--lp-line-strong);
}
.card__count {
  font-size: 28px;
  font-weight: 600;
  line-height: 1;
  color: var(--tone-text);
  letter-spacing: -0.03em;
}
.card__unit {
  font-size: 12.5px;
  color: var(--lp-ink-3);
  white-space: nowrap;
}
.card__none {
  font-size: 14px;
  font-weight: 600;
  color: var(--lp-ok-text);
  line-height: 28px;
}
.card__link {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 18px 20px;
  color: var(--lp-ink-3);
  text-decoration: none;
  font-size: 18px;
  transition: color 0.2s;
}
.card:hover .card__link {
  color: var(--lp-accent-text);
}
.card__link:focus-visible {
  outline: 2px solid var(--lp-focus);
  outline-offset: -4px;
  border-radius: 12px;
}
@keyframes lp-dash {
  to {
    stroke-dashoffset: -14;
  }
}
@media (max-width: 1180px) {
  .cards {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .card:last-child {
    grid-column: span 2;
  }
}
@media (max-width: 900px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .card:last-child {
    grid-column: 1 / -1;
  }
}
@media (max-width: 600px) {
  /* a swipeable row */
  .cards {
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: 82%;
    gap: 12px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    background: none;
    border: 0;
    border-radius: 0;
    margin-inline: -16px;
    padding: 0 16px 8px;
    scroll-padding-inline: 16px;
    scrollbar-width: none;
  }
  .cards::-webkit-scrollbar {
    display: none;
  }
  .card:last-child {
    grid-column: auto;
  }
  .card {
    scroll-snap-align: start;
    border: 1px solid var(--lp-line);
    border-radius: 16px;
    background: var(--lp-panel);
  }
}
@media (prefers-reduced-motion: reduce) {
  .g-flat {
    animation: none;
  }
}
</style>
