<script setup lang="ts">
/*
 * The front page, outside the app shell. A dark "mine" lit by a canary-yellow lamp (warm paper in
 * light mode), with the live reserve field as its signature. Every number comes from the API.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { fmtAgo, fmtInt, fmtUsd, useLanding } from '@/composables/useLanding'
import LandingNav from '@/components/landing/LandingNav.vue'
import ReserveField from '@/components/landing/ReserveField.vue'
import FailureCards from '@/components/landing/FailureCards.vue'
import HowSteps from '@/components/landing/HowSteps.vue'
import LiveFeed from '@/components/landing/LiveFeed.vue'
import GuardApi from '@/components/landing/GuardApi.vue'
import GetStarted from '@/components/landing/GetStarted.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'

const L = useLanding()
const { reservesFailed, reserves, incidents, openIncidents, changes, now, totalUsd, bySeverity, lastChecked, protocols, failing } = L

function retry() {
  reservesFailed.value = false
  void L.reload()
}
const fresh = computed(() => lastChecked.value != null && now.value - lastChecked.value < 15 * 60_000)
const sample = computed(() => {
  const rows = reserves.value
  if (!rows?.length) return null
  return rows.reduce((a, b) => (b.score < a.score || (b.score === a.score && b.totalSupplyUsd > a.totalSupplyUsd) ? b : a))
})
</script>

<template>
  <div class="landing">
    <LandingNav />

    <main>
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero__lamp" aria-hidden="true" />
        <svg class="hero__strata" viewBox="0 0 1440 640" preserveAspectRatio="none" aria-hidden="true">
          <path v-for="k in 9" :key="k" :d="`M0 ${150 + k * 52} C 260 ${120 + k * 50}, 520 ${190 + k * 54}, 760 ${160 + k * 52} S 1200 ${130 + k * 56}, 1440 ${170 + k * 50}`" />
        </svg>

        <div class="lp-wrap hero__inner">
          <p class="status" :class="{ 'status--stale': lastChecked != null && !fresh, 'status--unknown': lastChecked == null }">
            <span class="status__dot" aria-hidden="true" />
            <span v-if="lastChecked != null">{{ fresh ? 'Live' : 'Last read' }} · checked {{ fmtAgo(lastChecked, now) }}</span>
            <span v-else>Solana mainnet</span>
            <span class="status__sep">·</span>
            <span class="status__tag">The canary in the coal mine for Solana lending</span>
          </p>
          <h1 id="hero-title" class="hero__title">
            When a lending oracle fails, withdrawals and liquidations <em>silently stop.</em>
          </h1>
          <div class="hero__row">
            <p class="hero__lede">
              OracleCanary reads the oracle behind every reserve of Kamino, marginfi and Jupiter Lend from Solana mainnet every five minutes,
              scores its price, and tells you when one breaks. Independent, open source and free.
            </p>
            <div class="hero__cta">
              <RouterLink :to="{ name: 'overview' }" class="lp-btn lp-btn--primary lp-btn--lg">
                Open app <span aria-hidden="true">→</span>
              </RouterLink>
              <RouterLink :to="{ name: 'positions' }" class="lp-btn lp-btn--ghost lp-btn--lg">Check a wallet</RouterLink>
            </div>
          </div>
        </div>

        <div class="lp-wrap hero__field">
          <ReserveField :lanes="protocols" :by-severity="bySeverity" :failed="reservesFailed" @retry="retry">
            <dl class="readout" aria-label="Right now">
              <div>
                <dt>Listed reserves</dt>
                <dd class="lp-num">{{ reserves ? fmtInt(reserves.length) : '—' }}</dd>
              </div>
              <div>
                <dt>Deposits watched</dt>
                <dd class="lp-num">{{ fmtUsd(totalUsd) }}</dd>
              </div>
              <div>
                <dt>Critical now</dt>
                <dd class="lp-num" :class="{ crit: (bySeverity?.critical ?? 0) > 0 }">{{ bySeverity ? fmtInt(bySeverity.critical) : '—' }}</dd>
              </div>
              <div>
                <dt>Open incidents</dt>
                <dd class="lp-num" :class="{ crit: (openIncidents?.length ?? 0) > 0 }">{{ openIncidents ? fmtInt(openIncidents.length) : '—' }}</dd>
              </div>
            </dl>
          </ReserveField>
        </div>
      </section>

      <FailureCards :failing="failing" />
      <HowSteps />
      <LiveFeed :incidents="incidents" :open-count="openIncidents ? openIncidents.length : null" :changes="changes" :now="now" />
      <GuardApi :sample="sample" />
      <GetStarted />
    </main>

    <LandingFooter />
  </div>
</template>

<style>
/* ── landing palette: warm paper (light) and the lit mine (dark) ── */
.landing {
  --lp-display: 'Inter', system-ui, sans-serif;
  --lp-sans: 'Inter', system-ui, sans-serif;
  --lp-mono: var(--ax-font-mono, 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace);

  --lp-bg: #f5f0e4;
  --lp-bg-deep: #ede6d5;
  --lp-panel: #fbf8f0;
  --lp-panel-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset, 0 24px 48px -32px rgba(60, 40, 0, 0.35);
  --lp-line: rgba(58, 44, 12, 0.12);
  --lp-line-strong: rgba(58, 44, 12, 0.22);
  --lp-grid: rgba(58, 44, 12, 0.05);
  --lp-fill: rgba(58, 44, 12, 0.05);
  --lp-fill-strong: rgba(58, 44, 12, 0.09);
  --lp-ink: #1c1810;
  --lp-ink-2: #4a4232;
  --lp-ink-3: #7a705c;
  --lp-accent: #facc15;
  --lp-accent-text: #a16207;
  --lp-accent-line: rgba(161, 98, 7, 0.45);
  --lp-accent-glow: rgba(234, 179, 8, 0.45);
  --lp-ok: #16a34a;
  --lp-info: #5b7ea3;
  --lp-warn: #ea580c;
  --lp-crit: #dc2626;
  --lp-lamp: rgba(250, 204, 21, 0.28);
  --lp-strata: rgba(58, 44, 12, 0.07);
  --lp-bar-ok: 0.5;
  --lp-bar-warn: 0.62;
  --lp-em-ink: var(--lp-ink);
  --lp-em-glow: none;
  --lp-em-mark: linear-gradient(180deg, transparent 60%, #facc15 60%, #facc15 88%, transparent 88%);

  min-height: 100vh;
  background: var(--lp-bg);
  color: var(--lp-ink-2);
  font-family: var(--lp-sans);
  font-size: 16px;
  line-height: 1.5;
  overflow-x: clip;
}
[data-ax-theme='dark'] .landing {
  --lp-bg: #0d0c0a;
  --lp-bg-deep: #080706;
  --lp-panel: #15130f;
  --lp-panel-shadow: 0 1px 0 rgba(255, 240, 200, 0.04) inset, 0 30px 60px -30px rgba(0, 0, 0, 0.8);
  --lp-line: rgba(255, 240, 200, 0.08);
  --lp-line-strong: rgba(255, 240, 200, 0.16);
  --lp-grid: rgba(255, 240, 200, 0.03);
  --lp-fill: rgba(255, 240, 200, 0.04);
  --lp-fill-strong: rgba(255, 240, 200, 0.08);
  --lp-ink: #f5f0e2;
  --lp-ink-2: #bdb5a2;
  --lp-ink-3: #827a68;
  --lp-accent: #facc15;
  --lp-accent-text: #facc15;
  --lp-accent-line: rgba(250, 204, 21, 0.45);
  --lp-accent-glow: rgba(250, 204, 21, 0.35);
  --lp-ok: #4ade80;
  --lp-info: #8fb3d9;
  --lp-warn: #fb923c;
  --lp-crit: #f87171;
  --lp-lamp: rgba(250, 204, 21, 0.16);
  --lp-strata: rgba(255, 240, 200, 0.05);
  --lp-bar-ok: 0.3;
  --lp-bar-warn: 0.5;
  --lp-em-ink: #facc15;
  --lp-em-glow: 0 0 44px rgba(250, 204, 21, 0.35);
  --lp-em-mark: none;
}

.landing ::selection {
  background: var(--lp-accent);
  color: #1a1400;
}
.landing .lp-wrap {
  width: 100%;
  max-width: 1240px;
  margin-inline: auto;
  padding-inline: 32px;
}
.landing .lp-num {
  font-family: var(--lp-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.landing .lp-kicker {
  display: inline-block;
  font-family: var(--lp-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--lp-accent-text);
}
.landing .lp-section {
  padding: 112px 0 0;
}
.landing .lp-section--start {
  padding-bottom: 112px;
}
.landing .lp-head {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
  margin-bottom: 44px;
}
.landing .lp-head--row {
  max-width: none;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px 40px;
}
.landing .lp-head--row > div {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.landing .lp-h2 {
  margin: 0;
  font-family: var(--lp-display);
  font-size: clamp(30px, 4vw, 46px);
  line-height: 1.06;
  font-weight: 600;
  letter-spacing: -0.03em;
  color: var(--lp-ink);
  text-wrap: balance;
}
.landing .lp-lede {
  margin: 0;
  font-size: 17px;
  line-height: 1.6;
  color: var(--lp-ink-2);
  max-width: 60ch;
}
.landing .lp-link {
  color: var(--lp-accent-text);
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
}
.landing .lp-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.landing .lp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;
  transition: background-color 0.15s, border-color 0.15s, box-shadow 0.2s, transform 0.15s;
}
.landing .lp-btn--lg {
  height: 48px;
  padding-inline: 22px;
  font-size: 15px;
  border-radius: 12px;
}
.landing .lp-btn--primary {
  background: var(--lp-accent);
  color: #1a1400;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.45) inset, 0 8px 24px -10px var(--lp-accent-glow);
}
.landing .lp-btn--primary:hover {
  background: #fde047;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 10px 30px -8px var(--lp-accent-glow);
}
.landing .lp-btn--ghost {
  border: 1px solid var(--lp-line-strong);
  color: var(--lp-ink);
  background: color-mix(in srgb, var(--lp-panel) 60%, transparent);
}
.landing .lp-btn--ghost:hover {
  border-color: var(--lp-accent-line);
}
.landing .lp-btn:focus-visible,
.landing .lp-link:focus-visible,
.landing a:focus-visible {
  outline: 2px solid var(--lp-accent);
  outline-offset: 3px;
}
@media (max-width: 640px) {
  .landing .lp-wrap {
    padding-inline: 16px;
  }
  .landing .lp-section {
    padding-top: 80px;
  }
  .landing .lp-section--start {
    padding-bottom: 80px;
  }
  .landing .lp-head {
    margin-bottom: 28px;
  }
  .landing .lp-lede {
    font-size: 16px;
  }
}
</style>

<style scoped>
.hero {
  position: relative;
  padding: 56px 0 0;
  isolation: isolate;
}
.hero__lamp {
  position: absolute;
  z-index: -1;
  inset: -64px 0 auto;
  height: 900px;
  background:
    radial-gradient(ellipse 46% 62% at 14% 0%, var(--lp-lamp), transparent 70%),
    radial-gradient(ellipse 30% 40% at 86% 30%, color-mix(in srgb, var(--lp-lamp) 40%, transparent), transparent 70%);
  pointer-events: none;
}
.hero__strata {
  position: absolute;
  z-index: -1;
  inset: 0 0 auto;
  width: 100%;
  height: 640px;
  fill: none;
  stroke: var(--lp-strata);
  stroke-width: 1;
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent);
  mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent);
  pointer-events: none;
}
.status {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: 0 0 26px;
  padding: 6px 14px 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--lp-line-strong);
  background: color-mix(in srgb, var(--lp-panel) 70%, transparent);
  font-size: 13px;
  color: var(--lp-ink-2);
}
.status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lp-ok);
  animation: lp-beat 2s ease-out infinite;
}
.status--unknown .status__dot {
  background: var(--lp-ink-3);
  animation: none;
}
.status--stale .status__dot {
  background: var(--lp-warn);
  animation: none;
}
.status__sep,
.status__tag {
  color: var(--lp-ink-3);
}
.hero__title {
  margin: 0;
  max-width: 19ch;
  font-family: var(--lp-display);
  font-size: clamp(40px, 5.7vw, 80px);
  line-height: 0.98;
  font-weight: 600;
  letter-spacing: -0.045em;
  color: var(--lp-ink);
  text-wrap: balance;
}
.hero__title em {
  font-style: normal;
  color: var(--lp-em-ink);
  text-shadow: var(--lp-em-glow);
  background: var(--lp-em-mark);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.hero__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px 48px;
  margin-top: 30px;
}
.hero__lede {
  margin: 0;
  max-width: 58ch;
  font-size: 18px;
  line-height: 1.6;
  color: var(--lp-ink-2);
}
.hero__cta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.hero__field {
  margin-top: 48px;
}

