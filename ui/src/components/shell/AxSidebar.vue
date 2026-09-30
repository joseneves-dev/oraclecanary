<script setup lang="ts">
/*
 * Sidebar: the wordmark (links back to the front page), the manifest's sections
 * as a flat list of links, and a data-source note. The menu has no nested groups,
 * so it is a plain <nav> list that works with the normal Tab order.
 */
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AxIcon from '@/components/AxIcon.vue'
import { buildSidebar, resolveActive } from '@/composables/useNav'
import { currentSlug } from '@/lib/manifest'

const sections = buildSidebar()
const route = useRoute()

const slug = computed(() => currentSlug((route.meta.slug as string) || route.path.replace(/^\//, '') || 'overview'))
const activeId = computed(() => resolveActive(slug.value).activeId)
</script>

<template>
  <aside class="ax-sidebar" role="navigation" aria-label="Primary">
    <!-- BRAND -->
    <div class="ax-sidebar__brand">
      <RouterLink class="ax-sidebar__logo" to="/" aria-label="OracleCanary — back to the site">
        <span class="ax-sidebar__mark" aria-hidden="true">
          <svg class="ax-icon" viewBox="0 0 32 32" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="ocmk0" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop stop-color="#FDE047"/><stop offset="0.6" stop-color="#FACC15"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs><path d="M4 4 H16 A12 12 0 0 1 28 16 V28 H16 A12 12 0 0 1 4 16 V4 Z" fill="url(#ocmk0)" stroke="none"/><path d="M28 11 L31 12.5 L28 14 Z" fill="#F97316" stroke="none"/><circle cx="20.5" cy="11.5" r="2.6" fill="#0A0C11" fill-opacity="0.92" stroke="none"/></svg>
        </span>
        <span class="ax-sidebar__wordmark">Oracle<span class="ax-sidebar__wordmark-accent">Canary</span></span>
      </RouterLink>
    </div>

    <nav class="ax-sidebar__nav" aria-label="Main menu">
      <template v-for="section in sections" :key="section.label">
        <p class="ax-sidebar__section">{{ section.label }}</p>
        <component
          :is="leaf.external ? 'a' : RouterLink"
          v-for="leaf in section.leaves"
          :key="leaf.id"
          class="ax-nav__item"
          v-bind="leaf.external ? { href: leaf.href, target: '_blank', rel: 'noopener' } : { to: leaf.href }"
          :class="{ 'ax-nav__item--active is-active': activeId === leaf.id }"
          :aria-current="activeId === leaf.id ? 'page' : undefined"
        >
          <span class="ax-nav__bar" aria-hidden="true"></span>
          <AxIcon class="ax-nav__icon" :name="leaf.icon || 'layout-grid'" />
          <span class="ax-nav__label">{{ leaf.title }}</span>
          <span v-if="leaf.badge?.value" class="ax-nav__badge" :class="`ax-nav__badge--${leaf.badge.type}`">{{ leaf.badge.value }}</span>
        </component>
      </template>
    </nav>

    <!-- FOOT: data source -->
    <div class="ax-sidebar__foot">
      <div class="ax-sidebar__user">
        <span class="ax-sidebar__user-meta">
          <b class="ax-sidebar__user-name">Solana mainnet</b>
          <small class="ax-sidebar__user-mail">Kamino · Jupiter Lend · marginfi</small>
        </span>
      </div>
    </div>
  </aside>
</template>
