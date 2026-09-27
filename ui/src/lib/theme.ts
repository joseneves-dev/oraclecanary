/*
 * runtime attribute contract + customizer logic (Vue edition).
 *
 * Pure-logic TS port of src/js/core/theme-restore.js + src/js/core/customizer.js.
 * Writes data-ax-* attributes onto <html> and persists ax: localStorage keys,
 * exactly matching the blocking anti-flash head IIFE so first paint and runtime
 * stay byte-for-byte aligned. CSS reacts; this layer only sets attributes + persists.
 *
 * Fires the framework-agnostic `ax:change` DOM event after any mutation so the
 * ApexCharts wrapper (and anything else listening) can re-theme live.
 */

import * as store from './storage'
import { deriveRamp, onColor, parseHex } from './color'
import {
  DEFAULT_FONT, DEFAULT_FAMILY, CUSTOM_FONT, applyFont, weightQuery,
  isDefaultFamily, loadCatalog, catalogEntry, searchCatalog, ensureSearchPreviews,
} from './fonts'
import type { FontRecord } from './google-fonts'

const D = document.documentElement
const PREFIX = store.PREFIX

/* ---- runtime attribute registry (matches customizer.js REGISTRY) ---- */
export interface RegEntry {
  attr: string
  key: string
  def: string
}
export const REGISTRY: Record<string, RegEntry> = {
  nav: { attr: 'data-ax-nav', key: 'ax:nav', def: 'vertical' },
  'shell-style': { attr: 'data-ax-shell-style', key: 'ax:shell-style', def: 'default' },
  'sidebar-behavior': { attr: 'data-ax-sidebar-behavior', key: 'ax:sidebar-behavior', def: 'collapsible' },
  menu: { attr: 'data-ax-menu', key: 'ax:menu', def: 'click' },
  page: { attr: 'data-ax-page', key: 'ax:page', def: 'regular' },
  width: { attr: 'data-ax-width', key: 'ax:width', def: 'fluid' },
  'header-position': { attr: 'data-ax-header-position', key: 'ax:header-position', def: 'fixed' },
  'sidebar-position': { attr: 'data-ax-sidebar-position', key: 'ax:sidebar-position', def: 'fixed' },
  'sidebar-scheme': { attr: 'data-ax-sidebar', key: 'ax:sidebar-scheme', def: 'light' },
  'header-scheme': { attr: 'data-ax-header', key: 'ax:header-scheme', def: 'light' },
  'sidebar-image': { attr: 'data-ax-sidebar-image', key: 'ax:sidebar-image', def: 'none' },
  loader: { attr: 'data-ax-loader', key: 'ax:loader', def: 'on' },
  font: { attr: 'data-ax-font', key: 'ax:font', def: DEFAULT_FONT },
}

export interface Preset {
  value: string
  label: string
  base: string
}
export const PRESETS: Preset[] = [
  { value: 'verdigris', label: 'Verdigris', base: '#1E856C' },
  { value: 'cobalt', label: 'Cobalt', base: '#2A5FCC' },
  { value: 'indigo', label: 'Indigo', base: '#4F46C9' },
  { value: 'amethyst', label: 'Amethyst', base: '#8A46B5' },
  { value: 'magenta', label: 'Magenta', base: '#C13C84' },
  { value: 'terracotta', label: 'Terracotta', base: '#C25339' },
  { value: 'amber', label: 'Amber', base: '#C1820E' },
  { value: 'olive', label: 'Olive', base: '#647F1C' },
  { value: 'forest', label: 'Forest', base: '#2C7A4B' },
  { value: 'teal', label: 'Teal', base: '#10808F' },
  { value: 'slate', label: 'Slate', base: '#4A5A6B' },
  { value: 'graphite', label: 'Graphite', base: '#52514C' },
]

