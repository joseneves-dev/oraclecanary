/*
 * shell event bus (Vue edition). Tiny reactive flags the layout uses
 * to open the command palette (⌘K) and the customizer offcanvas from anywhere
 * (header buttons, keyboard shortcut, command-palette actions). Replaces the
 * reference's `$dispatch('ax-command-open')` / `ax-customizer-open` events.
 */
import { ref } from 'vue'

const commandOpen = ref(false)
const customizerOpen = ref(false)

export function useShellBus() {
  return {
    commandOpen,
    customizerOpen,
    openCommand: () => (commandOpen.value = true),
    closeCommand: () => (commandOpen.value = false),
    openCustomizer: () => (customizerOpen.value = true),
    closeCustomizer: () => (customizerOpen.value = false),
  }
}
