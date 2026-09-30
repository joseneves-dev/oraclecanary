<script setup lang="ts">
/* How it works, as a descent down the shaft: five numbered steps, each with a small moving diagram. */
import { RouterLink } from 'vue-router'

const steps = [
  {
    key: 'read',
    title: 'Read the chain',
    body: 'Every five minutes, OracleCanary reads from Solana mainnet the oracle configuration and the price accounts behind every reserve of Kamino, marginfi and Jupiter Lend.',
    link: { label: 'How the checks work', to: '/how-it-works' },
  },
  {
    key: 'score',
    title: 'Score each price',
    body: 'Each reserve gets a price-health score from 0 to 100. Every failing check takes points off; the worst one sets its colour.',
    link: { label: 'Browse the reserves', to: '/reserves' },
  },
  {
    key: 'alert',
    title: 'Open an incident, send an alert',
    body: 'When a price breaks, an incident opens and the public Telegram channel gets a message. Changes to how a reserve is priced are recorded too.',
    link: { label: 'Join the alert channel', href: 'https://t.me/OracleCanaryAlerts' },
  },
  {
    key: 'wallet',
    title: 'Check your own positions',
    body: 'Paste a wallet: see which Kamino and marginfi deposits and loans rely on a broken price, and the liquidation price of each loan. The bot can watch it for you.',
    link: { label: 'Check a wallet', to: '/positions' },
  },
  {
    key: 'guard',
    title: 'Stop the transaction',
    body: 'The oracle_guard program makes a transaction fail on-chain, before your borrow runs, when a price it relies on is broken. Live on devnet only.',
    link: { label: 'See the guard', to: '/how-it-works#guard' },
  },
] as const
</script>

