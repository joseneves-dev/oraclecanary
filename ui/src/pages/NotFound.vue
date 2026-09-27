<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="not-found">
    <h1 class="ax-page-head__title">Page not found</h1>
    <p>This page does not exist.</p>
    <RouterLink to="/" class="ax-btn ax-btn--secondary ax-btn--sm">Go to the overview</RouterLink>
  </div>
</template>

<style scoped>
.not-found {
  padding: var(--ax-space-10) var(--ax-space-5);
  display: grid;
  gap: var(--ax-space-3);
  justify-items: start;
}
</style>
