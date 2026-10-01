<script setup lang="ts">
import type { Severity } from '@/api/client'
import { HEALTH_BADGE, HEALTH_LABEL } from '@/lib/format'
import type { HealthState } from '@/lib/priceState'

/** A health level as a badge. Pass a reserve's healthState(), so a market-hours pause reads as paused. */
defineProps<{ severity: Severity | HealthState }>()
</script>

<template>
  <span class="ax-badge ax-badge--soft ax-badge--pill" :class="HEALTH_BADGE[severity]">{{ HEALTH_LABEL[severity] }}</span>
</template>
