<script setup lang="ts">
/* What goes wrong with a lending oracle, each with how many listed reserves have it right now. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { fmtInt, fmtUsd } from '@/composables/useLanding'

const props = defineProps<{
  failing: (codes: string[]) => { count: number; usd: number } | null
}>()

const cards = [
  {
    key: 'stale',
    codes: ['STALE'],
    issue: 'STALE',
    tone: 'crit',
    title: 'Stale price',
    body: 'The price is older than the protocol accepts, so it rejects it: borrowing, withdrawals and liquidations fail until a fresh price lands.',
  },
  {
    key: 'fallback',
    codes: ['NO_FALLBACK'],
    issue: 'NO_FALLBACK',
    tone: 'warn',
    title: 'No fallback oracle',
    body: 'One feed and nothing behind it. If that oracle stops updating, the price stops with it.',
  },
  {
    key: 'shutdown',
    codes: ['DEPRECATED_PROVIDER'],
    issue: 'DEPRECATED_PROVIDER',
    tone: 'crit',
    title: 'Shut-down oracle',
    body: 'Switchboard shut down on 25 Sep 2026. A reserve still priced only by it has no working price.',
  },
  {
    key: 'wrong',
    codes: ['PRICE_DEVIATION', 'SOURCES_DIVERGE', 'WIDE_CONFIDENCE'],
    issue: 'PRICE_DEVIATION',
    tone: 'warn',
    title: 'Price looks wrong',
    body: 'Far from the market, sources that disagree, or Pyth unsure of its own price: collateral is overvalued, or borrowers are liquidated early.',
  },
  {
    key: 'hours',
    codes: ['MARKET_CLOSED'],
    issue: 'MARKET_CLOSED',
    tone: 'info',
    title: 'Market hours',
    body: 'Tokenized stocks are priced only while the US market is open. When it closes, their price pauses, and so do their reserves.',
  },
] as const

const rows = computed(() => cards.map((c) => ({ ...c, live: props.failing([...c.codes]) })))
const also = computed(() => ({
  near: props.failing(['NEAR_STALE']),
  fixed: props.failing(['FIXED_PRICE']),
  none: props.failing(['NO_ORACLE', 'EMPTY_PRICE_ENTRY', 'UNREADABLE_ORACLE']),
}))
</script>

<template>
  <section class="lp-section" aria-labelledby="wrong-title">
    <div class="lp-wrap">
      <div class="lp-head">
        <span class="lp-kicker">What goes wrong</span>
        <h2 id="wrong-title" class="lp-h2">Five ways a price stops being safe to lend against.</h2>
        <p class="lp-lede">Each one is checked on every listed reserve, every five minutes. The numbers are live.</p>
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
                <path class="g-ghost" d="M52 11 L58 17 M58 11 L52 17" />
              </template>
              <template v-else-if="c.key === 'shutdown'">
                <circle cx="32" cy="16" r="10" />
                <path d="M32 3 V13" />
                <path class="g-slash" d="M18 28 L46 4" />
              </template>
              <template v-else-if="c.key === 'wrong'">
                <path d="M2 20 C 14 20, 20 16, 30 16 S 50 12, 62 10" />
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
          <div class="card__live">
            <span class="card__count lp-num" :class="{ 'is-zero': c.live?.count === 0 }">{{ c.live ? fmtInt(c.live.count) : '—' }}</span>
            <span class="card__unit">
              {{ c.live?.count === 1 ? 'reserve' : 'reserves' }} now · <span class="lp-num">{{ fmtUsd(c.live?.usd) }}</span>
            </span>
          </div>
          <RouterLink :to="{ name: 'reserves', query: { issue: c.issue } }" class="card__link" :aria-label="`See reserves with ${c.title.toLowerCase()}`">
            <span aria-hidden="true">→</span>
          </RouterLink>
        </li>
      </ol>

      <p class="also">
        Also checked:
        <span>close to stale <b class="lp-num">{{ fmtInt(also.near?.count) }}</b></span>
        <span>fixed price <b class="lp-num">{{ fmtInt(also.fixed?.count) }}</b></span>
        <span>no readable oracle <b class="lp-num">{{ fmtInt(also.none?.count) }}</b></span>
      </p>
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
}
.tone-warn {
  --tone: var(--lp-warn);
}
.tone-info {
  --tone: var(--lp-info);
}
.card__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
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
.g-slash {
  stroke: var(--lp-crit);
}
.g-flat {
  animation: lp-dash 1.8s linear infinite;
}
.card__title {
  margin: 0;
  font-family: var(--lp-display);
  font-size: 19px;
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
  flex-direction: column;
  gap: 6px;
  padding-top: 14px;
  margin-top: 6px;
  border-top: 1px dashed var(--lp-line-strong);
  padding-right: 22px;
}
.card__count {
  font-size: 30px;
  font-weight: 600;
  line-height: 1;
  color: var(--tone);
  letter-spacing: -0.03em;
}
.card__count.is-zero {
  color: var(--lp-ok);
}
.card__unit {
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--lp-ink-3);
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
  outline: 2px solid var(--lp-accent);
  outline-offset: -4px;
  border-radius: 12px;
}
.also {
  margin: 18px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  font-size: 13.5px;
  color: var(--lp-ink-3);
}
.also b {
  color: var(--lp-ink);
  font-weight: 600;
  margin-inline-start: 4px;
}
@keyframes lp-dash {
  to {
    stroke-dashoffset: -14;
  }
}
@media (max-width: 1180px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .card:first-child {
    grid-column: 1 / -1;
  }
}
@media (max-width: 620px) {
  .cards {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .g-flat {
    animation: none;
  }
}
</style>
