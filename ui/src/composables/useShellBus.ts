/*
 * Vireo — shell event bus (Vue edition). Tiny reactive flags the layout uses
 * to open the command palette (⌘K) from anywhere (header button, keyboard
 * shortcut).
 */
import { ref } from 'vue'

const commandOpen = ref(false)

export function useShellBus() {
  return {
    commandOpen,
    openCommand: () => (commandOpen.value = true),
    closeCommand: () => (commandOpen.value = false),
  }
}