<template>
  <section id="how" class="lp-section" aria-labelledby="how-title">
    <div class="lp-wrap">
      <div class="lp-head">
        <span class="lp-kicker">How it works</span>
        <h2 id="how-title" class="lp-h2">From a price account on-chain to a message on your phone.</h2>
      </div>

      <ol class="shaft">
        <li v-for="(s, i) in steps" :key="s.key" class="step">
          <div class="step__depth" aria-hidden="true">
            <span class="step__no lp-num">{{ String(i + 1).padStart(2, '0') }}</span>
          </div>
          <div class="step__text">
            <h3 class="step__title">{{ s.title }}</h3>
            <p class="step__body">{{ s.body }}</p>
            <a v-if="'href' in s.link" :href="s.link.href" target="_blank" rel="noopener" class="lp-link">{{ s.link.label }} →</a>
            <RouterLink v-else :to="s.link.to" class="lp-link">{{ s.link.label }} →</RouterLink>
          </div>
          <div class="step__viz" aria-hidden="true">
            <!-- 01 read: blocks pass under a read head -->
            <svg v-if="s.key === 'read'" viewBox="0 0 240 120" fill="none">
              <g class="d-blocks">
                <rect v-for="k in 9" :key="k" :x="(k - 1) * 34 - 20" y="62" width="26" height="26" rx="5" class="d-block" />
              </g>
              <path d="M120 22 V52" class="d-accent" stroke-width="2" />
              <path d="M110 52 H130 L120 62 Z" class="d-accent-fill" />
              <circle cx="120" cy="18" r="5" class="d-accent-fill d-blink" />
              <text x="146" y="22" class="d-label">every 5 min</text>
              <path d="M0 100 H240" class="d-line" stroke-dasharray="2 5" />
            </svg>

            <!-- 02 score: a gauge -->
            <svg v-else-if="s.key === 'score'" viewBox="0 0 240 120" fill="none">
              <path d="M50 100 A70 70 0 0 1 190 100" class="d-line" stroke-width="10" stroke-linecap="butt" />
              <path d="M50 100 A70 70 0 0 1 71 50.5" class="d-crit" stroke-width="10" />
              <path d="M71 50.5 A70 70 0 0 1 120 30" class="d-warn" stroke-width="10" />
              <path d="M120 30 A70 70 0 0 1 190 100" class="d-ok" stroke-width="10" />
              <g class="d-needle">
                <path d="M120 100 L120 42" class="d-ink" stroke-width="2.5" stroke-linecap="round" />
              </g>
              <circle cx="120" cy="100" r="6" class="d-ink-fill" />
              <text x="44" y="116" class="d-label">0</text>
              <text x="180" y="116" class="d-label">100</text>
            </svg>

            <!-- 03 alert: the trace breaks and a message goes out -->
            <svg v-else-if="s.key === 'alert'" viewBox="0 0 240 120" fill="none">
              <path d="M0 84 H40 L48 74 L56 90 L64 84 H96 L104 60 L110 100 L116 84 H240" class="d-line" stroke-width="1.6" />
              <path d="M96 84 L104 60 L110 100 L116 84" class="d-crit" stroke-width="2" />
              <circle cx="104" cy="60" r="4" class="d-crit-fill d-blink" />
              <g class="d-msg">
                <rect x="138" y="16" width="92" height="44" rx="10" class="d-card" />
                <path d="M150 60 L146 70 L160 60" class="d-card" />
                <circle cx="154" cy="31" r="4" class="d-crit-fill" />
                <rect x="164" y="28" width="52" height="6" rx="3" class="d-ink-fill" opacity="0.8" />
                <rect x="150" y="42" width="66" height="5" rx="2.5" class="d-ink-fill" opacity="0.35" />
              </g>
            </svg>

            <!-- 04 wallet: one position depends on a broken price -->
            <svg v-else-if="s.key === 'wallet'" viewBox="0 0 240 120" fill="none">
              <rect x="40" y="10" width="160" height="100" rx="12" class="d-card" />
              <rect x="56" y="24" width="60" height="7" rx="3.5" class="d-ink-fill" opacity="0.7" />
              <g v-for="(row, k) in [0, 1, 2]" :key="k">
                <rect x="56" :y="44 + row * 20" width="10" height="10" rx="3" :class="row === 1 ? 'd-row-alert' : 'd-ok-fill'" />
                <rect x="74" :y="46 + row * 20" :width="[70, 52, 62][row]" height="6" rx="3" class="d-ink-fill" opacity="0.35" />
                <rect x="160" :y="46 + row * 20" width="26" height="6" rx="3" class="d-ink-fill" opacity="0.5" />
              </g>
              <rect x="50" y="59" width="142" height="20" rx="6" class="d-row-ring" />
            </svg>

            <!-- 05 guard: a transaction meets the gate -->
            <svg v-else viewBox="0 0 240 120" fill="none">
              <path d="M10 70 H230" class="d-line" stroke-dasharray="2 5" />
              <rect x="150" y="30" width="8" height="70" rx="2" class="d-ink-fill" />
              <rect class="d-gate" x="140" y="30" width="6" height="40" rx="2" />
              <g class="d-tx">
                <rect x="0" y="58" width="44" height="24" rx="6" class="d-accent-fill" />
                <text x="22" y="74" text-anchor="middle" class="d-tx-label">borrow</text>
              </g>
              <text x="154" y="20" text-anchor="middle" class="d-label">oracle_guard</text>
              <text x="200" y="74" text-anchor="middle" class="d-label d-label--crit d-refused">refused</text>
              <text x="154" y="116" text-anchor="middle" class="d-label">price broken</text>
            </svg>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.shaft {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
}
.step {
  position: relative;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) minmax(0, 300px);
  gap: 32px;
  align-items: center;
  padding: 34px 0;
  border-top: 1px solid var(--lp-line);
}
.step:last-child {
  border-bottom: 1px solid var(--lp-line);
}
.step__depth {
  align-self: stretch;
  position: relative;
}
.step__depth::before {
  /* the shaft: a depth gauge with ticks */
  content: '';
  position: absolute;
  top: -34px;
  bottom: -34px;
  left: 20px;
  width: 12px;
  background: repeating-linear-gradient(180deg, var(--lp-line-strong) 0 1px, transparent 1px 12px);
  border-left: 1px solid var(--lp-line-strong);
}
.step:first-child .step__depth::before {
  top: 0;
}
.step:last-child .step__depth::before {
  bottom: 0;
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
}
.step__title {
  margin: 0 0 10px;
  font-family: var(--lp-display);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--lp-ink);
}
.step__body {
  margin: 0 0 14px;
  max-width: 56ch;
  color: var(--lp-ink-2);
  font-size: 16px;
  line-height: 1.6;
}
.step__viz {
  border: 1px solid var(--lp-line);
  border-radius: 16px;
  background: var(--lp-panel);
  padding: 14px;
  overflow: hidden;
}
.step__viz svg {
  display: block;
  width: 100%;
  height: auto;
}

