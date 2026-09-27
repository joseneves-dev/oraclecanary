<script setup lang="ts">
import type { Severity } from '@/api/client'
import { SEVERITY_BADGE, SEVERITY_LABEL } from '@/lib/format'

defineProps<{ severity: Severity }>()
</script>

<template>
  <span class="ax-badge ax-badge--soft ax-badge--pill" :class="SEVERITY_BADGE[severity]">{{ SEVERITY_LABEL[severity] }}</span>
</template>
