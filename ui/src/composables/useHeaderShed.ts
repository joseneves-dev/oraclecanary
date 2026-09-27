/*
 * responsive header SHED signal (Vue edition).
 *
 * Port of _bindBands() in src/js/alpine/index.js (02-shell §4.12). The utility
 * cluster is eleven controls wide; below each band the bar copy of a control is
 * hidden by shell.css §18 and the matching `[data-ax-shed]` row inside the
 * overflow menu is revealed. This watcher owns exactly ONE decision: whether the
 * "More" trigger exists at all. Per-row visibility is the CSS's job — never hide
 * the rows from here, or a control ends up with zero reachable copies.
 *
 * BANDS — keep in lockstep with shell.css §18:
 *   < 992px (lg) … language · fullscreen · app-grid
 *   < 768px (md) … + cart · customizer
 */
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

export function useHeaderShed(): Ref<string[]> {
  const shed = ref<string[]>([])
  let timer: ReturnType<typeof setTimeout> | null = null

  function update(): void {
    let w = 9999
    try {
      w = window.innerWidth
    } catch {
      /* noop */
    }
    const next: string[] = []
    if (w < 992) next.push('lang', 'fullscreen', 'apps')
    if (w < 768) next.push('cart', 'customizer')
    shed.value = next
  }

  // debounced ~150ms, like the reference's resize binding
  function onResize(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(update, 150)
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', onResize)
  })
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    window.removeEventListener('resize', onResize)
  })

  return shed
}