/* diagram palette */
.d-line {
  stroke: var(--lp-line-strong);
}
.d-block {
  fill: var(--lp-fill-strong);
  stroke: var(--lp-line-strong);
}
.d-accent {
  stroke: var(--lp-accent);
}
.d-accent-fill {
  fill: var(--lp-accent);
}
.d-ink {
  stroke: var(--lp-ink);
}
.d-ink-fill {
  fill: var(--lp-ink);
}
.d-crit {
  stroke: var(--lp-crit);
}
.d-crit-fill {
  fill: var(--lp-crit);
}
.d-warn {
  stroke: var(--lp-warn);
}
.d-ok {
  stroke: var(--lp-ok);
}
.d-ok-fill {
  fill: var(--lp-ok);
}
.d-card {
  fill: var(--lp-bg);
  stroke: var(--lp-line-strong);
}
.d-label {
  fill: var(--lp-ink-3);
  font-family: var(--lp-mono);
  font-size: 11px;
}
.d-label--crit {
  fill: var(--lp-crit);
}
.d-tx-label {
  fill: #1a1400;
  font-family: var(--lp-mono);
  font-size: 10px;
  font-weight: 600;
}

/* motion */
.d-blocks {
  animation: d-slide 2.4s linear infinite;
}
.d-blink {
  animation: d-blink 2.4s ease-in-out infinite;
}
.d-needle {
  transform-origin: 120px 100px;
  animation: d-needle 6s ease-in-out infinite;
}
.d-msg {
  transform-origin: 150px 60px;
  animation: d-pop 4s ease-out infinite;
}
.d-row-alert {
  fill: var(--lp-ok);
  animation: d-alert 4s steps(1) infinite;
}
.d-row-ring {
  fill: none;
  stroke: var(--lp-crit);
  stroke-width: 1.5;
  animation: d-ring 4s ease-out infinite;
}
.d-gate {
  fill: var(--lp-crit);
  transform-origin: 143px 70px;
  animation: d-gate 5s ease-in-out infinite;
}
.d-refused {
  animation: d-refused 5s ease-in-out infinite;
}
.d-tx {
  animation: d-tx 5s ease-in-out infinite;
}

@keyframes d-slide {
  to {
    transform: translateX(34px);
  }
}
@keyframes d-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
@keyframes d-needle {
  0%,
  100% {
    transform: rotate(62deg);
  }
  40% {
    transform: rotate(54deg);
  }
  60% {
    transform: rotate(-58deg);
  }
  75% {
    transform: rotate(-50deg);
  }
}
@keyframes d-pop {
  0%,
  30% {
    opacity: 0;
    transform: scale(0.85) translateY(6px);
  }
  40%,
  90% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}
@keyframes d-alert {
  0% {
    fill: var(--lp-ok);
  }
  35% {
    fill: var(--lp-crit);
  }
}
@keyframes d-ring {
  0%,
  35% {
    opacity: 0;
  }
  45%,
  90% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes d-gate {
  0%,
  20% {
    transform: rotate(-90deg);
  }
  35%,
  85% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(-90deg);
  }
}
@keyframes d-tx {
  0% {
    transform: translateX(-50px);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  45%,
  80% {
    transform: translateX(90px);
    opacity: 1;
  }
  95%,
  100% {
    transform: translateX(90px);
    opacity: 0;
  }
}

@keyframes d-refused {
  0%,
  44% {
    opacity: 0;
  }
  50%,
  82% {
    opacity: 1;
  }
  92%,
  100% {
    opacity: 0;
  }
}

@media (max-width: 900px) {
  .step {
    grid-template-columns: 56px minmax(0, 1fr);
    gap: 16px 18px;
    align-items: start;
  }
  .step__depth::before {
    left: 20px;
  }
  .step__viz {
    grid-column: 2;
    max-width: 360px;
  }
  .step__title {
    font-size: 22px;
  }
  .step__body {
    font-size: 15px;
  }
}
@media (max-width: 480px) {
  .step {
    grid-template-columns: 44px minmax(0, 1fr);
    padding: 26px 0;
  }
  .step__depth::before {
    left: 13px;
    top: -26px;
    bottom: -26px;
  }
  .step__no {
    width: 34px;
    height: 34px;
    font-size: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .step__viz * {
    animation: none !important;
  }
}
</style>
