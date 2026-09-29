<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  fetchReserve,
  fetchVault,
  fetchWalletPositions,
  type Reserve,
  type Severity,
  type Vault,
  type WalletPosition,
  type WalletPositions,
} from '@/api/client'
import KpiCard from '@/components/KpiCard.vue'
import ReserveTags from '@/components/ReserveTags.vue'
import SeverityBadge from '@/components/SeverityBadge.vue'
import { useSolanaWallets, type WalletOption } from '@/composables/useSolanaWallets'
import { shortAddress, usd } from '@/lib/format'

/**
 * A wallet's deposits and loans in the monitored protocols, each with the health of the price it
 * depends on. The wallet is only an address: connecting reads its public key and nothing is signed.
 *
 * On Kamino and marginfi a loan account (obligation, marginfi account) acts on all its prices at
 * once: when one is unusable, the whole account cannot borrow, withdraw or be liquidated. So the
 * page judges accounts, not only rows.
 */

const route = useRoute()
const router = useRouter()

/** A wallet that has borrowed against a tokenized stock on Kamino, whose price pauses when the US market closes. */
const EXAMPLE_WALLET = 'BKLBmxGDFrGK63QwhFgUcvqRQfWnTeJzUeMaoKcDGcvH'
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** Checks that make the protocol refuse a price (see health.ts); PRICE_DEVIATION prices are still used. */
const BLOCKING = new Set(['STALE', 'NO_ORACLE', 'EMPTY_PRICE_ENTRY', 'DEPRECATED_PROVIDER'])
/** Some wallets never settle when their popup is closed; the button must not wait forever. */
const CONNECT_TIMEOUT_MS = 60_000

const PROTOCOL_LABEL: Record<WalletPosition['protocol'], string> = {
  kamino: 'Kamino',
  marginfi: 'marginfi',
  'kamino-vault': 'Kamino vault',
}
const SOURCE_LABEL: Record<string, string> = {
  kamino: 'Kamino',
  marginfi: 'marginfi',
  'kamino-vault': 'Kamino vault',
  'jupiter-lend': 'Jupiter Lend',
}
const sourceNames = (list: string[]) => list.map((s) => SOURCE_LABEL[s] ?? s).join(', ')

// ---- The address: typed, pasted, or read from a connected wallet; kept in the URL (?address=). ----

const address = computed(() => (typeof route.query.address === 'string' ? route.query.address.trim() : ''))
const input = ref(address.value)
// Follows the URL, e.g. when the menu link clears it or the browser goes back.
watch(address, (value) => (input.value = value))
/** Bumped by "Check" on the address already shown, which leaves the URL unchanged, to load it again. */
const reload = ref(0)

function check(value = input.value) {
  const trimmed = value.trim()
  input.value = trimmed
  if (trimmed === address.value) reload.value++
  else router.replace({ query: trimmed ? { address: trimmed } : {} })
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
    check(await Promise.race([wallet.connect(), timeout]))
  } catch (e) {
    const reason = (e as { message?: string })?.message
    connectError.value = `Could not connect${reason ? `: ${reason}` : ''}. Approve the request in ${wallet.name}, or paste your address instead.`
  } finally {
    clearTimeout(timer)
    connecting.value = false
  }
}

// ---- Loading the positions and the health behind each one. ----

/** What a row's price means for it; accounts inherit the worst of their rows' blocked/paused states. */
type State = 'blocked' | 'paused' | 'overvalued' | 'weak' | 'unknown' | 'ok'
const STATE_RANK: Record<State, number> = { blocked: 5, overvalued: 4, paused: 3, weak: 2, unknown: 1, ok: 0 }

interface Row {
  key: string
  protocol: WalletPosition['protocol']
  side: 'Deposit' | 'Borrow' | 'Vault deposit'
  /** Loan account the row belongs to; vault shares have none. */
  account: string | null
  name: string
  market: string | null
  to: { name: 'reserve' | 'vault'; params: { address: string } }
  /** Null when it cannot be valued (a vault OracleCanary does not track). */
  usd: number | null
  tokens: string | null
  severity: Severity | null
  state: State
  issue: string
  checks: Reserve['checks']
  /** Vaults only: the wallet's share of vault money in markets with an unusable price. */
  atRiskUsd: number
}

