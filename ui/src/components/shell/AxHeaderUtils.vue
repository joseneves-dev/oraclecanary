<script setup lang="ts">
/*
 * Right-hand utility cluster of the header: API docs link, fullscreen,
 * light/dark toggle and the theme customizer.
 *
 * The trailing "More" control is the responsive shed: below 992px shell.css hides
 * .ax-fullscreen in the bar and below 768px .ax-cog too, revealing the matching
 * [data-ax-shed] row inside .ax-overflow__menu instead, so every control keeps
 * exactly one reachable copy.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import AxIcon from '@/components/AxIcon.vue'
import { useTheme } from '@/composables/useTheme'
import { useDropdown } from '@/composables/useDropdown'
import { useShellBus } from '@/composables/useShellBus'
import { useHeaderShed } from '@/composables/useHeaderShed'

const theme = useTheme()
const bus = useShellBus()
const overflow = useDropdown()
const shed = useHeaderShed()

const full = ref(false)
function onFsChange() {
  full.value = !!document.fullscreenElement
}
onMounted(() => document.addEventListener('fullscreenchange', onFsChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFsChange))
function toggleFullscreen() {
  if (!document.documentElement.requestFullscreen) return
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen()
}
</script>

<template>
  <a class="ax-icon-btn" href="/api/docs" target="_blank" rel="noopener" aria-label="API documentation" title="API documentation">
    <AxIcon class="ax-icon" name="book" />
  </a>

  <button type="button" class="ax-fullscreen ax-icon-btn" @click="toggleFullscreen" :aria-pressed="full" aria-label="Toggle fullscreen">
    <AxIcon v-if="!full" class="ax-icon" name="maximize" />
    <AxIcon v-else class="ax-icon" name="minimize" />
  </button>

  <button type="button" class="ax-theme-toggle ax-icon-btn" data-ax-toggle="theme" @click="theme.toggleTheme()" :aria-pressed="theme.state.resolved === 'dark'" aria-label="Toggle dark mode">
    <AxIcon v-if="theme.state.resolved === 'dark'" class="ax-icon" name="sun" />
    <AxIcon v-else class="ax-icon" name="moon" />
  </button>

  <button type="button" class="ax-cog ax-icon-btn" data-ax-toggle="customizer" @click="bus.openCustomizer()" aria-haspopup="dialog" aria-controls="ax-customizer" aria-label="Open theme customizer">
    <AxIcon class="ax-icon" name="cog" />
  </button>

  <div v-show="shed.includes('fullscreen') || shed.includes('customizer')" class="ax-overflow" :ref="(el) => (overflow.root.value = el as HTMLElement)">
    <button type="button" class="ax-icon-btn ax-overflow__trigger" @click="overflow.toggle()" aria-haspopup="menu" :aria-expanded="overflow.open.value" aria-controls="ax-overflow-menu" aria-label="More">
      <AxIcon class="ax-icon" name="dots-vertical" />
    </button>
    <div v-show="overflow.open.value" id="ax-overflow-menu" class="ax-dropdown ax-overflow__menu" role="menu">
      <button type="button" class="ax-dropdown__item" role="menuitem" data-ax-shed="fullscreen" @click="toggleFullscreen(); overflow.close()">
        <AxIcon class="ax-icon ax-dropdown__lead" name="maximize" />
        <span>{{ full ? 'Exit fullscreen' : 'Fullscreen' }}</span>
      </button>
      <button type="button" class="ax-dropdown__item" role="menuitem" data-ax-shed="customizer" @click="overflow.close(); bus.openCustomizer()">
        <AxIcon class="ax-icon ax-dropdown__lead" name="cog" />
        <span>Customize theme</span>
      </button>
    </div>
  </div>
</template>
