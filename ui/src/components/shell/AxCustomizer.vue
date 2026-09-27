<script setup lang="ts">
/*
 * theme customizer offcanvas. Native Vue re-expression of
 * src/html/partials/customizer.html with every control wired through useTheme
 * (live-apply, default-removes-attr, persisted under ax: keys). Same DOM /
 * classes / ARIA as the reference; the open state is driven by useShellBus.
 */
import { ref, watch } from 'vue'
import AxIcon from '@/components/AxIcon.vue'
import { useTheme } from '@/composables/useTheme'
import { useShellBus } from '@/composables/useShellBus'
import type { FontRecord } from '@/lib/google-fonts'

const theme = useTheme()
const bus = useShellBus()
const s = theme.state

const swatches = [
  { v: 'verdigris', c: '#1E856C' }, { v: 'cobalt', c: '#2A5FCC' }, { v: 'indigo', c: '#4F46C9' },
  { v: 'amethyst', c: '#8A46B5' }, { v: 'magenta', c: '#C13C84' }, { v: 'terracotta', c: '#C25339' },
  { v: 'amber', c: '#C1820E' }, { v: 'olive', c: '#647F1C' }, { v: 'forest', c: '#2C7A4B' },
  { v: 'teal', c: '#10808F' }, { v: 'slate', c: '#4A5A6B' }, { v: 'graphite', c: '#52514C' },
]
const bgTints = [
  { v: 'porcelain', c: '#FCFBF9' }, { v: 'cool-gray', c: '#F4F6F8' },
  { v: 'warm-sand', c: '#F7F3EC' }, { v: 'slate-mist', c: '#EFF1F4' },
]
const schemes = ['light', 'dark', 'brand', 'gradient', 'transparent']

/* ---- FONT: search over the whole Google Fonts catalog (lazy snapshot) ----
   Panel-local search state; the applied family itself lives in useTheme (it is
   part of the data-ax-* attribute contract). Mirrors the reference Alpine
   axCustomizer handlers exactly, including the two subtle ones below. */
const fontQuery = ref('')
const fontResults = ref<FontRecord[]>([])
const fontSearching = ref(false)
const fontSearched = ref(false)
let fontTimer: ReturnType<typeof setTimeout> | undefined

/** Inline specimen style — each row prints its own name in its own typeface. */
function specimen(family: string) {
  return { fontFamily: `"${family}", var(--ax-font-sans)` }
}

function clearFontSearch(): void {
  clearTimeout(fontTimer)
  fontQuery.value = ''
  fontResults.value = []
  fontSearching.value = false
  fontSearched.value = false
}

/** Back to the shipped Inter + Space Grotesk pairing. */
function resetFont(): void {
  theme.resetFont()
  clearFontSearch()
}

/** Apply a family by name — a search hit, or whatever was typed. */
function pickFont(family: string): void {
  if (!theme.pickFont(family)) return
  clearFontSearch()
}

/** Pull the catalog chunk on first focus so the first keystroke has it. */
function warmFontCatalog(): void {
  theme.warmFontCatalog()
}

function onFontQuery(): void {
  clearTimeout(fontTimer)
  fontTimer = setTimeout(runFontSearch, 160)
}

function runFontSearch(): void {
  const q = fontQuery.value.trim()
  if (!q) {
    fontResults.value = []
    fontSearching.value = false
    fontSearched.value = false
    return
  }
  fontSearching.value = true
  fontSearched.value = false
  theme.searchFonts(q, 24).then((hits) => {
    if (fontQuery.value.trim() !== q) return // a stale reply must not win
    fontResults.value = hits
    fontSearching.value = false
    fontSearched.value = true
  })
}

/**
 * Enter applies the best match. It re-runs the search rather than trusting
 * `fontResults`, which may still be a debounce behind what was typed —
 * otherwise a fast typist hitting Enter applies their half-finished query as a
 * literal family name.
 */
function submitFontSearch(): void {
  const q = fontQuery.value.trim()
  if (!q) return
  clearTimeout(fontTimer)
  theme.searchFonts(q, 24).then((hits) => pickFont(hits.length ? hits[0].family : q))
}

/** Escape clears the search first; only an empty field lets it close the panel. */
function onFontEscape(e: KeyboardEvent): void {
  if (!fontQuery.value) return
  e.stopPropagation()
  clearFontSearch()
}

// lock body scroll while open (mirrors the reference customizer)
watch(
  () => bus.customizerOpen.value,
  (v) => {
    document.body.style.overflow = v ? 'hidden' : ''
  },
)
</script>