const data = ref<WalletPositions | null>(null)
const rawRows = ref<Row[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/** The most telling message of a reserve: its worst check. */
function mainIssue(checks: Reserve['checks']): string {
  const rank: Record<string, number> = { critical: 3, warning: 2, info: 1 }
  return [...checks].sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0))[0]?.message ?? 'Price is healthy.'
}

function stateOf(reserve: Reserve): State {
  const critical = reserve.checks.filter((c) => c.severity === 'critical')
  const blocking = critical.filter((c) => BLOCKING.has(c.code))
  const closed = reserve.checks.some((c) => c.code === 'MARKET_CLOSED')
  // A stock paused by its closed market, with nothing else wrong, is expected rather than broken.
  if (blocking.length) return closed && blocking.every((c) => c.code === 'STALE') ? 'paused' : 'blocked'
  if (critical.some((c) => c.code === 'PRICE_DEVIATION')) return 'overvalued'
  if (critical.length || reserve.severity === 'warning') return 'weak'
  return 'ok'
}

const tokenAmount = (value: number) =>
  value.toLocaleString('en', value >= 1000 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 4 })

function reserveRow(p: Extract<WalletPosition, { reserve: string }>, reserve: Reserve | null | undefined, i: number): Row {
  const checks = reserve?.checks ?? []
  return {
    key: `${p.account}-${p.reserve}-${p.side}-${i}`,
    protocol: p.protocol,
    side: p.side === 'borrow' ? 'Borrow' : 'Deposit',
    account: p.account,
    name: reserve?.asset || shortAddress(p.reserve),
    market: reserve?.market.name ?? null,
    to: { name: 'reserve', params: { address: p.reserve } },
    usd: p.usd,
    tokens: reserve?.asset && typeof p.tokens === 'number' ? `${tokenAmount(p.tokens)} ${reserve.asset}` : null,
    severity: reserve ? reserve.severity : null,
    state: reserve ? stateOf(reserve) : 'unknown',
    issue:
      reserve === undefined
        ? 'Health could not be loaded right now.'
        : reserve === null
          ? 'Not monitored: this reserve is not tracked by OracleCanary.'
          : mainIssue(checks),
    checks,
    atRiskUsd: 0,
  }
}

function vaultRow(p: Extract<WalletPosition, { vault: string }>, vault: Vault | null | undefined, i: number): Row {
  const atRisk = vault ? p.share * vault.atRiskUsd : 0
  return {
    key: `${p.vault}-${i}`,
    protocol: p.protocol,
    side: 'Vault deposit',
    account: null,
    name: vault?.name ?? shortAddress(p.vault),
    market: vault?.curator ? `Curated by ${vault.curator}` : null,
    to: { name: 'vault', params: { address: p.vault } },
    usd: vault ? p.share * vault.totalUsd : null,
    tokens: null,
    severity: vault ? vault.worstSeverity : null,
    state: !vault ? 'unknown' : atRisk > 0 ? 'blocked' : vault.worstSeverity === 'warning' || vault.worstSeverity === 'critical' ? 'weak' : 'ok',
    issue:
      vault === undefined
        ? 'Health could not be loaded right now.'
        : vault === null
          ? 'Not monitored: this vault is not tracked by OracleCanary.'
          : atRisk > 0
            ? `${usd(atRisk)} of your share is lent into markets with an unusable price, where loans cannot be liquidated.`
            : 'Every reserve and market this vault lends into has a usable price.',
    checks: [],
    atRiskUsd: atRisk,
  }
}

