/*
 * dropdown / popover helper (Vue edition). Native re-expression of the
 * Alpine axDropdown() component: open/close state + click-outside + Escape close.
 * Returns a ref to bind to the popover root and reactive `open` state.
 */
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

export function useDropdown(): {
  open: Ref<boolean>
  root: Ref<HTMLElement | null>
  toggle: () => void
  close: () => void
} {
  const open = ref(false)
  const root = ref<HTMLElement | null>(null)

  function toggle() {
    open.value = !open.value
  }
  function close() {
    open.value = false
  }
  function onDocClick(e: MouseEvent) {
    if (!open.value) return
    if (root.value && !root.value.contains(e.target as Node)) close()
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }

  onMounted(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
  })

  return { open, root, toggle, close }
}