/* readouts, shown at the top of the field panel */
.readout {
  margin: -20px -24px 20px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid var(--lp-line);
}
.readout > div {
  padding: 16px 24px 18px;
}
.readout > div + div {
  border-inline-start: 1px solid var(--lp-line);
}
.readout dt {
  font-family: var(--lp-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--lp-ink-3);
}
.readout dd {
  margin: 6px 0 0;
  font-size: 32px;
  font-weight: 600;
  line-height: 1.05;
  color: var(--lp-ink);
  letter-spacing: -0.035em;
}
.readout dd.crit {
  color: var(--lp-crit);
}

@keyframes lp-beat {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--lp-ok) 55%, transparent);
  }
  100% {
    box-shadow: 0 0 0 9px color-mix(in srgb, var(--lp-ok) 0%, transparent);
  }
}

@media (max-width: 760px) {
  .readout {
    margin: -16px -14px 16px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .readout > div {
    padding: 12px 14px 14px;
  }
  .readout > div:nth-child(3) {
    border-inline-start: 0;
  }
  .readout > div:nth-child(n + 3) {
    border-top: 1px solid var(--lp-line);
  }
  .readout dd {
    font-size: 24px;
  }
}
@media (max-width: 640px) {
  .hero {
    padding-top: 32px;
  }
  .status {
    margin-bottom: 20px;
    font-size: 12px;
  }
  .status__sep,
  .status__tag {
    display: none;
  }
  .hero__title {
    font-size: clamp(36px, 10.4vw, 48px);
    line-height: 1.02;
  }
  .hero__row {
    margin-top: 20px;
  }
  .hero__lede {
    font-size: 16px;
  }
  .hero__cta {
    width: 100%;
  }
  .hero__cta .lp-btn {
    flex: 1 1 0;
    padding-inline: 12px;
  }
  .hero__field {
    margin-top: 36px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .status__dot {
    animation: none;
  }
}
</style>