watch(
  [address, reload],
  async ([value], _previous, onCleanup) => {
    data.value = null
    rawRows.value = []
    error.value = null
    loading.value = false
    if (!value) return
    if (!ADDRESS.test(value)) {
      error.value = 'That is not a Solana address. It is 32 to 44 letters and digits, like the one in your wallet.'
      return
    }
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    loading.value = true
    try {
      const result = await fetchWalletPositions(value, controller.signal)
      // Each reserve or vault once, however many positions use it; a failed one becomes undefined.
      const reserves = new Map<string, Promise<Reserve | null | undefined>>()
      const vaults = new Map<string, Promise<Vault | null | undefined>>()
      const reserveOf = (a: string) => {
        if (!reserves.has(a)) reserves.set(a, fetchReserve(a, controller.signal).catch(() => undefined))
        return reserves.get(a)!
      }
      const vaultOf = (a: string) => {
        if (!vaults.has(a)) vaults.set(a, fetchVault(a, controller.signal).catch(() => undefined))
        return vaults.get(a)!
      }
      const built = await Promise.all(
        result.positions.map(async (p, i) => ('reserve' in p ? reserveRow(p, await reserveOf(p.reserve), i) : vaultRow(p, await vaultOf(p.vault), i))),
      )
      // A newer address may have been asked for while these loaded.
      if (controller.signal.aborted) return
      data.value = result
      rawRows.value = built
    } catch (e) {
      if (!controller.signal.aborted) error.value = (e as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  },
  { immediate: true },
)

// ---- Accounts, totals and the answer. ----

/** Loan accounts that cannot act now, and the prices responsible. */
const accountStates = computed(() => {
  const states = new Map<string, { state: 'blocked' | 'paused'; by: Set<string> }>()
  for (const r of rawRows.value) {
    if (!r.account || (r.state !== 'blocked' && r.state !== 'paused')) continue
    const current = states.get(r.account)
    const state = current?.state === 'blocked' || r.state === 'blocked' ? 'blocked' : 'paused'
    const by = current?.by ?? new Set<string>()
    by.add(r.name)
    states.set(r.account, { state, by })
  }
  return states
})

/** Rows with the account's state applied, worst first, then largest. */
const rows = computed(() =>
  rawRows.value
    .map((r) => {
      const account = r.account ? accountStates.value.get(r.account) : undefined
      if (!account || STATE_RANK[account.state] <= STATE_RANK[r.state]) return r
      const by = [...account.by].join(', ')
      const effect = account.state === 'blocked' ? 'cannot use' : 'pauses while its market is closed'
      return { ...r, state: account.state, issue: `${r.issue} Its loan account is held up too: the protocol ${effect} the price of ${by}.` }
    })
    .sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || (b.usd ?? 0) - (a.usd ?? 0)),
)

const sum = (list: Row[]) => list.reduce((s, r) => s + (r.usd ?? 0), 0)
const deposits = computed(() => sum(rows.value.filter((r) => r.side !== 'Borrow')))
const borrowed = computed(() => sum(rows.value.filter((r) => r.side === 'Borrow')))
const inAccounts = (state: 'blocked' | 'paused') => rows.value.filter((r) => r.account && r.state === state)
const vaultAtRisk = computed(() => rows.value.reduce((s, r) => s + r.atRiskUsd, 0))
const atRiskNow = computed(() => sum(inAccounts('blocked').filter((r) => r.side === 'Deposit')) + vaultAtRisk.value)

/** "$X of deposits and $Y of loans", leaving out a side that is empty. */
function sides(list: Row[]): string {
  const dep = sum(list.filter((r) => r.side !== 'Borrow'))
  const loans = sum(list.filter((r) => r.side === 'Borrow'))
  return [dep > 0 ? `${usd(dep)} of deposits` : '', loans > 0 ? `${usd(loans)} of loans` : ''].filter(Boolean).join(' and ')
}
const namesOf = (state: 'blocked' | 'paused') =>
  [...new Set([...accountStates.value.values()].filter((a) => a.state === state).flatMap((a) => [...a.by]))].join(', ')

type Tone = 'danger' | 'warning' | 'info' | 'success' | 'neutral'
const notes = computed<{ tone: Tone; text: string }[]>(() => {
  if (!data.value) return []
  const list: { tone: Tone; text: string }[] = []
  const blocked = inAccounts('blocked')
  if (blocked.length) {
    list.push({
      tone: 'danger',
      text: `${sides(blocked)} are in loan accounts that use a price the protocol cannot use right now (${namesOf('blocked')}). Until it updates, those accounts cannot borrow or withdraw, and cannot be liquidated.`,
    })
  }
  if (vaultAtRisk.value > 0) {
    list.push({ tone: 'danger', text: `${usd(vaultAtRisk.value)} of your vault deposits is lent into markets with an unusable price, where loans cannot be liquidated.` })
  }
  const overvalued = rows.value.filter((r) => r.state === 'overvalued')
  if (overvalued.length) {
    list.push({ tone: 'warning', text: `${usd(sum(overvalued))} depends on a price well above the market: that collateral is overvalued. See the Price column.` })
  }
  const paused = inAccounts('paused')
  if (paused.length) {
    list.push({
      tone: 'info',
      text: `${sides(paused)} are in loan accounts that use a tokenized-stock price (${namesOf('paused')}), paused while the US market is closed. This is expected, but until it reopens those accounts cannot borrow or withdraw, and cannot be liquidated.`,
    })
  }
  const weak = rows.value.filter((r) => r.state === 'weak')
  if (weak.length) {
    list.push({ tone: 'warning', text: `${usd(sum(weak))} depends on a price with a weakness, such as a single oracle with no fallback. See the Price column.` })
  }
  const unknown = rows.value.filter((r) => r.state === 'unknown')
  if (unknown.length) {
    list.push({
      tone: 'neutral',
      text: `${unknown.length} ${unknown.length === 1 ? 'position' : 'positions'} could not be checked: not tracked by OracleCanary, or their health could not be loaded.`,
    })
  }
  if (data.value.failed.length) {
    list.push({ tone: 'warning', text: `Your ${sourceNames(data.value.failed)} positions could not be read right now and are missing below. Try again shortly.` })
  }
  const monitored = rows.value.length - unknown.length
  if (monitored > 0 && list.every((n) => n.tone === 'neutral')) {
    list.unshift({ tone: 'success', text: `All ${monitored} monitored ${monitored === 1 ? 'position has a' : 'positions have'} healthy prices right now.` })
  }
  return list
})
</script>

<template>
  <div class="ax-page-head">
    <div class="ax-page-head__row">
      <div>
        <h1 class="ax-page-head__title">My positions</h1>
        <p class="ax-page-head__subtitle">
          Check whether the prices behind your deposits and loans on Kamino and marginfi are healthy. Read-only: connecting only shares your
          address with OracleCanary, nothing is signed.
        </p>
      </div>
    </div>
  </div>

  <div class="ax-dash-grid">
    <section class="ax-card ax-col--12 lookup" aria-label="Wallet">
      <form class="lookup__form" @submit.prevent="check()">
        <input
          v-model="input"
          type="text"
          class="ax-input ax-input--sm lookup__input"
          placeholder="Paste a Solana wallet address"
          aria-label="Wallet address"
          autocomplete="off"
          spellcheck="false"
        />
        <button type="submit" class="ax-btn ax-btn--primary ax-btn--sm" :disabled="!input.trim()">Check</button>
        <span class="muted">or</span>
        <button type="button" class="ax-btn ax-btn--secondary ax-btn--sm" :disabled="connecting" @click="connectWallet">
          {{ connecting ? 'Waiting for the wallet…' : 'Connect wallet' }}
        </button>
      </form>
      <div v-if="choices.length" class="lookup__form" role="group" aria-label="Choose a wallet">
        <span class="muted">Which wallet?</span>
        <button
          v-for="w in choices"
          :key="w.name"
          type="button"
          class="ax-btn ax-btn--secondary ax-btn--sm wallet-choice"
          :disabled="connecting"
          @click="connect(w)"
        >
          <img v-if="w.icon" :src="w.icon" alt="" width="16" height="16" />
          {{ w.name }}
        </button>
      </div>
      <p class="muted">
        No wallet at hand?
        <button type="button" class="link-button" @click="check(EXAMPLE_WALLET)">See an example</button>: a wallet that has borrowed against a
        tokenized stock on Kamino.
      </p>
      <div v-if="connectError" class="ax-alert ax-alert--warning" role="alert">{{ connectError }}</div>
    </section>

    <div v-if="error" class="ax-alert ax-alert--danger ax-col--12" role="alert">{{ error }}</div>

    <template v-if="address && !error">
      <KpiCard label="Deposits" :value="loading ? '…' : usd(deposits)" icon="wallet" tone="c1" hint="Including your share of curator vaults" />
      <KpiCard label="Borrowed" :value="loading ? '…' : usd(borrowed)" icon="table" tone="c2" />
      <KpiCard
        label="At risk now"
        :value="loading ? '…' : usd(atRiskNow)"
        icon="alert-triangle"
        :tone="atRiskNow > 0 ? 'c3' : 'c4'"
        hint="Deposits held up by an unusable price, and vault money in such markets (market-closed pauses not counted)"
      />
      <KpiCard label="Positions" :value="loading ? '…' : String(rows.length)" icon="layout-dashboard" tone="c4" :hint="shortAddress(address)" />
    </template>

    <!-- Always mounted, so screen readers announce the answer when it appears. -->
    <div class="ax-col--12 notes" role="status" aria-live="polite">
      <template v-if="address && !error && !loading">
        <div v-for="(n, i) in notes" :key="i" class="ax-alert" :class="`ax-alert--${n.tone}`">{{ n.text }}</div>
      </template>
    </div>

    <section v-if="address && !error" class="ax-card ax-col--12" aria-label="Positions">
      <div class="ax-card__header">
        <div class="ax-card__titles">
          <h2 class="ax-card__title">Positions</h2>
          <p class="ax-card__subtitle">
            Each deposit and loan with the health of the price it depends on, valued at the last price each protocol stored: Kamino's reserve
            price, and marginfi's cached bank price, which can lag while a bank is idle.
          </p>
        </div>
      </div>
      <p v-if="loading" class="empty" role="status">Reading this wallet from the Solana network…</p>
      <p v-else-if="data && !rows.length" class="empty">
        No deposits or loans on Kamino or marginfi, and no Kamino vault shares held in this wallet (shares staked in a vault's farm are not read
        yet).
      </p>
      <div v-else-if="rows.length" class="ax-table-wrap">
        <table class="ax-table ax-table--hover" style="min-width: 760px">
          <thead class="ax-table__head">
            <tr>
              <th scope="col" class="ax-table__th">Asset</th>
              <th scope="col" class="ax-table__th">Protocol</th>
              <th scope="col" class="ax-table__th">Position</th>
              <th scope="col" class="ax-table__th num">Value</th>
              <th scope="col" class="ax-table__th">Health</th>
              <th scope="col" class="ax-table__th">Price</th>
              <th scope="col" class="ax-table__th">Tags</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.key" class="ax-table__row">
              <td class="ax-table__td">
                <RouterLink :to="r.to" class="name">{{ r.name }}</RouterLink>
                <div v-if="r.market" class="muted">{{ r.market }}</div>
              </td>
              <td class="ax-table__td muted">{{ PROTOCOL_LABEL[r.protocol] }}</td>
              <td class="ax-table__td">{{ r.side }}</td>
              <td class="ax-table__td num ax-num">
                {{ r.usd === null ? '—' : usd(r.usd) }}
                <div v-if="r.tokens" class="muted">{{ r.tokens }}</div>
              </td>
              <td class="ax-table__td">
                <SeverityBadge v-if="r.severity" :severity="r.severity" />
                <span v-else class="muted">{{ r.issue.startsWith('Health could not') ? 'Unavailable' : 'Not monitored' }}</span>
              </td>
              <td class="ax-table__td issue">{{ r.issue }}</td>
              <td class="ax-table__td"><ReserveTags :checks="r.checks" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="data" class="muted footnote">
        {{ sourceNames(data.notCovered) }} positions, and vault shares staked in a vault's farm, are not read yet.
      </p>
    </section>
  </div>
</template>

<style scoped>
.lookup {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-3);
  padding: var(--ax-space-5);
}
.lookup__form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-2);
}
.lookup__input {
  flex: 1 1 360px;
  max-width: 480px;
}
.wallet-choice {
  display: inline-flex;
  align-items: center;
  gap: var(--ax-space-2);
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
.notes {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-3);
}
.notes:empty {
  display: none;
}
th {
  text-align: left;
}
.num {
  text-align: right;
}
.name {
  color: var(--ax-text-strong);
  font-weight: 600;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.issue {
  font-size: var(--ax-text-sm);
  max-width: 52ch;
}
.empty {
  padding: var(--ax-space-8);
  text-align: center;
  color: var(--ax-text-muted);
}
.footnote {
  padding: var(--ax-space-3) var(--ax-space-5);
}
</style>
