<script setup lang="ts">
/*
 * header (topbar). Native Vue re-expression of src/html/partials/header.html:
 * sidebar toggle + ⌘K command search, then the SHARED right-hand utility cluster
 * (AxHeaderUtils.vue — language, fullscreen, light/dark toggle, app-grid, cart,
 * notifications, profile, customizer trigger), which the full-screen app bar
 * (AxAppBar.vue) renders too so the two chromes can never drift.
 * Same DOM / classes / ARIA as the reference.
 */
import AxIcon from '@/components/AxIcon.vue'
import AxHeaderUtils from './AxHeaderUtils.vue'
import { useTheme } from '@/composables/useTheme'
import { useShellBus } from '@/composables/useShellBus'
import { isMobile, toggleDrawer, drawerOpen } from '@/composables/useDrawer'

const theme = useTheme()
const bus = useShellBus()

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

    <!-- 2 · COMMAND SEARCH (⌘K trigger) -->
    <button type="button" class="ax-search" @click="bus.openCommand()" aria-haspopup="dialog" aria-controls="ax-command" aria-label="Search or jump to">
      <AxIcon class="ax-icon ax-search__icon" name="search" />
      <span class="ax-search__placeholder">Search or jump to…</span>
      <kbd class="ax-search__keycap">⌘K</kbd>
    </button>

    <span class="ax-header__spacer"></span>

    <!-- ===== RIGHT UTILITY CLUSTER =====
         Shared with the full-screen app bar (AxAppBar.vue). Items 4–11. -->
    <AxHeaderUtils />
  </header>
</template>
