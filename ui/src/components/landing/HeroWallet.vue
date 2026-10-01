<script setup lang="ts">
/* Paste a wallet in the hero: opens My positions for it. */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const value = ref('')
const error = ref<string | null>(null)
/** The full prompt does not fit a phone-width field. */
const placeholder = ref('Paste a Solana wallet to check your positions')
onMounted(() => {
  if (window.innerWidth < 520) placeholder.value = 'Paste a Solana wallet'
})

/** A Solana address: 32–44 base58 characters. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function submit() {
  const address = value.value.trim()
  value.value = address
  if (!address) {
    error.value = 'Paste a wallet address first.'
    return
  }
  if (!BASE58.test(address)) {
    error.value = 'That does not look like a Solana address.'
    return
  }
  error.value = null
  void router.push({ name: 'positions', query: { address } })
}
</script>

<template>
  <form class="wallet" :class="{ 'wallet--error': error }" novalidate @submit.prevent="submit">
    <label class="wallet__field">
      <span class="sr-only">Solana wallet address</span>
      <svg class="wallet__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4" />
        <path d="M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3" />
        <path d="M20 9h-4a3 3 0 0 0 0 6h4z" />
      </svg>
      <input
        v-model="value"
        type="text"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :placeholder="placeholder"
        :aria-invalid="!!error"
        aria-describedby="wallet-hint"
        @input="error = null"
      />
    </label>
    <button type="submit" class="wallet__btn">Check <span aria-hidden="true">→</span></button>
    <p id="wallet-hint" class="wallet__hint" :class="{ 'is-error': error, 'is-quiet': !error }" aria-live="polite">
      {{ error ?? 'Kamino and marginfi loans and Kamino vault shares. Read-only, nothing to sign.' }}
    </p>
  </form>
</template>

<style scoped>
.wallet {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0;
  flex: 1 1 420px;
  max-width: 560px;
}
.wallet__field {
  position: relative;
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  align-items: center;
}
.wallet__icon {
  position: absolute;
  left: 14px;
  color: var(--lp-ink-3);
  pointer-events: none;
}
.wallet input {
  width: 100%;
  height: 48px;
  padding: 0 14px 0 42px;
  border: 1px solid var(--lp-line-strong);
  border-right: 0;
  border-radius: 12px 0 0 12px;
  background: var(--lp-panel);
  color: var(--lp-ink);
  font: 500 14.5px/1 var(--lp-sans);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.wallet input::placeholder {
  color: var(--lp-ink-3);
}
.wallet input:focus {
  border-color: var(--lp-accent-line);
  box-shadow: 0 0 0 3px var(--lp-accent-ring);
}
.wallet--error input {
  border-color: var(--lp-crit);
}
.wallet__btn {
  height: 48px;
  padding: 0 18px;
  border: 1px solid var(--lp-line-strong);
  border-radius: 0 12px 12px 0;
  background: var(--lp-fill-strong);
  color: var(--lp-ink);
  font: 600 14.5px/1 var(--lp-sans);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s, border-color 0.15s;
}
.wallet__btn:hover {
  border-color: var(--lp-accent-line);
  background: var(--lp-fill);
}
.wallet__btn:focus-visible {
  outline: 2px solid var(--lp-focus);
  outline-offset: 2px;
}
.wallet__hint {
  flex-basis: 100%;
  margin: 8px 0 0 2px;
  font-size: 12.5px;
  color: var(--lp-ink-3);
}
.wallet__hint.is-quiet {
  /* the scope note shows while typing, without pushing the page down */
  position: absolute;
  top: 100%;
  left: 0;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
.wallet:focus-within .wallet__hint.is-quiet {
  opacity: 1;
}
.wallet__hint.is-error {
  color: var(--lp-crit-text);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (max-width: 640px) {
  .wallet {
    flex-basis: 100%;
  }
  .wallet input {
    font-size: 16px; /* no zoom on iOS */
  }
}
</style>
