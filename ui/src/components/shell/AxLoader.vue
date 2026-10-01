<script setup lang="ts">
/*
 * Page preloader: a full-screen overlay removed right after the first paint.
 */
import { ref, onMounted } from 'vue'

const hidden = ref(false)
const removed = ref(document.documentElement.getAttribute('data-ax-loader') === 'off')

onMounted(() => {
  if (removed.value) return
  requestAnimationFrame(() => {
    hidden.value = true
    setTimeout(() => (removed.value = true), 600)
  })
})
</script>

<template>
  <div v-if="!removed" class="ax-loader" :class="{ 'is-hidden': hidden }" data-ax-loader-el role="status" aria-live="polite" aria-label="Loading">
    <span class="ax-spinner ax-spinner--lg" aria-hidden="true"><span class="ax-spinner__glyph"></span></span>
  </div>
</template>
