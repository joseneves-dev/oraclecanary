/*
 * Vireo — mobile sidebar DRAWER (Vue edition).
 *
 * Native re-expression of the drawer half of src/js/core/sidebar.js. Below the
 * drawer band base.css translates `.ax-sidebar` off the inline start and only
 * `[data-ax-drawer='open']` on <html> brings it back, so the phone sidebar needs
 * this state machine: attribute + body scroll-lock + scrim.
 *
 * The three bugs the reference module was fixed for cannot occur here, because
 * the scrim is a COMPONENT-OWNED element rather than something built and located
 * by a global query:
 *   · it is rendered by AppLayout, so nothing ever has to find it by class —
 *     content pages (crm/*, jobs/*) paint their own `.ax-backdrop` and a bare
 *     class query used to match THEIRS;
 *   · it is a SIBLING of `.ax-sidebar` inside `.ax-layout` (which is
 *     `isolation:isolate`), so 900 (scrim) < 1100 (drawer) compare in the same
 *     stacking context instead of the scrim painting over the open drawer;
 *   · its resting state is the `[data-ax-drawer-scrim]` hidden pair in base.css,
 *     reached simply by dropping `is-visible`.
 * The matchMedia listener below is ported as-is: growing past the band hands the
 * sidebar back to the docked layout, and without it `data-ax-drawer="open"`, the
 * scroll-lock and the scrim all survived into the docked layout.
 */
import { ref, onMounted, onBeforeUnmount, nextTick, type Ref } from 'vue'

const MOBILE_MQ = '(max-width: 767.98px)'

/** Shared drawer state — exported so the header toggle can read it too. */
export const drawerOpen = ref(false)

export function isMobile(): boolean {
  try {
    return window.matchMedia(MOBILE_MQ).matches
  } catch {
    return false
  }
}

const D = typeof document !== 'undefined' ? document.documentElement : null

export function openDrawer(): void {
  if (!D || drawerOpen.value) return
  drawerOpen.value = true
  D.setAttribute('data-ax-drawer', 'open')
  document.body.style.overflow = 'hidden'
  // The reference traps focus in the sidebar and lands on the menu filter; only
  // the initial focus is ported here (no trap utility ships in this edition).
  nextTick(() => {
    const filter = document.querySelector<HTMLElement>('.ax-sidebar__filter')
    filter?.focus()
  })
}

export function closeDrawer(): void {
  if (!D || !D.hasAttribute('data-ax-drawer')) return
  drawerOpen.value = false
  D.removeAttribute('data-ax-drawer')
  document.body.style.overflow = ''
}

export function toggleDrawer(): void {
  drawerOpen.value ? closeDrawer() : openDrawer()
}

/** Reactive drawer state + the Esc / breakpoint wiring, owned by the layout. */
export function useDrawer(): {
  open: Ref<boolean>
  isMobile: typeof isMobile
  openDrawer: typeof openDrawer
  closeDrawer: typeof closeDrawer
  toggleDrawer: typeof toggleDrawer
} {
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && drawerOpen.value) closeDrawer()
  }
  function onBand(e: MediaQueryListEvent) {
    if (!e.matches) closeDrawer()
  }
  let mq: MediaQueryList | null = null

  onMounted(() => {
    document.addEventListener('keydown', onKey)
    try {
      mq = window.matchMedia(MOBILE_MQ)
      mq.addEventListener('change', onBand)
    } catch {
      /* noop */
    }
  })
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKey)
    mq?.removeEventListener('change', onBand)
    closeDrawer()
  })

  return { open: drawerOpen, isMobile, openDrawer, closeDrawer, toggleDrawer }
}
