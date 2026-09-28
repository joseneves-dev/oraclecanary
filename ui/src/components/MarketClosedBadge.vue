<script setup lang="ts">
import { computed } from 'vue'

/** Shown next to a stale tokenized stock whose price stopped because the US stock market closed. */
const props = defineProps<{ checks: { code: string; message?: string }[] }>()

const check = computed(() => props.checks.find((c) => c.code === 'MARKET_CLOSED'))
</script>

<template>
  <span
    v-if="check"
    class="ax-badge ax-badge--soft ax-badge--pill ax-badge--info market-closed"
    :title="check.message || 'The US stock market was closed, so the price was not updating: expected, but the protocol still rejects it.'"
  >Market closed</span>
</template>

<style scoped>
.market-closed {
  white-space: nowrap;
}
</style>
