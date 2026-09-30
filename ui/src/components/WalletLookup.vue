<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useSolanaWallets, type WalletOption } from '@/composables/useSolanaWallets'

/**
 * Paste a Solana address or connect a wallet (read-only: only its address is asked for), then
 * `lookup` is emitted with the address. Used in the Overview hero and on the positions page.
 */

const props = withDefaults(defineProps<{ initial?: string; large?: boolean }>(), { initial: '', large: false })
const emit = defineEmits<{ lookup: [address: string] }>()

/** A wallet that has borrowed against a tokenized stock on Kamino, whose price pauses when the US market closes. */
const EXAMPLE_WALLET = 'BKLBmxGDFrGK63QwhFgUcvqRQfWnTeJzUeMaoKcDGcvH'
/** Some wallets never settle when their popup is closed; the button must not wait forever. */
const CONNECT_TIMEOUT_MS = 60_000

const input = ref(props.initial)
// Follows the page, e.g. when the URL's address changes.
watch(
  () => props.initial,
  (value) => (input.value = value),
)

/** A Solana address: 32 to 44 base58 characters. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** Said next to the field instead of a greyed-out button, which reads as broken. */
const inputError = ref<string | null>(null)
watch(input, () => (inputError.value = null))

function submit(value = input.value) {
  const trimmed = value.trim()
  input.value = trimmed
  if (!trimmed) {
    inputError.value = 'Paste a wallet address first, or connect a wallet.'
    return
  }
  if (!ADDRESS.test(trimmed)) {
    inputError.value = 'That is not a Solana address. It is 32 to 44 letters and digits, like the one in your wallet.'
    return
  }
  emit('lookup', trimmed)
}

const { available } = useSolanaWallets()
/** Shown when several wallets are installed, so the user picks one. */
const choices = shallowRef<WalletOption[]>([])
const connectError = ref<string | null>(null)
const connecting = ref(false)

function connectWallet() {
  connectError.value = null
  const found = available()
  choices.value = found.length > 1 ? found : []
  if (found.length === 1) connect(found[0])
  if (!found.length) {
    connectError.value =
      'No Solana wallet found in this browser. Paste your wallet address instead, or open this page in your wallet app’s browser on mobile.'
  }
}

async function connect(wallet: WalletOption) {
  connectError.value = null
  choices.value = []
  connecting.value = true
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${wallet.name} did not answer`)), CONNECT_TIMEOUT_MS)
    })
    submit(await Promise.race([wallet.connect(), timeout]))
  } catch (e) {
    const reason = (e as { message?: string })?.message
    connectError.value = `Could not connect${reason ? `: ${reason}` : ''}. Approve the request in ${wallet.name}, or paste your address instead.`
  } finally {
    clearTimeout(timer)
    connecting.value = false
  }
}
</script>

<template>
  <div class="lookup" :class="{ 'lookup--large': large }">
    <form class="lookup__row" @submit.prevent="submit()">
      <input
        v-model="input"
        type="text"
        class="ax-input lookup__input"
        :class="large ? 'ax-input--lg' : 'ax-input--sm'"
        placeholder="Paste a Solana wallet address"
        aria-label="Wallet address"
        :aria-invalid="inputError ? true : undefined"
        :aria-describedby="inputError ? 'lookup-error' : undefined"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="lookup__buttons">
        <button type="submit" class="ax-btn ax-btn--primary" :class="large ? 'ax-btn--lg' : 'ax-btn--sm'">
          Check my wallet
        </button>
        <button type="button" class="ax-btn ax-btn--secondary" :class="large ? 'ax-btn--lg' : 'ax-btn--sm'" :disabled="connecting" @click="connectWallet">
          {{ connecting ? 'Waiting for the wallet…' : 'Connect wallet' }}
        </button>
      </div>
    </form>
    <p v-if="inputError" id="lookup-error" class="lookup__error" role="alert">{{ inputError }}</p>
    <div v-if="choices.length" class="lookup__row" role="group" aria-label="Choose a wallet">
      <span class="muted">Which wallet?</span>
      <button v-for="w in choices" :key="w.name" type="button" class="ax-btn ax-btn--secondary ax-btn--sm lookup__choice" :disabled="connecting" @click="connect(w)">
        <img v-if="w.icon" :src="w.icon" alt="" width="16" height="16" />
        {{ w.name }}
      </button>
    </div>
    <p class="muted">
      Checks your Kamino and marginfi deposits, loans and vault shares. Read-only: nothing is signed. No wallet at hand?
      <button type="button" class="link-button" @click="submit(EXAMPLE_WALLET)">See an example wallet</button>.
    </p>
    <div v-if="connectError" class="ax-alert ax-alert--warning" role="alert">{{ connectError }}</div>
  </div>
</template>

<style scoped>
.lookup {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-3);
}
.lookup__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-2);
}
.lookup__input {
  flex: 1 1 320px;
  max-width: 520px;
}
/* iOS zooms into inputs under 16px. */
.lookup--large .lookup__input {
  font-size: max(16px, var(--ax-text-md, 1rem));
}
.lookup__error {
  margin: 0;
  font-size: var(--ax-text-sm);
  color: var(--ax-danger-500);
}
.lookup__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-2);
}
.lookup__choice {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.link-button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ax-link);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
@media (max-width: 640px) {
  .lookup__input {
    flex-basis: 100%;
    max-width: none;
  }
  .lookup__buttons,
  .lookup__buttons .ax-btn {
    flex: 1 1 auto;
  }
}
</style>
