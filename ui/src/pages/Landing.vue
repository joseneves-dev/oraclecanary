<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="landing">
    <h1>OracleCanary</h1>
    <RouterLink :to="{ name: 'overview' }">Open app</RouterLink>
  </main>
</template>
