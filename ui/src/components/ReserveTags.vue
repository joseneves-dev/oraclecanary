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
  {
    code: 'FIXED_PRICE',
    label: 'Fixed price',
    badge: 'ax-badge--neutral',
    fallbackTitle: 'The price is a fixed value set by the protocol and does not follow the market.',
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
    <!-- The explanation is a tooltip for the mouse and hidden text for screen readers. -->
    <span v-for="tag in tags" :key="tag.code" class="ax-badge ax-badge--soft ax-badge--pill tag" :class="tag.badge" :title="tag.title">
      {{ tag.label }}<span class="ax-visually-hidden">: {{ tag.title }}</span>
    </span>
  </span>
  <template v-else-if="!hideEmpty">
    <span class="none" aria-hidden="true">—</span><span class="ax-visually-hidden">No tags</span>
  </template>
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
