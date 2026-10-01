<script setup lang="ts">
/* Closing band: follow the alerts, let the bot watch a wallet, or open the app. */
import { RouterLink } from 'vue-router'
import CanaryMark from './CanaryMark.vue'
</script>

<template>
  <section class="lp-section lp-section--last" aria-labelledby="start-title">
    <div class="lp-wrap">
      <div class="band">
        <div class="band__intro">
          <span class="band__mark" aria-hidden="true"><CanaryMark :size="44" /></span>
          <div>
            <h2 id="start-title" class="band__title">Let the canary sing when something breaks.</h2>
            <p class="band__sub">Free, open source, no sign-up.</p>
          </div>
        </div>
        <ul class="band__doors">
          <li>
            <a href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener" class="door">
              <span class="door__title">Alert channel <span aria-hidden="true">↗</span></span>
              <span class="door__body">Posts critical issues on reserves holding $10K or more, and when they recover.</span>
            </a>
          </li>
          <li>
            <a href="https://t.me/OracleCanaryBot" target="_blank" rel="noopener" class="door">
              <span class="door__title">Wallet bot <span aria-hidden="true">↗</span></span>
              <span class="door__body">Messages you when a price behind one of your Kamino or marginfi loan accounts can no longer be used, and when it recovers.</span>
            </a>
          </li>
          <li class="band__app">
            <RouterLink :to="{ name: 'overview' }" class="lp-btn lp-btn--primary lp-btn--lg">Open app <span aria-hidden="true">→</span></RouterLink>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.band {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: 32px;
  align-items: center;
  padding: 28px;
  border-radius: 22px;
  border: 1px solid var(--lp-accent-line);
  background:
    radial-gradient(ellipse 60% 120% at 0% 0%, color-mix(in srgb, var(--lp-accent) 14%, transparent), transparent 70%),
    var(--lp-panel);
}
.band__intro {
  display: flex;
  gap: 18px;
  align-items: flex-start;
}
.band__mark {
  display: inline-flex;
  flex: none;
  filter: drop-shadow(0 8px 22px var(--lp-accent-glow));
}
.band__title {
  margin: 0;
  font-family: var(--lp-display);
  font-size: clamp(22px, 2.4vw, 28px);
  line-height: 1.15;
  font-weight: 600;
  letter-spacing: -0.025em;
  color: var(--lp-ink);
  text-wrap: balance;
}
.band__sub {
  margin: 8px 0 0;
  color: var(--lp-ink-2);
  font-size: 15px;
}
.band__doors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: stretch;
}
.door {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--lp-line);
  background: var(--lp-bg);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.2s;
}
.door:hover {
  border-color: var(--lp-accent-line);
}
.door__title {
  font-weight: 600;
  font-size: 15px;
  color: var(--lp-ink);
}
.door__body {
  font-size: 13px;
  line-height: 1.5;
  color: var(--lp-ink-2);
}
.band__app {
  display: flex;
  align-items: center;
}
@media (max-width: 1100px) {
  .band {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .band {
    padding: 20px 16px;
  }
  .band__doors {
    grid-template-columns: minmax(0, 1fr);
  }
  .band__app .lp-btn {
    width: 100%;
  }
}
</style>
