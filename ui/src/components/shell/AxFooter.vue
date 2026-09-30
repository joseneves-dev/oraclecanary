<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AxIcon from '@/components/AxIcon.vue'

// Tabler "brand-x" outline.
const X_PATH = '<path d="M4 4l11.733 16h4.267l-11.733 -16z"/><path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"/>'
</script>

<template>
  <footer class="ax-footer">
    <p class="oc-footer">
      <span>© 2026 OracleCanary</span>
      <span class="oc-footer__sep" aria-hidden="true">·</span>
      <span>Data from Solana mainnet</span>
    </p>
    <nav class="oc-footer oc-footer__links" aria-label="Footer">
      <RouterLink :to="{ name: 'how-it-works' }">How it works</RouterLink>
      <a href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener">Telegram</a>
      <a href="/api/docs" target="_blank" rel="noopener">API</a>
      <a href="https://github.com/joseneves-dev/oraclecanary" target="_blank" rel="noopener">GitHub</a>
      <a class="oc-footer__icon" href="https://x.com/OracleCanary_" target="_blank" rel="noopener" aria-label="OracleCanary on X">
        <AxIcon :path="X_PATH" :size="14" />
      </a>
    </nav>
  </footer>
</template>