const ALL_KEYS = [
  'ax:theme', 'ax:accent', 'ax:accent-custom', 'ax:bg-custom', 'ax:bg-custom-dark',
  'ax:lang', 'ax:dir', 'ax:nav', 'ax:shell-style', 'ax:sidebar-behavior', 'ax:menu', 'ax:page', 'ax:width',
  'ax:header-position', 'ax:sidebar-position', 'ax:sidebar-scheme', 'ax:header-scheme',
  'ax:sidebar-image', 'ax:loader', 'ax:font', 'ax:font-custom', 'ax:font-weights',
  'ax:collapsed', 'ax:config',
]
const ALL_ATTRS = [
  'data-ax-theme', 'data-ax-accent', 'data-ax-nav', 'data-ax-shell-style', 'data-ax-sidebar-behavior',
  'data-ax-menu', 'data-ax-page', 'data-ax-width', 'data-ax-header-position', 'data-ax-sidebar-position',
  'data-ax-sidebar', 'data-ax-header', 'data-ax-sidebar-image', 'data-ax-loader', 'data-ax-font',
  'data-ax-collapsed',
]
export const RECENT_SWATCH_KEY = 'ax:accent-recent'

const ATTR_KEYS: [string, string, string][] = [
  ['data-ax-nav', 'ax:nav', 'vertical'],
  ['data-ax-shell-style', 'ax:shell-style', 'default'],
  ['data-ax-sidebar-behavior', 'ax:sidebar-behavior', 'collapsible'],
  ['data-ax-menu', 'ax:menu', 'click'],
  ['data-ax-page', 'ax:page', 'regular'],
  ['data-ax-width', 'ax:width', 'fluid'],
  ['data-ax-header-position', 'ax:header-position', 'fixed'],
  ['data-ax-sidebar-position', 'ax:sidebar-position', 'fixed'],
  ['data-ax-sidebar', 'ax:sidebar-scheme', 'light'],
  ['data-ax-header', 'ax:header-scheme', 'light'],
  ['data-ax-sidebar-image', 'ax:sidebar-image', 'none'],
  ['data-ax-loader', 'ax:loader', 'on'],
  ['data-ax-font', 'ax:font', DEFAULT_FONT],
]

export function emitChange(reason: string): void {
  document.dispatchEvent(new CustomEvent('ax:change', { detail: { reason } }))
}

/* ---------------- theme resolution ---------------- */

function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function resolveTheme(theme?: string): 'light' | 'dark' {
  const t = theme || store.get(PREFIX + 'theme') || 'system'
  return t === 'system' ? (systemDark() ? 'dark' : 'light') : (t as 'light' | 'dark')
}

export function applyCanvas(resolved?: string): void {
  const r = resolved || resolveTheme()
  const bg = store.get(r === 'dark' ? 'ax:bg-custom-dark' : 'ax:bg-custom')
  if (bg) D.style.setProperty('--ax-canvas', bg)
  else D.style.removeProperty('--ax-canvas')
}

/** Re-apply EVERY persisted attribute from storage onto <html> (idempotent). */
export function applyTheme(): void {
  store.ensureSchema()
  const resolved = resolveTheme()
  D.setAttribute('data-ax-theme', resolved)

  const accent = store.get(PREFIX + 'accent') || 'verdigris'
  if (accent === 'verdigris') D.removeAttribute('data-ax-accent')
  else D.setAttribute('data-ax-accent', accent)

  const lang = (store.get(PREFIX + 'lang') || 'EN').toUpperCase()
  D.setAttribute('lang', lang.toLowerCase())
  const dirStored = store.get(PREFIX + 'dir')
  D.setAttribute('dir', dirStored || (lang === 'AR' ? 'rtl' : 'ltr'))

  for (const [attr, key, def] of ATTR_KEYS) {
    const v = store.get(key)
    if (v && v !== def) D.setAttribute(attr, v)
    else D.removeAttribute(attr)
  }

  // FONT — the attribute is restored by the loop above; the webfont <link> and
  // (for a catalog family) the inline --ax-font-sans are not attributes, so keep
  // them in step here too. Matters after an Undo/restore, where the head script
  // has long since run against the pre-restore value.
  applyFont(
    store.get(PREFIX + 'font') || DEFAULT_FONT,
    store.get(PREFIX + 'font-custom'),
    store.get(PREFIX + 'font-weights') || undefined,
  )

  if (store.get(PREFIX + 'collapsed') === '1') D.setAttribute('data-ax-collapsed', '')
  else D.removeAttribute('data-ax-collapsed')

  const customAccent = store.get(PREFIX + 'accent-custom')
  if (accent === 'custom' && customAccent) {
    const ramp = deriveRamp(customAccent)
    for (const [prop, val] of Object.entries(ramp)) D.style.setProperty(prop, val)
    D.setAttribute('data-ax-accent', 'custom')
  }
  applyCanvas(resolved)
}

