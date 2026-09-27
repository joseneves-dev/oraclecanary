<script setup lang="ts">
import AxIcon from '@/components/AxIcon.vue'

defineProps<{
  label: string
  value: string
  icon: string
  tone?: 'c1' | 'c2' | 'c3' | 'c4'
  hint?: string
}>()
</script>

<template>
  <div class="ax-card ax-kpi ax-col--3" role="region" :aria-label="`${label}: ${value}`">
    <div class="ax-card__body">
      <div class="ax-kpi__top">
        <span class="ax-kpi__icon" :class="`ax-kpi__icon--${tone ?? 'c1'}`">
          <AxIcon :name="icon" />
        </span>
      </div>
      <div class="ax-kpi__label">{{ label }}</div>
      <div class="ax-kpi__meta">
        <div class="ax-kpi__value ax-num">{{ value }}</div>
      </div>
      <p v-if="hint" class="ax-kpi__caption kpi-hint">{{ hint }}</p>
    </div>
  </div>
</template>

<style scoped>
/* The card body is a grid (see .ax-kpi in components.css); give the hint its own row under the value. */
.kpi-hint {
  grid-column: 1 / -1;
}
</style>
