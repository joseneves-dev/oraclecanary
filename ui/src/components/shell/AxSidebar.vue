<script setup lang="ts">
/*
 * sidebar (manifest-driven nav). Native Vue re-expression of
 * src/html/partials/sidebar.html: brand, menu filter, role=tree nav with
 * accordion groups, section eyebrows, and the mini user-card foot. Same classes
 * + ARIA as the reference so the shared app.css renders identical pixels.
 */
import { ref, computed, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AxIcon from '@/components/AxIcon.vue'
import SidebarNode from './SidebarNode.vue'
import { buildSidebar, resolveActive } from '@/composables/useNav'
import { currentSlug } from '@/lib/manifest'

const sections = buildSidebar()
const route = useRoute()

const slug = computed(() => currentSlug((route.meta.slug as string) || route.path.replace(/^\//, '') || 'overview'))
const active = computed(() => resolveActive(slug.value))
const activeId = computed(() => active.value.activeId)

// open-group state: seed from the active trail; the user can toggle.
const openIds = ref<Set<string>>(new Set(active.value.openGroups))
watch(active, (a) => {
  openIds.value = new Set(a.openGroups)
})

// top-level group ids (for accordion: opening one closes its top-level siblings).
const topGroupIds = computed(() => new Set(sections.flatMap((s) => s.groups.map((g) => g.id))))

function toggle(id: string): void {
  const next = new Set(openIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    if (topGroupIds.value.has(id)) {
      // accordion: close sibling top-level trunks
      for (const t of topGroupIds.value) if (t !== id) next.delete(t)
    }
    next.add(id)
  }
  openIds.value = next
}

const q = ref('')
function clearFilter(): void {
  q.value = ''
}
</script>

<template>
  <aside class="ax-sidebar" role="navigation" aria-label="Primary">
    <!-- BRAND -->
    <div class="ax-sidebar__brand">
      <RouterLink class="ax-sidebar__logo" to="/" aria-label="OracleCanary home">
        <span class="ax-sidebar__mark" aria-hidden="true">
          <svg class="ax-icon" viewBox="0 0 32 32" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="ocmk0" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop stop-color="#FDE047"/><stop offset="0.6" stop-color="#FACC15"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs><path d="M4 4 H16 A12 12 0 0 1 28 16 V28 H16 A12 12 0 0 1 4 16 V4 Z" fill="url(#ocmk0)" stroke="none"/><path d="M28 11 L31 12.5 L28 14 Z" fill="#F97316" stroke="none"/><circle cx="20.5" cy="11.5" r="2.6" fill="#0A0C11" fill-opacity="0.92" stroke="none"/></svg>
        </span>
        <span class="ax-sidebar__wordmark">ORACLECANARY</span>
      </RouterLink>
    </div>

    <!-- MENU FILTER -->
    <div class="ax-sidebar__search">
      <AxIcon class="ax-icon ax-sidebar__search-icon" name="search" />
      <input
        type="search"
        class="ax-sidebar__filter"
        placeholder="Filter menu…"
        aria-label="Filter menu"
        v-model="q"
        @keydown.escape="clearFilter"
      />
      <button v-if="q" type="button" class="ax-sidebar__filter-clear" @click="clearFilter" aria-label="Clear filter">
        <AxIcon class="ax-icon" name="x" />
      </button>
    </div>

    <!-- NAV TREE -->
    <nav class="ax-sidebar__nav" role="tree" aria-label="Main menu">
      <template v-for="section in sections" :key="section.label">
        <p class="ax-sidebar__section" role="presentation">{{ section.label }}</p>
        <SidebarNode
          v-for="group in section.groups"
          :key="group.id"
          :item="group"
          :level="1"
          :top-group-icon="true"
          :open-ids="openIds"
          :active-id="activeId"
          :filter="q"
          @toggle="toggle"
        />
        <component
          :is="leaf.external ? 'a' : RouterLink"
          v-for="leaf in section.leaves"
          :key="leaf.id"
          class="ax-nav__item"
          role="treeitem"
          :aria-level="1"
          v-bind="leaf.external ? { href: leaf.href, target: '_blank', rel: 'noopener' } : { to: leaf.href }"
          :class="{ 'ax-nav__item--active is-active': activeId === leaf.id }"
          :aria-current="activeId === leaf.id ? 'page' : undefined"
          tabindex="-1"
        >
          <span class="ax-nav__bar" aria-hidden="true"></span>
          <AxIcon class="ax-nav__icon" :name="leaf.icon || 'layout-grid'" />
          <span class="ax-nav__label">{{ leaf.title }}</span>
        </component>
      </template>
    </nav>

    <!-- FOOT: data source -->
    <div class="ax-sidebar__foot">
      <div class="ax-sidebar__user">
        <span class="ax-sidebar__user-meta">
          <b class="ax-sidebar__user-name">Solana mainnet</b>
          <small class="ax-sidebar__user-mail">Kamino · checked every 60s</small>
        </span>
      </div>
    </div>
  </aside>
</template>
