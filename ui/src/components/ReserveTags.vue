<script setup lang="ts">
import { computed } from 'vue'

/**
 * Context about a reserve that is not a problem of its own, derived from its checks. Add a tag to
 * TAGS to show it wherever reserves are listed.
 */
const props = defineProps<{
  checks: { code: string; message?: string }[]
  /** Render nothing instead of a dash when there is no tag (outside tables). */
  hideEmpty?: boolean
}>()

const TAGS: { code: string; label: string; badge: string; fallbackTitle: string }[] = [
  {
    code: 'MARKET_CLOSED',
    label: 'Market closed',
    badge: 'ax-badge--info',
    fallbackTitle: 'The US stock market was closed, so the price was not updating: expected, but the protocol still rejects it.',
  },
]

const tags = computed(() =>
  TAGS.flatMap((tag) => {
    const check = props.checks.find((c) => c.code === tag.code)
    return check ? [{ ...tag, title: check.message || tag.fallbackTitle }] : []
  }),
)
</script>

<template>
  <span v-if="tags.length" class="tags">
    <span v-for="tag in tags" :key="tag.code" class="ax-badge ax-badge--soft ax-badge--pill tag" :class="tag.badge" :title="tag.title">{{ tag.label }}</span>
  </span>
  <span v-else-if="!hideEmpty" class="none" aria-label="No tags">—</span>
</template>

<style scoped>
.tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--ax-space-1);
}
.tag {
  white-space: nowrap;
}
.none {
  color: var(--ax-text-muted);
}
</style>
