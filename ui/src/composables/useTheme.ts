/*
 * Light/dark mode and the collapsed sidebar rail.
 *
 * The first paint is set by the inline script in index.html (same storage keys), so this only keeps
 * the reactive state in sync and applies the header toggles. The accent colour and fonts are fixed.
 */
import { reactive, readonly } from 'vue'

const THEME_KEY = 'oc:theme'
const COLLAPSED_KEY = 'oc:sidebar-collapsed'

const D = document.documentElement

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage blocked (private mode, site data disabled): the choice lasts for this page only.
  }
}

const state = reactive({
  resolved: (D.getAttribute('data-ax-theme') === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
  collapsed: D.hasAttribute('data-ax-collapsed'),
})

function applyTheme(resolved: 'light' | 'dark'): void {
  D.setAttribute('data-ax-theme', resolved)
  state.resolved = resolved
}

let booted = false
function boot(): void {
  if (booted) return
  booted = true
  // Follow the system setting until the viewer picks a mode with the toggle.
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!read(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light')
    })
  } catch {
    // No matchMedia: keep the mode set at load.
  }
}

export function useTheme() {
  boot()
  return {
    state: readonly(state),
    toggleTheme() {
      const next = state.resolved === 'dark' ? 'light' : 'dark'
      write(THEME_KEY, next)
      applyTheme(next)
    },
    toggleSidebar() {
      state.collapsed = D.toggleAttribute('data-ax-collapsed')
      write(COLLAPSED_KEY, state.collapsed ? '1' : null)
    },
  }
}