let _mql: MediaQueryList | null = null
export function listenSystem(): void {
  if (_mql) return
  try {
    _mql = window.matchMedia('(prefers-color-scheme: dark)')
  } catch {
    return
  }
  const onChange = (e: MediaQueryListEvent) => {
    const pref = store.get(PREFIX + 'theme') || 'system'
    if (pref !== 'system') return
    const resolved = e.matches ? 'dark' : 'light'
    D.setAttribute('data-ax-theme', resolved)
    applyCanvas(resolved)
    emitChange('system-theme')
  }
  if (_mql.addEventListener) _mql.addEventListener('change', onChange)
}

/* ---------------- generic writers ---------------- */

export function apply(attr: string, key: string, val: string, def: string): void {
  if (val === def) {
    D.removeAttribute(attr)
    store.remove(key)
  } else {
    D.setAttribute(attr, val)
    store.set(key, val)
  }
}

export function setByName(name: string, val: string): string {
  const r = REGISTRY[name]
  if (!r) return val
  apply(r.attr, r.key, val, r.def)
  emitChange(name)
  return val
}

/* ---------------- theme / accent / direction ---------------- */

export function setMode(m: string): string {
  if (m === 'system') {
    store.set('ax:theme', 'system')
    D.setAttribute('data-ax-theme', resolveTheme('system'))
    listenSystem()
  } else {
    store.set('ax:theme', m)
    D.setAttribute('data-ax-theme', m)
  }
  applyCanvas(D.getAttribute('data-ax-theme') || undefined)
  emitChange('theme')
  return m
}

export function quickToggleTheme(): string {
  const cur = D.getAttribute('data-ax-theme') === 'dark' ? 'dark' : 'light'
  return setMode(cur === 'dark' ? 'light' : 'dark')
}

export function setDir(d: string): string {
  if (d === 'rtl') {
    D.setAttribute('dir', 'rtl')
    store.set('ax:dir', 'rtl')
  } else {
    D.setAttribute('dir', 'ltr')
    store.remove('ax:dir')
  }
  emitChange('dir')
  return d
}

/* ---------------- font family ---------------- */

/**
 * Back to the shipped pairing (Inter body + Space Grotesk display): drops the
 * attribute, the stored family and its weight ramp, and the injected <link> —
 * index.html already requests Inter, so nothing extra is needed to render it.
 */
export function resetFont(): string {
  applyFont(DEFAULT_FONT)
  store.remove('ax:font-custom')
  store.remove('ax:font-weights')
  return setByName('font', DEFAULT_FONT)
}

/**
 * Swap the UI typeface to ANY Google family, by exact family name — search hits
 * and free text both land here. The webfont request is issued BEFORE the
 * attribute flips so the face is in flight while the fallback is still
 * painting; `display=swap` covers the gap. Picking Inter is redirected to
 * resetFont, since that IS the default rather than an override of it.
 *
 * The weight fragment is resolved from the catalog (families ship wildly
 * different ramps) and PERSISTED, because the anti-flash head script has to
 * rebuild this exact URL before first paint and cannot load the catalog to do
 * it. Unknown families — typed by hand, or added to Google Fonts after this
 * snapshot — fall back to the standard ramp, which the css2 endpoint narrows to
 * whatever actually exists. Returns the applied family, or null if blank.
 */
export function setCustomFont(family: string): string | null {
  const name = String(family || '').trim().replace(/\s+/g, ' ')
  if (!name) return null
  if (isDefaultFamily(name)) {
    resetFont()
    return DEFAULT_FAMILY
  }

  const entry = catalogEntry(name)
  const frag = entry ? weightQuery(entry.weights) : undefined

  applyFont(CUSTOM_FONT, name, frag)
  store.set('ax:font-custom', name)
  if (frag === undefined) store.remove('ax:font-weights')
  else store.set('ax:font-weights', frag)
  setByName('font', CUSTOM_FONT)
  return name
}

/** The family currently dressing the UI, by name. */
export function currentFontFamily(): string {
  if (currentValueOf('font') === CUSTOM_FONT) return store.get('ax:font-custom') || DEFAULT_FAMILY
  return DEFAULT_FAMILY
}

