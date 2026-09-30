<script setup lang="ts">
/*
 * Application shell: loader, the faint canary ambient light, and .ax-layout
 * (sidebar + .ax-shell: header, main, footer). Pages render into <main>.
 */
import { watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AxLoader from '@/components/shell/AxLoader.vue'
import AxSidebar from '@/components/shell/AxSidebar.vue'
import AxHeader from '@/components/shell/AxHeader.vue'
import AxFooter from '@/components/shell/AxFooter.vue'
import { useDrawer } from '@/composables/useDrawer'

const drawer = useDrawer()
const route = useRoute()

// The reference closes the drawer by navigating away (full page load). In an SPA
// the sidebar link only swaps the view, so the drawer has to be dismissed here.
watch(() => route.fullPath, () => drawer.closeDrawer())
</script>

<template>
  <AxLoader />
  <div class="ax-ambient" aria-hidden="true"><i></i></div>
  <div class="ax-layout">
    <AxSidebar />
    <!-- Drawer scrim — a SIBLING of .ax-sidebar, inside the isolated .ax-layout
         stacking context, so it paints under the open drawer (900 < 1100) rather
         than over it. Its hidden resting state is base.css's
         `.ax-backdrop[data-ax-drawer-scrim]` pair; `is-visible` reveals it. -->
    <div
      class="ax-backdrop"
      data-ax-drawer-scrim
      :class="{ 'is-visible': drawer.open.value }"
      aria-hidden="true"
      @click="drawer.closeDrawer()"
    ></div>
    <div class="ax-shell">
      <AxHeader />
      <main class="ax-main" id="ax-main">
        <RouterView />
      </main>
      <AxFooter />
    </div>
  </div>
</template>
