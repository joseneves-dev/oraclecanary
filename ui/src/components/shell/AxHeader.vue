<script setup lang="ts">
/*
 * App header: sidebar toggle, network pill and a way back to the front page on
 * the left; the theme toggle and the Telegram call to action on the right.
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

    <span class="oc-live" title="Reading Solana mainnet">
      <span class="oc-live__dot" aria-hidden="true"></span>
      <span class="oc-live__net">Solana </span>mainnet
    </span>

    <RouterLink class="oc-header-link" to="/"><span aria-hidden="true">←</span> Site</RouterLink>

    <span class="ax-header__spacer"></span>

    <AxHeaderUtils />

    <a class="ax-btn ax-btn--primary ax-btn--sm oc-header-cta" href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener">
      <AxIcon class="ax-btn__icon" name="brand-telegram" />
      <span class="ax-btn__label">Get alerts</span>
    </a>
  </header>
</template>
