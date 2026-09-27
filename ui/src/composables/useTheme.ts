/*
 * reactive theme store (Vue edition).
 *
 * A singleton reactive bridge over lib/theme.ts. Components read `theme.*`
 * reactive state and call `theme.setX()` mutators; the lib layer writes the
 * data-ax-* attributes + ax: localStorage and fires `ax:change`. A MutationObserver
 * on <html data-ax-theme> + the lib's system listener keep the reactive mirror
 * in sync so the header toggle, customizer, and command palette all agree.
 */

import { reactive, readonly } from 'vue'
import * as t from '@/lib/theme'
import * as store from '@/lib/storage'

interface ThemeState {
  mode: string // light | dark | system
  resolved: 'light' | 'dark'
  dir: string
  accent: string
  customAccent: string
  lang: string
  // layout / scheme controls
  nav: string
  shellStyle: string
  sidebarBehavior: string
  menu: string
  page: string
  width: string
  headerPos: string
  sidebarPos: string
  sidebarScheme: string
  headerScheme: string
  sidebarImage: string
  loader: string
  // font: registry value ('inter' default | 'custom') + the family it resolves to
  font: string
  fontFamily: string
  collapsed: boolean
  recentAccents: string[]
  bgLowContrast: boolean
}

const state = reactive<ThemeState>({
  mode: t.currentValueOf('mode'),
  resolved: t.resolveTheme(),
  dir: t.currentValueOf('dir'),
  accent: t.currentValueOf('accent'),
  customAccent: store.get('ax:accent-custom') || '',
  lang: (store.get('ax:lang') || 'EN').toUpperCase(),
  nav: t.currentValueOf('nav'),
  shellStyle: t.currentValueOf('shell-style'),
  sidebarBehavior: t.currentValueOf('sidebar-behavior'),
  menu: t.currentValueOf('menu'),
  page: t.currentValueOf('page'),
  width: t.currentValueOf('width'),
  headerPos: t.currentValueOf('header-position'),
  sidebarPos: t.currentValueOf('sidebar-position'),
  sidebarScheme: t.currentValueOf('sidebar-scheme'),
  headerScheme: t.currentValueOf('header-scheme'),
  sidebarImage: t.currentValueOf('sidebar-image'),
  loader: t.currentValueOf('loader'),
  font: t.currentValueOf('font'),
  fontFamily: t.currentFontFamily(),
  collapsed: document.documentElement.hasAttribute('data-ax-collapsed'),
  recentAccents: t.recentSwatches(),
  bgLowContrast: false,
})

const D = document.documentElement

function syncFromDom(): void {
  state.resolved = (D.getAttribute('data-ax-theme') as 'light' | 'dark') || 'light'
  state.mode = t.currentValueOf('mode')
  state.dir = t.currentValueOf('dir')
  state.accent = t.currentValueOf('accent')
  state.collapsed = D.hasAttribute('data-ax-collapsed')
  state.nav = t.currentValueOf('nav')
  state.shellStyle = t.currentValueOf('shell-style')
  state.sidebarBehavior = t.currentValueOf('sidebar-behavior')
  state.menu = t.currentValueOf('menu')
  state.page = t.currentValueOf('page')
  state.width = t.currentValueOf('width')
  state.headerPos = t.currentValueOf('header-position')
  state.sidebarPos = t.currentValueOf('sidebar-position')
  state.sidebarScheme = t.currentValueOf('sidebar-scheme')
  state.headerScheme = t.currentValueOf('header-scheme')
  state.sidebarImage = t.currentValueOf('sidebar-image')
  state.loader = t.currentValueOf('loader')
  state.font = t.currentValueOf('font')
  state.fontFamily = t.currentFontFamily()
  state.customAccent = store.get('ax:accent-custom') || ''
  state.recentAccents = t.recentSwatches()
}

let _booted = false
function boot(): void {
  if (_booted) return
  _booted = true
  t.bootTheme()
  syncFromDom()
  new MutationObserver(syncFromDom).observe(D, {
    attributes: true,
    attributeFilter: [
      'data-ax-theme', 'data-ax-accent', 'data-ax-collapsed', 'dir', 'lang',
      'data-ax-nav', 'data-ax-shell-style', 'data-ax-sidebar-behavior', 'data-ax-menu',
      'data-ax-page', 'data-ax-width', 'data-ax-header-position', 'data-ax-sidebar-position',
      'data-ax-sidebar', 'data-ax-header', 'data-ax-sidebar-image', 'data-ax-loader',
      'data-ax-font',
    ],
  })
}

/* ---- mutators (thin wrappers; lib does the attribute + persistence work) ---- */

export function useTheme() {
  boot()
  return {
    state: readonly(state),

    toggleTheme() {
      t.quickToggleTheme()
      syncFromDom()
    },
    setMode(m: string) {
      t.setMode(m)
      syncFromDom()
    },
    setDir(d: string) {
      t.setDir(d)
      syncFromDom()
    },
    setLang(code: string) {
      state.lang = code.toUpperCase()
      store.set('ax:lang', state.lang)
      D.setAttribute('lang', state.lang.toLowerCase())
      if (code === 'AR' && !store.get('ax:dir')) t.setDir('rtl')
      t.emitChange('lang')
    },
    /** Back to the shipped Inter + Space Grotesk pairing. */
    resetFont() {
      t.resetFont()
      syncFromDom()
    },
    /**
     * Apply a family by name — a search hit, or whatever was typed. Returns the
     * applied family, or null when the name was blank (nothing changed).
     */
    pickFont(family: string): string | null {
      const applied = t.setCustomFont(family)
      if (!applied) return null
      syncFromDom() // font becomes 'custom', unless they picked Inter
      return applied
    },
    /** Pull the catalog chunk on first focus so the first keystroke has it. */
    warmFontCatalog() {
      return t.loadFontCatalog()
    },
    /** Offline search over the catalog snapshot (+ one preview-face request). */
    searchFonts(query: string, limit?: number) {
      return t.searchFonts(query, limit)
    },
    setAccent(name: string) {
      t.setAccent(name)
      syncFromDom()
    },
    setCustomAccent(hex: string) {
      const v = t.setCustomAccent(hex)
      if (v) syncFromDom()
    },
    setCustomBg(hex: string) {
      state.bgLowContrast = t.setCustomBg(hex)
    },
    setByName(name: string, val: string) {
      t.setByName(name, val)
      // Expanded & Compact lock the rail: clear any header-toggle collapse state.
      if (name === 'sidebar-behavior' && val !== 'collapsible') {
        D.removeAttribute('data-ax-collapsed')
        store.remove('ax:collapsed')
      }
      syncFromDom()
    },
    toggleSidebar() {
      // Only the 'collapsible' behavior honours the header toggle (matches reference).
      if ((D.getAttribute('data-ax-sidebar-behavior') || 'collapsible') !== 'collapsible') return
      const collapsed = D.toggleAttribute('data-ax-collapsed')
      if (collapsed) store.set('ax:collapsed', '1')
      else store.remove('ax:collapsed')
      syncFromDom()
    },
    reset() {
      t.reset()
      syncFromDom()
    },
    copyConfig() {
      return t.copyConfig()
    },
    presets: t.PRESETS,
  }
}
