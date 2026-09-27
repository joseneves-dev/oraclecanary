<script setup lang="ts">
/*
 * breadcrumb. Manifest-derived trail for the current route, matching
 * the .ax-breadcrumb structure nav.js builds in the HTML reference (icon-only
 * Home root → group crumbs → current non-link).
 */
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AxIcon from '@/components/AxIcon.vue'
import { resolveActive } from '@/composables/useNav'
import { currentSlug } from '@/lib/manifest'

const route = useRoute()
const crumbs = computed(
  () => resolveActive(currentSlug((route.meta.slug as string) || route.path.replace(/^\//, '') || 'overview')).crumbs,
)
</script>

<template>
  <nav class="ax-breadcrumb" data-ax-breadcrumb aria-label="Breadcrumb">
    <ol class="ax-breadcrumb__list">
      <template v-for="(c, i) in crumbs" :key="i">
        <li v-if="i > 0" class="ax-breadcrumb__sep" aria-hidden="true">
          <AxIcon class="ax-icon ax-icon--directional" name="chevron" />
        </li>
        <li class="ax-breadcrumb__item" :aria-current="c.current ? 'page' : undefined">
          <span v-if="c.current">{{ c.label }}</span>
          <RouterLink v-else-if="c.home" class="ax-breadcrumb__link" :to="c.href!" aria-label="Home">
            <AxIcon class="ax-breadcrumb__home" name="home" :size="16" />
          </RouterLink>
          <RouterLink v-else class="ax-breadcrumb__link" :to="c.href!">{{ c.label }}</RouterLink>
        </li>
      </template>
    </ol>
  </nav>
</template>