<template>
  <aside
    id="ax-customizer"
    class="ax-customizer"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ax-customizer-title"
    v-show="bus.customizerOpen.value"
    @keydown.escape.window="bus.closeCustomizer()"
  >
    <button type="button" class="ax-customizer__backdrop" @click="bus.closeCustomizer()" aria-label="Close customizer" tabindex="-1"></button>

    <div class="ax-customizer__head">
      <div class="ax-customizer__head-text">
        <h2 id="ax-customizer-title" class="ax-customizer__title">Theme Customizer</h2>
        <p class="ax-customizer__sub">Live preview — changes save automatically</p>
      </div>
      <button type="button" class="ax-icon-btn ax-customizer__close" @click="bus.closeCustomizer()" aria-label="Close customizer">
        <AxIcon class="ax-icon" name="x" />
      </button>
    </div>

    <div class="ax-customizer__body">
      <!-- COLOR MODE -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Color Mode</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Color mode">
          <button type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.mode === 'light'" :class="{ 'is-active': s.mode === 'light' }" @click="theme.setMode('light')">
            <AxIcon class="ax-icon" name="sun" /><span>Light</span>
          </button>
          <button type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.mode === 'dark'" :class="{ 'is-active': s.mode === 'dark' }" @click="theme.setMode('dark')">
            <AxIcon class="ax-icon" name="moon" /><span>Dark</span>
          </button>
          <button type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.mode === 'system'" :class="{ 'is-active': s.mode === 'system' }" @click="theme.setMode('system')">
            <AxIcon class="ax-icon" name="layout-grid" /><span>System</span>
          </button>
        </div>
      </section>

      <!-- DIRECTION -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Direction</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Direction">
          <button type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.dir === 'ltr'" :class="{ 'is-active': s.dir === 'ltr' }" @click="theme.setDir('ltr')"><span>LTR</span></button>
          <button type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.dir === 'rtl'" :class="{ 'is-active': s.dir === 'rtl' }" @click="theme.setDir('rtl')"><span>RTL</span></button>
        </div>
      </section>

      <!-- FONT — the family in use, plus a search across every Google family.
           There is no shortlist: the default (Inter) keeps the shipped Inter +
           Space Grotesk pairing, and anything picked from the catalog drives body
           AND headings. Webfonts are only fetched once selected, and the
           searchable catalog is a lazy chunk (lib/google-fonts.ts), so this whole
           section costs nothing on a page load that never opens the panel. -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Font</p>

        <!-- What is applied right now, printed in its own typeface. -->
        <div class="ax-font-active" :class="{ 'is-custom': s.font === 'custom' }">
          <span class="ax-font-active__text">
            <span class="ax-font-active__label">Current font</span>
            <span class="ax-font-active__name" :style="specimen(s.fontFamily)">{{ s.fontFamily }}</span>
          </span>
          <button
            type="button"
            class="ax-font-active__clear"
            v-show="s.font === 'custom'"
            data-ax-action="font-reset"
            @click="resetFont()"
            aria-label="Reset to the default font"
          >Reset</button>
        </div>

        <!-- ANY Google family. The catalog is searched offline against a bundled
             snapshot — no API key, which a static template has nowhere safe to put. -->
        <div class="ax-font-search">
          <AxIcon class="ax-icon ax-font-search__icon" name="search" />
          <input
            type="search"
            class="ax-font-search__input"
            placeholder="Search all Google Fonts…"
            aria-label="Search all Google Fonts"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            data-ax-set="font"
            v-model="fontQuery"
            @input="onFontQuery()"
            @focus="warmFontCatalog()"
            @keydown.enter.prevent="submitFontSearch()"
            @keydown.escape="onFontEscape($event)"
          />
          <button type="button" class="ax-font-search__clear" v-show="fontQuery" @click="clearFontSearch()" aria-label="Clear font search">
            <AxIcon class="ax-icon" name="x" />
          </button>
        </div>

        <div class="ax-font-results" v-show="fontQuery.trim() && (fontResults.length || fontSearching || fontSearched)">
          <div role="listbox" aria-label="Google Fonts results">
            <button
              v-for="f in fontResults"
              :key="f.family"
              type="button"
              class="ax-font-result"
              role="option"
              :aria-selected="s.fontFamily === f.family"
              :class="{ 'is-active': s.fontFamily === f.family }"
              :style="specimen(f.family)"
              @click="pickFont(f.family)"
            >
              <span class="ax-font-result__name">{{ f.family }}</span>
              <span class="ax-font-result__cat">{{ f.category }}</span>
            </button>
          </div>
          <p class="ax-font-results__msg" v-show="fontSearching && !fontResults.length">Searching…</p>
          <!-- The snapshot ages; a family added to Google Fonts since then is still
               usable by name, so never dead-end on "no results". -->
          <p class="ax-font-results__msg" v-show="fontSearched && !fontResults.length">
            No match in the catalog.
            <button type="button" class="ax-link" @click="pickFont(fontQuery)">Use “<span>{{ fontQuery.trim() }}</span>” anyway</button>
          </p>
        </div>

        <p class="ax-note">Search any of the ~1,800 Google Fonts families. Sets body text &amp; headings · code keeps JetBrains Mono. The chosen family loads from Google Fonts on demand.</p>
      </section>

      <!-- ACCENT PRESETS -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Accent Presets</p>
        <div class="ax-swatch-grid" role="radiogroup" aria-label="Accent color">
          <button
            v-for="sw in swatches"
            :key="sw.v"
            type="button"
            class="ax-swatch"
            role="radio"
            :aria-checked="s.accent === sw.v"
            :class="{ 'is-active': s.accent === sw.v }"
            :style="`--sw:${sw.c}`"
            :aria-label="sw.v"
            @click="theme.setAccent(sw.v)"
          >
            <AxIcon v-if="s.accent === sw.v" class="ax-swatch__check ax-icon" name="check" />
          </button>
        </div>
      </section>

      <!-- CUSTOM COLORS -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Custom Colors</p>
        <label class="ax-color-field">
          <span class="ax-color-field__label">Primary</span>
          <span class="ax-color-field__controls">
            <input type="color" class="ax-color-input" :value="s.customAccent || '#1E856C'" @input="theme.setCustomAccent(($event.target as HTMLInputElement).value)" aria-label="Custom primary color" />
            <input type="text" class="ax-hex" :value="s.customAccent" placeholder="#RRGGBB" @change="theme.setCustomAccent(($event.target as HTMLInputElement).value)" aria-label="Custom primary hex" />
          </span>
        </label>
        <div class="ax-recent-swatches" role="group" aria-label="Recently used colors">
          <button v-for="hex in s.recentAccents" :key="hex" type="button" class="ax-recent-swatch" :style="`--sw:${hex}`" :aria-label="hex" @click="theme.setCustomAccent(hex)"></button>
        </div>
        <label class="ax-color-field">
          <span class="ax-color-field__label">Background</span>
          <span class="ax-color-field__controls">
            <input type="color" class="ax-color-input" @input="theme.setCustomBg(($event.target as HTMLInputElement).value)" aria-label="Custom background color" />
          </span>
        </label>
        <div class="ax-tint-row" role="group" aria-label="Background presets">
          <button v-for="t in bgTints" :key="t.v" type="button" class="ax-tint" :style="`--sw:${t.c}`" :data-ax-bg-tint="t.v" :aria-label="t.v" @click="theme.setCustomBg(t.c)"></button>
        </div>
        <p v-show="s.bgLowContrast" class="ax-note ax-note--warn">Low contrast — text may be hard to read.</p>
      </section>

      <!-- NAVIGATION -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Navigation</p>
        <p class="ax-customizer__label">Orientation</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Navigation orientation">
          <button v-for="o in ['vertical', 'horizontal', 'hybrid']" :key="o" type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.nav === o" :class="{ 'is-active': s.nav === o }" @click="theme.setByName('nav', o)"><span class="capitalize">{{ o }}</span></button>
        </div>
        <p class="ax-customizer__label">Menu interaction</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Menu interaction">
          <button v-for="o in ['click', 'hover']" :key="o" type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.menu === o" :class="{ 'is-active': s.menu === o }" @click="theme.setByName('menu', o)"><span class="capitalize">{{ o }}</span></button>
        </div>
      </section>

      <!-- SHELL STYLE -->
      <section class="ax-customizer__section" v-show="s.nav !== 'horizontal'">
        <p class="ax-eyebrow">Shell Style</p>
        <div class="ax-style-list ax-style-list--pair" role="radiogroup" aria-label="Shell style">
          <button type="button" class="ax-style" role="radio" :aria-checked="s.shellStyle === 'default'" :class="{ 'is-active': s.shellStyle === 'default' }" @click="theme.setByName('shell-style', 'default')"><span class="ax-style__diagram ax-style__diagram--default" aria-hidden="true"></span><span class="ax-style__label">Docked</span></button>
          <button type="button" class="ax-style" role="radio" :aria-checked="s.shellStyle === 'detached'" :class="{ 'is-active': s.shellStyle === 'detached' }" @click="theme.setByName('shell-style', 'detached')"><span class="ax-style__diagram ax-style__diagram--detached" aria-hidden="true"></span><span class="ax-style__label">Detached</span></button>
        </div>
      </section>

      <!-- SIDEBAR -->
      <section class="ax-customizer__section" v-show="s.nav !== 'horizontal'">
        <p class="ax-eyebrow">Sidebar</p>
        <p class="ax-customizer__label">Behavior</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Sidebar behavior">
          <button v-for="o in ['collapsible', 'expanded', 'compact']" :key="o" type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.sidebarBehavior === o" :class="{ 'is-active': s.sidebarBehavior === o }" @click="theme.setByName('sidebar-behavior', o)"><span class="capitalize">{{ o }}</span></button>
        </div>
        <p class="ax-customizer__label">Position</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Sidebar position">
          <button v-for="o in ['fixed', 'static']" :key="o" type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.sidebarPos === o" :class="{ 'is-active': s.sidebarPos === o }" @click="theme.setByName('sidebar-position', o)"><span class="capitalize">{{ o }}</span></button>
        </div>
        <p class="ax-customizer__label">Color scheme</p>
        <div class="ax-scheme-row" role="radiogroup" aria-label="Sidebar color scheme">
          <button v-for="sc in schemes" :key="sc" type="button" class="ax-scheme" :class="[`ax-scheme--${sc}`, { 'is-active': s.sidebarScheme === sc }]" role="radio" :aria-checked="s.sidebarScheme === sc" :aria-label="sc" @click="theme.setByName('sidebar-scheme', sc)"></button>
        </div>
      </section>

      <!-- HEADER -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Header</p>
        <p class="ax-customizer__label">Position</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Header position">
          <button v-for="o in ['fixed', 'static']" :key="o" type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.headerPos === o" :class="{ 'is-active': s.headerPos === o }" @click="theme.setByName('header-position', o)"><span class="capitalize">{{ o }}</span></button>
        </div>
        <p class="ax-customizer__label">Color scheme</p>
        <div class="ax-scheme-row" role="radiogroup" aria-label="Header color scheme">
          <button v-for="sc in schemes" :key="sc" type="button" class="ax-scheme" :class="[`ax-scheme--${sc}`, { 'is-active': s.headerScheme === sc }]" role="radio" :aria-checked="s.headerScheme === sc" :aria-label="sc" @click="theme.setByName('header-scheme', sc)"></button>
        </div>
      </section>

      <!-- LAYOUT -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Layout</p>
        <p class="ax-customizer__label">Page style</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Page style">
          <button v-for="o in ['regular', 'classic', 'compact']" :key="o" type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.page === o" :class="{ 'is-active': s.page === o }" @click="theme.setByName('page', o)"><span class="capitalize">{{ o }}</span></button>
        </div>
        <p class="ax-customizer__label">Width</p>
        <div class="ax-segmented" role="radiogroup" aria-label="Layout width">
          <button v-for="o in ['fluid', 'full']" :key="o" type="button" class="ax-segmented__btn" role="radio" :aria-checked="s.width === o" :class="{ 'is-active': s.width === o }" @click="theme.setByName('width', o)"><span class="capitalize">{{ o }}</span></button>
        </div>
      </section>

      <!-- MISC / LOADER -->
      <section class="ax-customizer__section">
        <p class="ax-eyebrow">Misc</p>
        <label class="ax-toggle">
          <span class="ax-toggle__label">Page loader</span>
          <input type="checkbox" class="ax-toggle__input" :checked="s.loader === 'on'" @change="theme.setByName('loader', ($event.target as HTMLInputElement).checked ? 'on' : 'off')" />
          <span class="ax-toggle__track" aria-hidden="true"><span class="ax-toggle__thumb"></span></span>
        </label>
      </section>
    </div>

    <div class="ax-customizer__foot">
      <button type="button" class="ax-btn ax-btn--ghost-danger" @click="theme.reset()">Reset</button>
      <button type="button" class="ax-btn ax-btn--ghost" @click="theme.copyConfig()">Copy config</button>
    </div>
  </aside>
</template>
