<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="page">
    <header class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <h1 class="ax-page-head__title">Page not found</h1>
          <p class="ax-page-head__subtitle">There is nothing at this address. It may have moved, or the link may be mistyped.</p>
        </div>
      </div>
    </header>

    <section class="ax-card lost">
      <svg class="lost__mark" viewBox="0 0 32 32" width="48" height="48" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="oc-404-mark" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop stop-color="#FDE047" />
            <stop offset="0.6" stop-color="#FACC15" />
            <stop offset="1" stop-color="#F59E0B" />
          </linearGradient>
        </defs>
        <path d="M4 4 H16 A12 12 0 0 1 28 16 V28 H16 A12 12 0 0 1 4 16 V4 Z" fill="url(#oc-404-mark)" />
        <path d="M28 11 L31 12.5 L28 14 Z" fill="#F97316" />
        <circle cx="20.5" cy="11.5" r="2.6" fill="#0A0C11" fill-opacity="0.92" />
      </svg>
      <div class="lost__text">
        <h2 class="lost__title">Where to go from here</h2>
        <p class="lost__lede">The live health of every Solana lending oracle is one click away.</p>
      </div>
      <nav class="lost__links" aria-label="Where to go">
        <RouterLink class="ax-btn ax-btn--primary ax-btn--sm" :to="{ name: 'overview' }">Overview</RouterLink>
        <RouterLink class="ax-btn ax-btn--secondary ax-btn--sm" :to="{ name: 'reserves' }">Reserves</RouterLink>
        <RouterLink class="ax-btn ax-btn--secondary ax-btn--sm" :to="{ name: 'positions' }">Check a wallet</RouterLink>
      </nav>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-6);
}
.page > .ax-page-head {
  margin-block-end: 0;
}
.lost {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-5);
  padding: var(--ax-space-6);
}
.lost__mark {
  flex: 0 0 auto;
}
.lost__text {
  flex: 1 1 260px;
}
.lost__title {
  margin: 0;
  font-size: var(--ax-text-lg);
  font-weight: var(--ax-weight-semibold);
  color: var(--ax-text-strong);
}
.lost__lede {
  margin: var(--ax-space-1) 0 0;
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.lost__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-2);
}
</style>
