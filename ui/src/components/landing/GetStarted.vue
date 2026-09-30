<script setup lang="ts">
/* Where to go next: four doors into the product. */
import { RouterLink } from 'vue-router'
import CanaryMark from './CanaryMark.vue'

const doors = [
  { key: 'app', title: 'Open the dashboard', body: 'Every listed reserve, its score and what is failing, updated every five minutes.', to: '/app', cta: 'Open app' },
  { key: 'wallet', title: 'Check a wallet', body: 'Paste an address to see which positions rely on a broken price, and their liquidation prices.', to: '/positions', cta: 'My positions' },
  { key: 'bot', title: 'Watch it on Telegram', body: 'The bot messages you when a price behind one of your positions breaks.', href: 'https://t.me/OracleCanaryBot', cta: '@OracleCanaryBot' },
  { key: 'channel', title: 'Follow every incident', body: 'The public channel posts each incident as it opens and when it ends.', href: 'https://t.me/OracleCanaryAlerts', cta: 'Alert channel' },
] as const
</script>

<template>
  <section class="lp-section lp-section--start" aria-labelledby="start-title">
    <div class="lp-wrap">
      <div class="start">
        <div class="start__intro">
          <span class="start__mark" aria-hidden="true"><CanaryMark :size="56" /></span>
          <span class="lp-kicker">Get started</span>
          <h2 id="start-title" class="lp-h2">Free, open source, no sign-up.</h2>
          <p class="lp-lede">Look before you lend, or let the canary sing when something breaks.</p>
        </div>
        <ul class="doors">
          <li v-for="(d, i) in doors" :key="d.key" :class="{ 'door--main': i === 0 }">
            <component
              :is="'href' in d ? 'a' : RouterLink"
              v-bind="'href' in d ? { href: d.href, target: '_blank', rel: 'noopener' } : { to: d.to }"
              class="door"
            >
              <span class="door__title">{{ d.title }}</span>
              <span class="door__body">{{ d.body }}</span>
              <span class="door__cta">{{ d.cta }} <span aria-hidden="true">→</span></span>
            </component>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.start {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.6fr);
  gap: 48px;
  align-items: start;
}
.start__intro {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.start__mark {
  display: inline-flex;
  width: fit-content;
  margin-bottom: 10px;
  filter: drop-shadow(0 10px 28px var(--lp-accent-glow));
}
.doors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.door {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 22px;
  border-radius: 18px;
  border: 1px solid var(--lp-line);
  background: var(--lp-panel);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.door:hover {
  border-color: var(--lp-accent-line);
  transform: translateY(-2px);
  box-shadow: 0 16px 36px -22px var(--lp-accent-glow);
}
.door:focus-visible {
  outline: 2px solid var(--lp-accent);
  outline-offset: 2px;
}
.door__title {
  font-family: var(--lp-display);
  font-size: 19px;
  font-weight: 600;
  color: var(--lp-ink);
  letter-spacing: -0.015em;
}
.door__body {
  color: var(--lp-ink-2);
  font-size: 14px;
  line-height: 1.55;
  flex: 1;
}
.door__cta {
  margin-top: 8px;
  font-family: var(--lp-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--lp-accent-text);
}
.door--main .door {
  background: var(--lp-accent);
  border-color: var(--lp-accent);
}
.door--main .door__title,
.door--main .door__cta {
  color: #1a1400;
}
.door--main .door__body {
  color: rgba(26, 20, 0, 0.72);
}
@media (max-width: 960px) {
  .start {
    grid-template-columns: 1fr;
    gap: 28px;
  }
}
@media (max-width: 560px) {
  .doors {
    grid-template-columns: 1fr;
  }
}
</style>
