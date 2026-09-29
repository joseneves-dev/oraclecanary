import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

/**
 * Finds the Solana wallets installed in the browser, only to read the user's address: nothing here
 * signs or sends anything.
 *
 * Wallets announce themselves through the Wallet Standard (Phantom, Solflare, Backpack, Trust,
 * MetaMask and most others do); a wallet that only injects the older `window.solana` style provider
 * is used when no standard wallet is found. Written by hand rather than with a wallet-adapter library,
 * which would bring in far more than this page needs.
 */

export interface WalletOption {
  name: string
  /** A data: URL, as wallets provide it. */
  icon?: string
  /** Asks the wallet for permission and returns the address it shares. */
  connect(): Promise<string>
}

/** The parts of the Wallet Standard this reads. */
interface StandardAccount {
  address: string
  chains?: readonly string[]
}
interface StandardWallet {
  name: string
  icon?: string
  chains?: readonly string[]
  accounts?: readonly StandardAccount[]
  features?: Record<string, unknown>
}
interface StandardConnect {
  connect(input?: { silent?: boolean }): Promise<{ accounts?: readonly StandardAccount[] }>
}
interface LegacyProvider {
  connect(): Promise<{ publicKey?: { toString(): string } } | void>
  publicKey?: { toString(): string } | null
}

const isSolana = (chain: string) => chain.startsWith('solana:')

function fromStandard(wallet: StandardWallet): WalletOption | null {
  const feature = wallet.features?.['standard:connect'] as StandardConnect | undefined
  if (!feature || !wallet.chains?.some(isSolana)) return null
  return {
    name: wallet.name,
    icon: wallet.icon,
    async connect() {
      const result = await feature.connect()
      const accounts = result?.accounts?.length ? result.accounts : (wallet.accounts ?? [])
      // A wallet serving several chains (MetaMask, Trust) lists its other accounts too.
      const account = accounts.find((a) => !a.chains || a.chains.some(isSolana))
      if (!account) throw new Error("no Solana account was shared")
      return account.address
    },
  }
}

function fromLegacy(name: string, provider: LegacyProvider): WalletOption {
  return {
    name,
    async connect() {
      const result = await provider.connect()
      const key = (result && result.publicKey) ?? provider.publicKey
      if (!key) throw new Error("no address was shared")
      return key.toString()
    },
  }
}

/** Wallets that inject only a `window.*` provider; checked when no standard wallet was found. */
function legacyWallets(): WalletOption[] {
  const w = window as unknown as {
    phantom?: { solana?: LegacyProvider }
    solflare?: LegacyProvider & { isSolflare?: boolean }
    backpack?: LegacyProvider
    solana?: LegacyProvider & { isPhantom?: boolean; isTrust?: boolean }
  }
  const found: WalletOption[] = []
  if (w.phantom?.solana) found.push(fromLegacy('Phantom', w.phantom.solana))
  if (w.solflare?.isSolflare) found.push(fromLegacy('Solflare', w.solflare))
  if (w.backpack) found.push(fromLegacy('Backpack', w.backpack))
  if (!found.length && w.solana) found.push(fromLegacy(w.solana.isTrust ? 'Trust Wallet' : 'your wallet', w.solana))
  return found
}

export function useSolanaWallets() {
  const standard = shallowRef<WalletOption[]>([])

  function register(...wallets: StandardWallet[]) {
    const next = [...standard.value]
    for (const wallet of wallets) {
      const option = fromStandard(wallet)
      // Some wallets register once per chain family under the same name.
      if (option && !next.some((o) => o.name === option.name)) next.push(option)
    }
    standard.value = next
    return () => {}
  }
  // A wallet that loads after the page announces itself with this event.
  const onRegister = (event: Event) => {
    const callback = (event as CustomEvent<(api: { register: typeof register }) => void>).detail
    if (typeof callback === 'function') callback({ register })
  }

  onMounted(() => {
    window.addEventListener('wallet-standard:register-wallet', onRegister)
    // Wallets already loaded register in answer to this.
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register } }))
  })
  onBeforeUnmount(() => window.removeEventListener('wallet-standard:register-wallet', onRegister))

  /** The wallets to offer now: the standard ones, or else the older injected providers. */
  function available(): WalletOption[] {
    return standard.value.length ? standard.value : legacyWallets()
  }

  return { available }
}
