<script setup lang="ts">
/*
 * Vireo — header (topbar). Native Vue re-expression of src/html/partials/header.html:
 * sidebar toggle, then the SHARED right-hand utility cluster
 * (AxHeaderUtils.vue — fullscreen and light/dark toggle).
 * Same DOM / classes / ARIA as the reference.
 */
import AxIcon from '@/components/AxIcon.vue'
import AxHeaderUtils from './AxHeaderUtils.vue'
import { useTheme } from '@/composables/useTheme'
import { isMobile, toggleDrawer, drawerOpen } from '@/composables/useDrawer'

const theme = useTheme()

// Same branch as the reference's axHeader.toggleSidebar(): below the drawer band
// the rail is off-canvas, so the toggle opens the DRAWER instead of flipping the
// (invisible) collapse state.
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
    <!-- 1 · SIDEBAR TOGGLE -->
    <button type="button" class="ax-nav-toggle ax-icon-btn" @click="onToggle" aria-label="Toggle menu" :aria-expanded="drawerOpen || !theme.state.collapsed">
      <AxIcon class="ax-icon" name="menu" />
    </button>

    <span class="ax-header__spacer"></span>

    <!-- ===== RIGHT UTILITY CLUSTER =====
         Shared with the full-screen app bar (AxAppBar.vue). Items 4–11. -->
    <AxHeaderUtils />
  </header>
</template>
