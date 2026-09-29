<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <footer class="ax-footer">
    <div class="ax-footer__left">
      <span class="ax-footer__copy">© 2026 OracleCanary</span>
      <span class="ax-footer__sep" aria-hidden="true">·</span>
      <span class="ax-footer__version ax-mono">Data from Solana mainnet</span>
    </div>
    <nav class="ax-footer__links" aria-label="Footer">
      <RouterLink class="ax-footer__link" :to="{ name: 'how-it-works' }">How it works</RouterLink>
      <a class="ax-footer__link" href="https://x.com/OracleCanary_" target="_blank" rel="noopener">X</a>
      <a class="ax-footer__link" href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener">Telegram alerts</a>
      <a class="ax-footer__link" href="/api/docs" target="_blank" rel="noopener">API</a>
      <a class="ax-footer__link" href="https://github.com/joseneves-dev/oraclecanary" target="_blank" rel="noopener">GitHub</a>
    </nav>
  </footer>
</template>
