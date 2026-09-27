<script setup lang="ts">
/*
 * inline Tabler icon (24x24, currentColor). Matches the inline SVGs in
 * the HTML reference. Either pass a registry `name` or raw `path` markup. Size
 * and color come from CSS (the consuming class), per the token system.
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
