<script setup lang="ts">
/*
 * recursive sidebar node (group or leaf). Renders the same DOM /
 * classes / ARIA as the HTML reference sidebar partial:
 *   group  → button.ax-nav__item--parent + div.ax-nav__children
 *   leaf   → RouterLink.ax-nav__item--child (or top-level .ax-nav__item)
 * Groups nest (Authentication, Charts) via self-reference.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import AxIcon from '@/components/AxIcon.vue'
import { isGroup, type NavItem, type NavGroup } from '@/composables/useNav'

const props = defineProps<{
  item: NavItem
  level: number // aria-level
  topGroupIcon?: boolean // L1 groups show their icon; nested groups don't
  openIds: Set<string>
  activeId: string | null
  filter: string
}>()
const emit = defineEmits<{ (e: 'toggle', id: string): void }>()

const group = computed(() => (isGroup(props.item) ? (props.item as NavGroup) : null))
const isOpen = computed(() => !!group.value && props.openIds.has(group.value.id))

function matches(item: NavItem): boolean {
  const q = props.filter.trim().toLowerCase()
  if (!q) return true
  if (isGroup(item)) return (item as NavGroup).children.some(matches)
  return item.title.toLowerCase().includes(q)
}
const visible = computed(() => matches(props.item))
// Under an active filter, groups auto-expand so matches are revealed.
const effectiveOpen = computed(() => (props.filter.trim() ? true : isOpen.value))

function badgeClass(type?: string): string {
  if (type === 'Hot') return 'ax-nav__badge ax-nav__badge--hot'
  if (type === 'New') return 'ax-nav__badge ax-nav__badge--new'
  return 'ax-nav__badge ax-nav__badge--count'
}
function badgeText(b: NavItem['badge']): string {
  if (!b) return ''
  if (b.type === 'count') return String(b.value ?? '')
  return b.type
}
</script>

<template>
  <!-- GROUP -->
  <div v-if="group" v-show="visible" class="ax-nav__group" :class="{ 'is-open': effectiveOpen }">
    <button
      type="button"
      class="ax-nav__item ax-nav__item--parent"
      :class="{ 'ax-nav__item--child': level > 1 }"
      role="treeitem"
      :aria-level="level"
      :aria-expanded="effectiveOpen ? 'true' : 'false'"
      :data-ax-group="group.id"
      :tabindex="activeId ? -1 : level === 1 ? 0 : -1"
      @click="emit('toggle', group.id)"
    >
      <AxIcon v-if="topGroupIcon" class="ax-nav__icon" :name="group.icon" />
      <span class="ax-nav__label">{{ group.title }}</span>
      <span v-if="group.badge" :class="badgeClass(group.badge.type)">{{ badgeText(group.badge) }}</span>
      <AxIcon class="ax-nav__caret ax-icon--directional" name="chevron" />
    </button>
    <div class="ax-nav__children" role="group" :hidden="!effectiveOpen">
      <SidebarNode
        v-for="child in group.children"
        :key="child.id"
        :item="child"
        :level="level + 1"
        :top-group-icon="false"
        :open-ids="openIds"
        :active-id="activeId"
        :filter="filter"
        @toggle="(id) => emit('toggle', id)"
      />
    </div>
  </div>

  <!-- LEAF -->
  <RouterLink
    v-else
    v-show="visible"
    class="ax-nav__item ax-nav__item--child"
    :class="{ 'ax-nav__item--active is-active': activeId === item.id }"
    role="treeitem"
    :aria-level="level"
    :aria-current="activeId === item.id ? 'page' : undefined"
    :to="(item as any).href"
    :tabindex="activeId === item.id ? 0 : -1"
  >
    <span class="ax-nav__bar" aria-hidden="true"></span>
    <span class="ax-nav__label">{{ item.title }}</span>
    <span v-if="item.badge" :class="badgeClass(item.badge.type)">{{ badgeText(item.badge) }}</span>
  </RouterLink>
</template>
