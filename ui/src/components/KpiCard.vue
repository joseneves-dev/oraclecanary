<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import AxIcon from '@/components/AxIcon.vue'

/**
 * One figure on a dashboard. The icon stays neutral; the value is coloured only when it is bad
 * news (`tone`), so colour on a page always means something.
 */
const props = defineProps<{
  label: string
  value: string
  icon: string
  tone?: 'danger' | 'warning' | 'success'
  hint?: string
  /** Shows a placeholder instead of the value. */
  loading?: boolean
  /** Makes the whole tile a link. */
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
      <span class="kpi__icon"><AxIcon :name="icon" :size="16" /></span>
      <span class="kpi__label">{{ label }}</span>
      <svg v-if="to" class="kpi__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6l-6 6" /></svg>
    </div>
    <span v-if="loading" class="ax-skeleton ax-skeleton--line kpi__skeleton" aria-hidden="true"></span>
    <div v-else class="kpi__value ax-num" :class="tone && `kpi__value--${tone}`">{{ value }}</div>
    <p v-if="$slots.default || hint" class="kpi__hint"><slot>{{ hint }}</slot></p>
  </component>
</template>

<style scoped>
.kpi {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-2);
  padding: var(--ax-space-4) var(--ax-space-5);
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
  outline: 2px solid var(--ax-accent);
  outline-offset: 2px;
}
.kpi__head {
  display: flex;
  align-items: center;
  gap: var(--ax-space-2);
  min-width: 0;
}
.kpi__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: var(--ax-radius-sm);
  color: var(--ax-text-muted);
  background: var(--ax-surface-subtle);
  border: 1px solid var(--ax-border);
}
.kpi__label {
  font-size: var(--ax-text-xs);
  font-weight: var(--ax-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ax-text-muted);
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
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-2xl);
  line-height: 1.15;
  font-weight: var(--ax-weight-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--ax-text-strong);
  overflow-wrap: anywhere;
}
.kpi__value--danger {
  color: var(--ax-danger-500);
}
.kpi__value--warning {
  color: var(--ax-warning-500);
}
.kpi__value--success {
  color: var(--ax-success-500);
}
.kpi__skeleton {
  width: 55%;
  height: 1.75rem;
  margin-block: 1px;
}
/* Phones: two tiles a row instead of a tall stack. */
@media (max-width: 576px) {
  .kpi.ax-col--3 {
    grid-column: span 6;
  }
  .kpi {
    padding: var(--ax-space-3) var(--ax-space-4);
  }
  .kpi__value {
    font-size: var(--ax-text-xl);
  }
  .kpi__icon {
    display: none;
  }
  .kpi__label {
    white-space: normal;
  }
}
.kpi__hint {
  margin: 0;
  font-size: var(--ax-text-xs);
  line-height: 1.45;
  color: var(--ax-text-subtle);
}
</style>
