<script setup lang="ts">
import { RouterLink } from 'vue-router'
import CanaryMark from './CanaryMark.vue'

const REPO = 'https://github.com/joseneves-dev/oraclecanary'
</script>

<template>
  <footer class="foot">
    <div class="lp-wrap">
      <div class="foot__grid">
        <div class="foot__brand">
          <RouterLink to="/" class="foot__logo" aria-label="OracleCanary home">
            <CanaryMark :size="30" />
            <span>OracleCanary</span>
          </RouterLink>
          <p>The canary in the coal mine for Solana lending.</p>
          <p class="foot__small">An independent, open-source monitor of the oracles behind Kamino, marginfi and Jupiter Lend.</p>
        </div>
        <nav class="foot__col" aria-label="Product">
          <h3>Product</h3>
          <RouterLink :to="{ name: 'overview' }">Dashboard</RouterLink>
          <RouterLink :to="{ name: 'reserves' }">Reserves</RouterLink>
          <RouterLink :to="{ name: 'incidents' }">Incidents</RouterLink>
          <RouterLink :to="{ name: 'positions' }">My positions</RouterLink>
          <RouterLink :to="{ name: 'how-it-works' }">How it works</RouterLink>
        </nav>
        <nav class="foot__col" aria-label="Developers">
          <h3>Developers</h3>
          <a href="/api/docs">API docs</a>
          <RouterLink to="/how-it-works#guard">Guard (devnet)</RouterLink>
          <a :href="REPO" target="_blank" rel="noopener">GitHub</a>
        </nav>
        <nav class="foot__col" aria-label="Follow">
          <h3>Follow</h3>
          <a href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener">Telegram alerts</a>
          <a href="https://t.me/OracleCanaryBot" target="_blank" rel="noopener">Telegram bot</a>
          <a href="https://x.com/OracleCanary_" target="_blank" rel="noopener">X</a>
          <a href="mailto:hello@oraclecanary.com">hello@oraclecanary.com</a>
        </nav>
      </div>
      <div class="foot__base">
        <span>Data read from Solana mainnet. The on-chain guard runs on devnet only. For information, not financial advice.</span>
        <span>MIT license</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.foot {
  border-top: 1px solid var(--lp-line);
  padding: 56px 0 28px;
  background: var(--lp-bg-deep);
}
.foot__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(0, 1fr));
  gap: 32px;
}
.foot__logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--lp-ink);
  text-decoration: none;
  font-family: var(--lp-display);
  font-weight: 700;
  font-size: 18px;
  letter-spacing: -0.02em;
}
.foot__brand p {
  margin: 14px 0 0;
  color: var(--lp-ink-2);
  font-size: 14px;
  max-width: 36ch;
}
.foot__brand .foot__small {
  margin-top: 8px;
  color: var(--lp-ink-3);
  font-size: 13px;
}
.foot__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.foot__col h3 {
  margin: 0 0 4px;
  font-family: var(--lp-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--lp-ink-3);
}
.foot__col a {
  color: var(--lp-ink-2);
  text-decoration: none;
  font-size: 14px;
  width: fit-content;
  overflow-wrap: anywhere;
}
.foot__col a:hover {
  color: var(--lp-accent-text);
}
.foot__base {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 24px;
  margin-top: 48px;
  padding-top: 20px;
  border-top: 1px solid var(--lp-line);
  color: var(--lp-ink-3);
  font-size: 12.5px;
}
@media (max-width: 860px) {
  .foot__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .foot__brand {
    grid-column: 1 / -1;
  }
}
</style>
