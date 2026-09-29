<script setup lang="ts">
/** The four outcomes a wallet check can show for a position, as a short legend. */
defineProps<{ title?: string }>()
</script>

<template>
  <aside class="legend" :aria-label="title ?? 'What a wallet check shows'">
    <span class="ax-eyebrow">{{ title ?? "What you'll see for each position" }}</span>
    <ul>
      <li>
        <span class="legend__dot legend__dot--danger"></span>
        <span><b>Blocked</b> The protocol cannot use the price: the loan account cannot borrow, withdraw or be liquidated.</span>
      </li>
      <li>
        <span class="legend__dot legend__dot--info"></span>
        <span><b>Paused</b> A tokenized stock outside US market hours: expected, but the same freeze.</span>
      </li>
      <li>
        <span class="legend__dot legend__dot--warning"></span>
        <span><b>Weak</b> Usable now, but fragile, e.g. a single oracle with no fallback.</span>
      </li>
      <li>
        <span class="legend__dot legend__dot--success"></span>
        <span><b>Healthy</b> A fresh price with nothing flagged.</span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.legend {
  flex: 0 1 360px;
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-3);
  padding: var(--ax-space-5);
  border: 1px solid var(--ax-border);
  border-radius: var(--ax-radius-lg);
  background: var(--ax-surface-subtle);
}
ul {
  display: grid;
  gap: var(--ax-space-3);
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
li {
  display: flex;
  gap: var(--ax-space-2);
  align-items: baseline;
}
b {
  color: var(--ax-text-strong);
  margin-inline-end: var(--ax-space-1);
}
.legend__dot {
  flex: 0 0 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateY(-1px);
}
.legend__dot--danger {
  background: var(--ax-danger-500);
}
.legend__dot--info {
  background: var(--ax-info-500);
}
.legend__dot--warning {
  background: var(--ax-warning-500);
}
.legend__dot--success {
  background: var(--ax-success-500);
}
</style>
