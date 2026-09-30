<script setup lang="ts">
/* The OracleCanary logo mark (same drawing as the app sidebar). */
import { useId } from 'vue'

withDefaults(defineProps<{ size?: number }>(), { size: 28 })
const gid = `ocmk-${useId()}`
</script>

<template>
  <svg viewBox="0 0 32 32" :width="size" :height="size" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient :id="gid" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FDE047" />
        <stop offset="0.6" stop-color="#FACC15" />
        <stop offset="1" stop-color="#F59E0B" />
      </linearGradient>
    </defs>
    <path d="M4 4 H16 A12 12 0 0 1 28 16 V28 H16 A12 12 0 0 1 4 16 V4 Z" :fill="`url(#${gid})`" />
    <path d="M28 11 L31 12.5 L28 14 Z" fill="#F97316" />
    <circle cx="20.5" cy="11.5" r="2.6" fill="#0A0C11" fill-opacity="0.92" />
  </svg>
</template>
