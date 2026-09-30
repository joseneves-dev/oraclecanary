<script setup lang="ts">
import AxIcon from '@/components/AxIcon.vue'

const ICON = { clear: 'check', none: 'search', error: 'alert-triangle' } as const

/**
 * What a list shows when it has nothing in it. `clear` is good news (nothing is broken) and
 * carries a check in the success colour; `none` is a neutral "no results"; `error` is data that
 * could not be loaded (pair it with a Retry action).
 */
withDefaults(defineProps<{ title: string; tone?: 'clear' | 'none' | 'error'; compact?: boolean }>(), { tone: 'clear', compact: false })
</script>

<template>
  <div class="empty" :class="[`empty--${tone}`, { 'empty--compact': compact }]" :role="tone === 'error' ? 'alert' : 'status'">
    <span class="empty__icon" aria-hidden="true"><AxIcon :name="ICON[tone]" :size="18" /></span>
    <p class="empty__title">{{ title }}</p>
    <p v-if="$slots.default" class="empty__text"><slot /></p>
    <div v-if="$slots.actions" class="empty__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ax-space-2);
  padding: var(--ax-space-8) var(--ax-space-5);
  text-align: center;
}
.empty--compact {
  padding-block: var(--ax-space-6);
}
.empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-bottom: var(--ax-space-1);
  border-radius: 50%;
  color: var(--ax-text-muted);
  background: var(--ax-surface-subtle);
  border: 1px solid var(--ax-border);
}
.empty--clear .empty__icon {
  color: var(--ax-success-500);
  background: color-mix(in srgb, var(--ax-success-500) 12%, transparent);
  border-color: color-mix(in srgb, var(--ax-success-500) 30%, transparent);
}
.empty--error .empty__icon {
  color: var(--ax-danger-500);
  background: color-mix(in srgb, var(--ax-danger-500) 10%, transparent);
  border-color: color-mix(in srgb, var(--ax-danger-500) 25%, transparent);
}
.empty__title {
  margin: 0;
  font-weight: var(--ax-weight-semibold);
  color: var(--ax-text-strong);
}
.empty__text {
  margin: 0;
  max-width: 52ch;
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.empty__actions {
  margin-top: var(--ax-space-2);
}
</style>
