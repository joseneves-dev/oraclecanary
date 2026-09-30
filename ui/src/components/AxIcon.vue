<script setup lang="ts">
/*
 * Inline Tabler icon (24x24, currentColor). Either pass a registry `name` or raw
 * `path` markup. Size and colour come from the consuming class.
 */
import { computed } from 'vue'
import { iconPath } from '@/lib/icons'

const props = defineProps<{
  name?: string
  path?: string
  size?: number | string
}>()

const inner = computed(() => props.path ?? iconPath(props.name))
const dim = computed(() => props.size ?? 24)
</script>

<template>
  <svg
    :class="$attrs.class"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="dim"
    :height="dim"
    aria-hidden="true"
    v-html="inner"
  />
</template>