/** Pull in the family snapshot (lazy chunk). Resolves to the catalog array. */
export function loadFontCatalog(): Promise<FontRecord[]> {
  return loadCatalog()
}

/**
 * Search every Google family offline, loading the snapshot on first use, and
 * queue one preview request so each hit can render in its own typeface.
 */
export function searchFonts(query: string, limit?: number): Promise<FontRecord[]> {
  return loadCatalog().then(() => {
    const hits = searchCatalog(query, limit)
    ensureSearchPreviews(hits.map((f) => f.family))
    return hits
  })
}

function clearCustomAccentProps(): void {
  ;['--ax-accent', '--ax-on-accent', '--ax-accent-rgb', '--ax-accent-hover', '--ax-chart-1'].forEach((p) =>
    D.style.removeProperty(p),
  )
  for (let s = 50; s <= 900; s += 50) D.style.removeProperty(`--ax-accent-${s}`)
  D.style.removeProperty('--ax-accent-150')
}

export function setAccent(name: string): string {
  clearCustomAccentProps()
  store.remove('ax:accent-custom')
  if (name === 'verdigris') {
    D.removeAttribute('data-ax-accent')
    store.remove('ax:accent')
  } else {
    D.setAttribute('data-ax-accent', name)
    store.set('ax:accent', name)
  }
  emitChange('accent')
  return name
}

export function setCustomAccent(hex: string): string | null {
  if (!parseHex(hex)) return null
  const ramp = deriveRamp(hex)
  Object.entries(ramp).forEach(([prop, val]) => D.style.setProperty(prop, val))
  D.style.setProperty('--ax-on-accent', onColor(hex))
  D.setAttribute('data-ax-accent', 'custom')
  store.set('ax:accent', 'custom')
  store.set('ax:accent-custom', hex)
  pushRecentSwatch(hex)
  emitChange('accent')
  return hex
}

export function setCustomBg(hex: string): boolean {
  if (!parseHex(hex)) return false
  const dark = D.getAttribute('data-ax-theme') === 'dark'
  store.set(dark ? 'ax:bg-custom-dark' : 'ax:bg-custom', hex)
  D.style.setProperty('--ax-canvas', hex)
  emitChange('canvas')
  return isLowContrast(hex)
}

export function isLowContrast(hex: string): boolean {
  const rgb = parseHex(hex)
  if (!rgb) return false
  const L = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255
  return L > 0.35 && L < 0.72
}

export function recentSwatches(): string[] {
  try {
    return JSON.parse(store.get(RECENT_SWATCH_KEY) || '[]')
  } catch {
    return []
  }
}
function pushRecentSwatch(hex: string): void {
  const list = [hex, ...recentSwatches().filter((h) => h !== hex)].slice(0, 6)
  store.set(RECENT_SWATCH_KEY, JSON.stringify(list))
}

/* ---------------- reset / copy ---------------- */

export function currentConfig(): Record<string, string> {
  const cfg: Record<string, string> = {}
  ALL_KEYS.forEach((k) => {
    const v = store.get(k)
    if (v != null && k !== 'ax:config') cfg[k.replace(PREFIX, '')] = v
  })
  return cfg
}

export function reset(): void {
  ALL_KEYS.forEach((k) => store.remove(k))
  store.remove(RECENT_SWATCH_KEY)
  ALL_ATTRS.forEach((a) => D.removeAttribute(a))
  applyFont(DEFAULT_FONT) // tear the injected Google Fonts <link> back down
  D.removeAttribute('dir')
  D.setAttribute('dir', 'ltr')
  D.removeAttribute('style')
  D.setAttribute('data-ax-theme', resolveTheme('system'))
  store.ensureSchema()
  emitChange('reset')
}

export function copyConfig(): string {
  const json = JSON.stringify(currentConfig(), null, 2)
  store.set('ax:config', json)
  if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {})
  return json
}

export function currentValueOf(name: string): string {
  if (name === 'theme' || name === 'mode') return store.get('ax:theme') || 'system'
  if (name === 'dir') return D.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr'
  if (name === 'accent') return D.getAttribute('data-ax-accent') || 'verdigris'
  const r = REGISTRY[name]
  return r ? D.getAttribute(r.attr) || r.def : ''
}

/** Boot: re-sync from storage + wire the live system listener. */
export function bootTheme(): void {
  applyTheme()
  listenSystem()
}
