<script setup lang="ts">
/*
 * Vireo — command palette (⌘K / Ctrl-K). Native Vue re-expression of
 * src/js/core/command-palette.js + the static shell of src/html/partials/command.html.
 * Fuzzy search over the SAME nav-manifest the sidebar uses, grouped results, arrow/
 * enter navigation, Esc close, plus the dark mode action. Open state via
 * useShellBus.
 *
 * Rendered by BOTH shells (AppLayout + AppShellLayout) at layout level, never
 * inside the header: the header's `backdrop-filter` makes it a containing block
 * for fixed descendants and would pin this overlay inside the bar.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import AxIcon from '@/components/AxIcon.vue'
import { getManifest } from '@/lib/manifest'
import { slugToHref } from '@/composables/useNav'
import { useShellBus } from '@/composables/useShellBus'
import { useTheme } from '@/composables/useTheme'

const bus = useShellBus()
const theme = useTheme()
const router = useRouter()

interface CmdItem {
  title: string
  crumb: string
  group: string
  keywords: string
  href?: string
  /** Served outside the SPA (e.g. the API docs); opened in a new tab like the sidebar link. */
  external?: boolean
  action?: 'toggle-theme'
}

/* Manifest section → result group. Anything unmapped lands in "Pages", which is
   itself in GROUP_ORDER, so a new section can never drop rows silently. */
const GROUPS: Record<string, string> = {
  MAIN: 'Dashboards',
  APPLICATIONS: 'Apps',
  MODULES: 'Modules',
  'UI & FORMS': 'UI & Forms',
  PAGES: 'Pages',
  DOCS: 'Docs',
}
const GROUP_ORDER = ['Dashboards', 'Apps', 'Modules', 'UI & Forms', 'Pages', 'Docs', 'Actions']

function groupFor(section?: string | null): string {
  return (section && GROUPS[section]) || 'Pages'
}

function buildItems(): CmdItem[] {
  const mf = getManifest()
  const items: CmdItem[] = []
  for (const node of mf.nodes) {
    if (node.alias) continue
    // Groups are containers; only pages are searchable.
    if (mf.childrenOf(node.id).some((c) => c.inMenu)) continue
    if (!node.inMenu) continue
    const trail = mf.trail(node)
    const crumb = trail.slice(0, -1).map((n) => n.title).join(' / ')
    items.push({
      title: node.title,
      crumb: crumb || 'Home',
      // Only the ROOT of each branch carries `section` in the manifest — reading
      // it off the leaf put all 190 pages in the catch-all "Pages" bucket.
      group: groupFor(trail[0] && trail[0].section),
      keywords: (node.keywords || []).join(' '),
      href: slugToHref(node.slug),
      external: !!node.external,
    })
  }
  items.push(
    { title: 'Toggle dark mode', crumb: 'Theme', group: 'Actions', keywords: 'dark light theme mode', action: 'toggle-theme' },
  )
  return items
}
const allItems = buildItems()

const q = ref('')
const active = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)

function fuzzy(hay: string, query: string): boolean {
  let i = 0
  for (const ch of hay) {
    if (ch === query[i]) i++
    if (i === query.length) return true
  }
  return false
}

interface Row { header?: string; item?: CmdItem }
const rows = computed<Row[]>(() => {
  const query = q.value.trim().toLowerCase()
  let pool = allItems
  if (query) {
    const scored = allItems
      .map((it) => {
        const titleLc = it.title.toLowerCase()
        const hay = (it.title + ' ' + it.keywords).toLowerCase()
        let score = -1
        if (titleLc.startsWith(query)) score = 100
        else if (titleLc.includes(query)) score = 70
        else if (hay.includes(query)) score = 40
        // Fuzzy against the TITLE only. Run over title+keywords it degenerated: a
        // subsequence match on a 60-char haystack put "503 Service Unavailable"
        // and "Breadcrumb" under a search for "email".
        else if (fuzzy(titleLc, query)) score = 20
        return { it, score }
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.it.title.localeCompare(b.it.title))
    pool = scored.map((x) => x.it)
  } else {
    pool = allItems.filter((i) => i.group !== 'Actions').slice(0, 6).concat(allItems.filter((i) => i.group === 'Actions'))
  }
  const out: Row[] = []
  for (const g of GROUP_ORDER) {
    const bucket = pool.filter((i) => i.group === g).slice(0, 8)
    if (bucket.length) {
      out.push({ header: g })
      for (const it of bucket) out.push({ item: it })
    }
  }
  return out
})
const selectable = computed(() => rows.value.filter((r) => r.item).map((r) => r.item as CmdItem))

/* The element that opened the palette, so close() can hand focus back to it. */
let opener: HTMLElement | null = null

watch(rows, () => (active.value = 0))
watch(
  () => bus.commandOpen.value,
  async (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      q.value = ''
      active.value = 0
      await nextTick()
      inputEl.value?.focus()
    } else {
      // Hand focus back BEFORE the root goes aria-hidden/hidden: hiding a subtree
      // that still owns the focused element strands it for assistive tech, and
      // Chrome refuses the aria-hidden outright ("Blocked aria-hidden on an
      // element because its descendant retained focus"). Focus the opener when
      // there was one; otherwise — ⌘K pressed with nothing focused — blur.
      const held = rootEl.value?.contains(document.activeElement)
      if (opener && document.contains(opener)) opener.focus()
      else if (held && document.activeElement instanceof HTMLElement) document.activeElement.blur()
      opener = null
    }
  },
  { flush: 'sync' },
)

