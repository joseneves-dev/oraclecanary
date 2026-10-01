<script setup lang="ts">
/*
 * App header: sidebar toggle and network pill on the left; the theme toggle and
 * the Telegram call to action on the right. The way back to the front page is
 * the canary logo — in the sidebar on desktop, here in the bar on phones (where
 * the sidebar is a closed drawer).
 */
import { RouterLink } from 'vue-router'
import AxIcon from '@/components/AxIcon.vue'
import AxHeaderUtils from './AxHeaderUtils.vue'
import { useTheme } from '@/composables/useTheme'
import { isMobile, toggleDrawer, drawerOpen } from '@/composables/useDrawer'

const theme = useTheme()

// Below the drawer breakpoint the rail is off-canvas, so the toggle opens the
// drawer instead of flipping the (invisible) collapse state.
function onToggle(): void {
  if (isMobile()) {
    toggleDrawer()
    return
  }
  theme.toggleSidebar()
}
</script>

<template>
  <header class="ax-header" role="banner">
    <button type="button" class="ax-nav-toggle ax-icon-btn" @click="onToggle" aria-label="Toggle menu" :aria-expanded="drawerOpen || !theme.state.collapsed">
      <AxIcon class="ax-icon" name="menu" />
    </button>

    <RouterLink class="oc-header-home" to="/" aria-label="OracleCanary — back to the site">
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true"><path d="M4 4 H16 A12 12 0 0 1 28 16 V28 H16 A12 12 0 0 1 4 16 V4 Z" fill="#FACC15"/><path d="M28 11 L31 12.5 L28 14 Z" fill="#F97316"/><circle cx="20.5" cy="11.5" r="2.6" fill="#0D0C0A"/></svg>
    </RouterLink>

    <span class="oc-live" title="Reading Solana mainnet">
      <span class="oc-live__dot" aria-hidden="true"></span>
      <span class="oc-live__net">Solana </span>mainnet
    </span>

    <span class="ax-header__spacer"></span>

    <AxHeaderUtils />

    <a class="ax-btn ax-btn--primary ax-btn--sm oc-header-cta" href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener">
      <AxIcon class="ax-btn__icon" name="brand-telegram" />
      <span class="ax-btn__label">Get alerts</span>
    </a>
  </header>
</template>
