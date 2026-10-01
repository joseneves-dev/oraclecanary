<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

/**
 * One figure on a dashboard: a micro-label, the value and an optional line under it. The value is
 * coloured only when it is bad news (`tone`), so colour on a page always means something.
 */
const props = defineProps<{
  label: string
  value: string
  tone?: 'danger' | 'warning' | 'info' | 'success'
  /** A line under the value; left out while loading so it never states a placeholder figure. */
  hint?: string | null
  /** Shows a placeholder instead of the value (and hides the hint). */
  loading?: boolean
  /** Makes the whole tile a link: only when the page it opens lists exactly what the tile counts. */
  to?: RouteLocationRaw
  /** Grid columns (of 12) the tile spans on wide screens. */
  cols?: 2 | 3 | 4 | 6
}>()

const tag = computed(() => (props.to ? RouterLink : 'div'))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    class="ax-card ax-kpi kpi"
    :class="[`ax-col--${cols ?? 3}`, { 'kpi--link': to }]"
    role="group"
    :aria-label="loading ? label : `${label}: ${value}`"
    :aria-busy="loading || undefined"
  >
    <div class="kpi__head">
      <span class="ax-kpi__label kpi__label">{{ label }}</span>
      <svg v-if="to" class="kpi__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6l-6 6" /></svg>
    </div>
    <span v-if="loading" class="ax-skeleton ax-skeleton--line kpi__skeleton" aria-hidden="true"></span>
    <div v-else class="ax-kpi__value kpi__value" :class="tone && `kpi__value--${tone}`">{{ value }}</div>
    <template v-if="!loading">
      <p v-if="$slots.default || hint" class="ax-kpi__caption kpi__hint"><slot>{{ hint }}</slot></p>
    </template>
    <span v-else class="ax-skeleton ax-skeleton--line kpi__hint-skeleton" aria-hidden="true"></span>
  </component>
</template>

<style scoped>
.kpi {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-2);
  padding: var(--ax-space-5) var(--ax-space-6);
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
.kpi--link {
  transition: border-color 0.15s;
}
.kpi--link:hover {
  border-color: var(--ax-border-strong);
}
.kpi--link:focus-visible {
  outline: 2px solid var(--ax-focus-ring, var(--ax-accent));
  outline-offset: 2px;
}
.kpi__head {
  display: flex;
  align-items: center;
  gap: var(--ax-space-2);
  min-width: 0;
}
.kpi__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi__arrow {
  width: 14px;
  height: 14px;
  margin-inline-start: auto;
  flex: 0 0 auto;
  color: var(--ax-text-subtle);
}
.kpi--link:hover .kpi__arrow {
  color: var(--ax-text-strong);
}
.kpi__value {
  overflow-wrap: anywhere;
}
.kpi__value--danger {
  color: var(--ax-danger-500);
}
.kpi__value--warning {
  color: var(--ax-warning-500);
}
.kpi__value--info {
  color: var(--ax-info-500);
}
.kpi__value--success {
  color: var(--ax-success-500);
}
.kpi__skeleton {
  width: 55%;
  height: 1.75rem;
}
.kpi__hint {
  margin: 0;
  line-height: 1.45;
}
.kpi__hint-skeleton {
  width: 80%;
}
/* Phones: two tiles a row instead of a tall stack. */
@media (max-width: 576px) {
  .kpi.ax-col--3 {
    grid-column: span 6;
  }
  .kpi {
    padding: var(--ax-space-4);
  }
  .kpi__label {
    white-space: normal;
  }
  .kpi__value {
    font-size: var(--ax-text-xl);
  }
}
</style>