function go(it: CmdItem): void {
  if (it.action === 'toggle-theme') {
    theme.toggleTheme()
    bus.closeCommand()
    return
  }
  if (it.href && it.external) window.open(it.href, '_blank', 'noopener')
  else if (it.href) router.push(it.href)
  bus.closeCommand()
}

function onKey(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    bus.commandOpen.value ? bus.closeCommand() : bus.openCommand()
    return
  }
  if (!bus.commandOpen.value) return
  const n = selectable.value.length
  if (e.key === 'Escape') {
    e.preventDefault()
    bus.closeCommand()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (n) active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (n) active.value = (active.value - 1 + n) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const it = selectable.value[active.value]
    if (it) go(it)
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})

function indexOfItem(item: CmdItem): number {
  return selectable.value.indexOf(item)
}
</script>

<template>
  <!--
    COMMAND PALETTE · #ax-command — the shell of src/html/partials/command.html:
    backdrop button, panel, query row (search icon + input + "esc" keycap + close
    icon-button), the results listbox, and the footer key hints. shell.css §13
    styles it; the phone breakpoint swaps the esc keycap for the × button and
    hides the footer, so both must exist in the markup.
  -->
  <div
    ref="rootEl"
    id="ax-command"
    class="ax-command"
    :class="{ 'is-open': bus.commandOpen.value }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ax-command-title"
    :aria-hidden="!bus.commandOpen.value"
    :hidden="!bus.commandOpen.value"
  >
    <!-- Click-catch scrim, painted behind the panel. -->
    <button type="button" class="ax-command__backdrop" data-ax-command-backdrop aria-label="Close search" tabindex="-1" @click="bus.closeCommand()"></button>

    <div class="ax-command__panel">
      <h2 id="ax-command-title" class="ax-visually-hidden">Search or jump to</h2>

      <!-- ===== QUERY ROW ===== -->
      <div class="ax-command__input">
        <AxIcon class="ax-icon" name="search" />
        <input
          ref="inputEl"
          v-model="q"
          type="text"
          data-ax-command-input
          placeholder="Search pages and actions…"
          aria-label="Search pages, apps and actions"
          aria-controls="ax-command-results"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
        />
        <kbd class="ax-command__keycap ax-command__keycap--esc">esc</kbd>
        <button type="button" class="ax-icon-btn ax-command__close" data-ax-command-close aria-label="Close search" @click="bus.closeCommand()">
          <AxIcon class="ax-icon" name="x" />
        </button>
      </div>

      <!-- ===== RESULTS ===== -->
      <div id="ax-command-results" class="ax-command__results" data-ax-command-results role="listbox" aria-label="Search results">
        <template v-for="(row, i) in rows" :key="i">
          <p v-if="row.header" class="ax-command__group">{{ row.header }}</p>
          <button
            v-else
            type="button"
            class="ax-command__row"
            :class="{ 'is-active': indexOfItem(row.item!) === active }"
            role="option"
            :aria-selected="indexOfItem(row.item!) === active"
            @click="go(row.item!)"
            @mouseenter="active = indexOfItem(row.item!)"
          >
            <span class="ax-command__row-title">{{ row.item!.title }}</span>
            <span class="ax-command__crumb">{{ row.item!.crumb }}</span>
          </button>
        </template>
        <p v-if="!selectable.length" class="ax-command__empty">No matches for “{{ q.trim() }}” — try a page name or "settings".</p>
      </div>

      <!-- ===== KEY HINTS (pointer/keyboard only — hidden on phones) ===== -->
      <div class="ax-command__foot" aria-hidden="true">
        <span class="ax-command__hint"><kbd class="ax-command__keycap">↑</kbd><kbd class="ax-command__keycap">↓</kbd>navigate</span>
        <span class="ax-command__hint"><kbd class="ax-command__keycap">↵</kbd>open</span>
        <span class="ax-command__hint"><kbd class="ax-command__keycap">esc</kbd>close</span>
      </div>
    </div>
  </div>
</template>
