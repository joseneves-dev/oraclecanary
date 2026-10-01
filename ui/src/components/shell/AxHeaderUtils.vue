<script setup lang="ts">
/* Right-hand utility cluster of the header: the light/dark toggle. */
import AxIcon from '@/components/AxIcon.vue'
import { useTheme } from '@/composables/useTheme'

const theme = useTheme()
</script>

<template>
  <button type="button" class="ax-theme-toggle ax-icon-btn" data-ax-toggle="theme" @click="theme.toggleTheme()" :aria-label="theme.state.resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
    <AxIcon v-if="theme.state.resolved === 'dark'" class="ax-icon" name="sun" />
    <AxIcon v-else class="ax-icon" name="moon" />
  </button>
</template>
