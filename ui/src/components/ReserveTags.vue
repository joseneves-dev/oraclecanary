<script setup lang="ts">
import { computed } from 'vue'
import { checkMessage } from '@/lib/format'
import { TAGS } from '@/lib/tags'

/** The context tags of a reserve (see lib/tags.ts). */
const props = defineProps<{
  checks: { code: string; message?: string }[]
  /** Render nothing instead of a dash when there is no tag (outside tables). */
  hideEmpty?: boolean
}>()

const tags = computed(() =>
  TAGS.flatMap((tag) => {
    const check = props.checks.find((c) => c.code === tag.code)
    return check ? [{ ...tag, title: check.message ? checkMessage(check.message) : tag.fallbackTitle }] : []
  }),
)
</script>

<template>
  <span v-if="tags.length" class="tags">
    <!-- The explanation is a tooltip for the mouse and hidden text for screen readers. -->
    <span v-for="tag in tags" :key="tag.code" class="ax-badge ax-badge--pill tag" :class="tag.badge" :title="tag.title">
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
