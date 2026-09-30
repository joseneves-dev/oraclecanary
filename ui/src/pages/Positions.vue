<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  fetchReserve,
  fetchVault,
  fetchWalletPositions,
  type Reserve,
  type Vault,
  type WalletPosition,
  type WalletPositions,
} from '@/api/client'
import PositionLegend from '@/components/PositionLegend.vue'
import ReserveTags from '@/components/ReserveTags.vue'
import WalletLookup from '@/components/WalletLookup.vue'
import { shortAddress, usd } from '@/lib/format'
import { walletAlertsUrl } from '@/lib/links'
import { priceState } from '@/lib/priceState'

/**
 * A wallet's deposits and loans in the monitored protocols, each with the health of the price it
 * depends on. The wallet is only an address: connecting reads its public key and nothing is signed.
 *
 * On Kamino and marginfi a loan account (obligation, marginfi account) acts on all its prices at
 * once: when one is unusable, the whole account cannot borrow, withdraw or be liquidated. So the
 * page judges accounts, not only rows, and lists positions grouped by account.
 */

const route = useRoute()
const router = useRouter()

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

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

// ---- The address, kept in the URL (?address=) so a result can be shared. ----

const address = computed(() => (typeof route.query.address === 'string' ? route.query.address.trim() : ''))
/** Bumped by a lookup of the address already shown, which leaves the URL unchanged, to load it again. */
const reload = ref(0)
/** The lookup form, folded away once a wallet is shown. */
const changing = ref(false)

function lookup(value: string) {
  changing.value = false
  if (value === address.value) reload.value++
  else router.replace({ query: { address: value } })
}

// ---- Loading the positions and the health behind each one. ----

/** What a row's price means for it; accounts inherit the worst of their rows' blocked/paused states. */
type State = 'blocked' | 'paused' | 'overvalued' | 'weak' | 'unknown' | 'ok'
const STATE_RANK: Record<State, number> = { blocked: 5, overvalued: 4, paused: 3, weak: 2, unknown: 1, ok: 0 }
const STATE_BADGE: Record<State, { label: string; badge: string }> = {
  blocked: { label: 'Blocked', badge: 'ax-badge--danger' },
  paused: { label: 'Paused', badge: 'ax-badge--info' },
  overvalued: { label: 'Overvalued', badge: 'ax-badge--warning' },
  weak: { label: 'Weak', badge: 'ax-badge--warning' },
  unknown: { label: 'Unknown', badge: 'ax-badge--neutral' },
  ok: { label: 'Healthy', badge: 'ax-badge--success' },
}

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
  state: State
  issue: string
  checks: Reserve['checks']
  /** Vaults only: the wallet's share of vault money in markets with an unusable price. */
  atRiskUsd: number
  /** Liquidation weight (a deposit's threshold, a loan's factor); null when unknown. */
  weight: number | null
  /** The price used for the value, per token; null when unknown. */
  price: number | null
  asset: string | null
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

const stateOf = (reserve: Reserve): State => priceState(reserve)

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
    usd: p.unpriced ? null : p.usd,
    tokens: reserve?.asset && typeof p.tokens === 'number' ? `${tokenAmount(p.tokens)} ${reserve.asset}` : null,
    state: reserve ? stateOf(reserve) : 'unknown',
    issue:
      reserve === undefined
        ? 'Health could not be loaded right now.'
        : reserve === null
          ? 'Not monitored: this reserve is not tracked by OracleCanary.'
          : mainIssue(checks),
    checks,
    atRiskUsd: 0,
    weight: typeof p.weight === 'number' ? p.weight : null,
    price: !p.unpriced && typeof p.tokens === 'number' && p.tokens > 0 ? p.usd / p.tokens : null,
    asset: reserve?.asset || null,
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
    weight: null,
    price: null,
    asset: null,
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

// ---- Accounts and groups. ----

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

/** Rows with their account's state applied: a healthy row in a blocked account is blocked too. */
const rows = computed(() =>
  rawRows.value.map((r) => {
    const account = r.account ? accountStates.value.get(r.account) : undefined
    if (!account || STATE_RANK[account.state] <= STATE_RANK[r.state]) return r
    return { ...r, state: account.state }
  }),
)

interface Group {
  key: string
  title: string
  subtitle: string | null
  state: State
  /** What holds the account up, when it is blocked or paused. */
  by: string | null
  rows: Row[]
  /** Deposits times their liquidation thresholds, and loans times their factors, in USD. */
  capacity: number
  debt: number
  liquidation: Liquidation
}

/**
 * Where a loan account stands against its liquidation limit (loans times their factors against
 * deposits times their thresholds). "use" is always true; the price scenarios hold one side still.
 */
type Liquidation =
  | { kind: 'none' } // no loan
  | { kind: 'unknown' } // a price or weight is missing
  | { kind: 'past' } // at or past the limit: liquidatable now
  | {
      kind: 'ok'
      /** Share of the limit the loans use, 0 to 1. */
      use: number
      /** How far every deposit can fall, loans unchanged, before liquidation. */
      drop: number
      /** A single collateral asset (not also borrowed, not a stablecoin): the price at which the account is liquidated if only it moves. */
      price: { asset: string; price: number } | null
      /** Stablecoin deposits: how far the loans' prices can rise, deposits unchanged. */
      loansRise: number | null
    }

/** A dollar- or euro-pegged token: its price does not fall the way the "deposits fall" scenario assumes. */
const isStable = (r: Row) => !!r.asset && /USD|EUR/i.test(r.asset) && r.price !== null && r.price > 0.95 && r.price < 1.05

function liquidation(list: Row[]): Pick<Group, 'capacity' | 'debt' | 'liquidation'> {
  const deposits = list.filter((r) => r.side === 'Deposit')
  const loans = list.filter((r) => r.side === 'Borrow')
  const capacity = deposits.reduce((s, r) => s + (r.usd ?? 0) * (r.weight ?? 0), 0)
  const debt = loans.reduce((s, r) => s + (r.usd ?? 0) * (r.weight ?? 0), 0)
  if (!loans.length) return { capacity, debt, liquidation: { kind: 'none' } }
  if (!list.every((r) => r.weight !== null && r.usd !== null)) return { capacity, debt, liquidation: { kind: 'unknown' } }
  // Kamino liquidates at the limit, marginfi past it: at the limit counts as liquidatable.
  if (capacity <= 0 || debt >= capacity) return { capacity, debt, liquidation: { kind: 'past' } }
  const use = debt / capacity
  const drop = 1 - use
  const assets = new Set(deposits.map((r) => r.asset))
  const only = assets.size === 1 ? deposits[0] : null
  const borrowed = new Set(loans.map((r) => r.asset))
  const single = only?.asset && only.price && !borrowed.has(only.asset) && !isStable(only) ? { asset: only.asset, price: only.price * use } : null
  return {
    capacity,
    debt,
    liquidation: { kind: 'ok', use, drop, price: single, loansRise: deposits.every(isStable) ? capacity / debt - 1 : null },
  }
}

/** The "what if" slider: a fall of every deposit's price, loans unchanged, in percent. */
const shock = ref(0)
// A new wallet starts from today's prices.
watch(address, () => (shock.value = 0))
const loanGroups = computed(() => groups.value.filter((g) => g.liquidation.kind === 'ok' || g.liquidation.kind === 'past'))
const shockResult = (g: Group) => {
  const capacity = g.capacity * (1 - shock.value / 100)
  return { liquidatable: g.liquidation.kind === 'past' || g.debt >= capacity, buffer: capacity > 0 ? Math.max(0, 1 - g.debt / capacity) : 0 }
}
/** Percentages rounded towards caution: a share of the limit up, a margin down. */
const pctUp = (ratio: number) => `${Math.min(100, Math.ceil(ratio * 100))}%`
const pctDown = (ratio: number) => `${Math.max(0, Math.floor(ratio * 100))}%`
const money = (value: number) =>
  `$${value.toLocaleString('en', value >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumSignificantDigits: 3 })}`

/** One group per loan account, and one for vault shares; worst first, then largest. */
const groups = computed<Group[]>(() => {
  const byKey = new Map<string, Row[]>()
  for (const r of rows.value) {
    const key = r.account ?? 'vaults'
    byKey.set(key, [...(byKey.get(key) ?? []), r])
  }
  const list = [...byKey].map(([key, list]): Group => {
    const sorted = [...list].sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || (b.usd ?? 0) - (a.usd ?? 0))
    const worst = sorted[0].state
    if (key === 'vaults') return { key, title: 'Curator vault shares', subtitle: 'Kamino', state: worst, by: null, rows: sorted, capacity: 0, debt: 0, liquidation: { kind: 'none' } }
    const account = accountStates.value.get(key)
    const first = sorted[0]
    return {
      key,
      title: `${PROTOCOL_LABEL[first.protocol]} loan account`,
      subtitle: [first.market, shortAddress(key)].filter(Boolean).join(' · '),
      state: worst,
      by: account ? [...account.by].join(', ') : null,
      rows: sorted,
      ...liquidation(sorted),
    }
  })
  const total = (g: Group) => g.rows.reduce((s, r) => s + (r.usd ?? 0), 0)
  return list.sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || total(b) - total(a))
})

// ---- Totals and the answer. ----

const sum = (list: Row[]) => list.reduce((s, r) => s + (r.usd ?? 0), 0)
const deposits = computed(() => sum(rows.value.filter((r) => r.side !== 'Borrow')))
const borrowed = computed(() => sum(rows.value.filter((r) => r.side === 'Borrow')))
const inAccounts = (state: 'blocked' | 'paused') => rows.value.filter((r) => r.account && r.state === state)
const vaultAtRisk = computed(() => rows.value.reduce((s, r) => s + r.atRiskUsd, 0))
const atRiskNow = computed(() => sum(inAccounts('blocked').filter((r) => r.side === 'Deposit')) + vaultAtRisk.value)
const accountCount = computed(() => groups.value.filter((g) => g.key !== 'vaults').length)

/** "$X of deposits and $Y of loans", leaving out a side that is empty. */
function sides(list: Row[]): string {
  const dep = sum(list.filter((r) => r.side !== 'Borrow'))
  const loans = sum(list.filter((r) => r.side === 'Borrow'))
  return [dep > 0 ? `${usd(dep)} of deposits` : '', loans > 0 ? `${usd(loans)} of loans` : ''].filter(Boolean).join(' and ')
}
const namesOf = (state: 'blocked' | 'paused') =>
  [...new Set([...accountStates.value.values()].filter((a) => a.state === state).flatMap((a) => [...a.by]))].join(', ')

type Tone = 'danger' | 'warning' | 'info' | 'success' | 'neutral'
interface Finding {
  tone: Tone
  eyebrow: string
  headline: string
  text: string
}

/** Every finding about the wallet, worst first; the first one is the headline of the page. */
const findings = computed<Finding[]>(() => {
  if (!data.value) return []
  const list: Finding[] = []
  const blocked = inAccounts('blocked')
  if (blocked.length) {
    list.push({
      tone: 'danger',
      eyebrow: 'Blocked now',
      headline: `${usd(sum(blocked))} held up by an unusable price`,
      text: `${sides(blocked)} are in loan accounts that use a price the protocol cannot use right now (${namesOf('blocked')}). Until it updates, those accounts cannot borrow or withdraw, and cannot be liquidated.`,
    })
  }
  if (vaultAtRisk.value > 0) {
    list.push({
      tone: 'danger',
      eyebrow: 'Vault exposure',
      headline: `${usd(vaultAtRisk.value)} of your vault deposits at risk`,
      text: `${usd(vaultAtRisk.value)} of your vault deposits is lent into markets with an unusable price, where loans cannot be liquidated.`,
    })
  }
  const overvalued = rows.value.filter((r) => r.state === 'overvalued')
  if (overvalued.length) {
    list.push({
      tone: 'warning',
      eyebrow: 'Overvalued collateral',
      headline: `${usd(sum(overvalued))} priced well above the market`,
      text: `${usd(sum(overvalued))} depends on a price well above the market: that collateral is overvalued.`,
    })
  }
  const paused = inAccounts('paused')
  if (paused.length) {
    list.push({
      tone: 'info',
      eyebrow: 'Paused · US market closed',
      headline: `${usd(sum(paused))} held up until the US market reopens`,
      text: `${sides(paused)} are in loan accounts that use a tokenized-stock price (${namesOf('paused')}), paused while the US market is closed. This is expected, but until it reopens those accounts cannot borrow or withdraw, and cannot be liquidated.`,
    })
  }
  const weak = rows.value.filter((r) => r.state === 'weak')
  if (weak.length) {
    list.push({
      tone: 'warning',
      eyebrow: 'Usable, but fragile',
      headline: `${usd(sum(weak))} depends on a fragile price`,
      text: `${usd(sum(weak))} depends on a price with a weakness, such as a single oracle with no fallback: if it stops, the account is held up.`,
    })
  }
  const unknown = rows.value.filter((r) => r.state === 'unknown')
  if (unknown.length) {
    list.push({
      tone: 'neutral',
      eyebrow: 'Not checked',
      headline: `${unknown.length} ${unknown.length === 1 ? 'position' : 'positions'} could not be checked`,
      text: `${unknown.length} ${unknown.length === 1 ? 'position is' : 'positions are'} not tracked by OracleCanary, or their health could not be loaded.`,
    })
  }
  if (data.value.failed.length) {
    list.push({
      tone: 'warning',
      eyebrow: 'Partly read',
      headline: `${sourceNames(data.value.failed)} could not be read`,
      text: `Your ${sourceNames(data.value.failed)} positions could not be read right now and are missing below. Try again shortly.`,
    })
  }
  const monitored = rows.value.length - unknown.length
  if (monitored > 0 && list.every((f) => f.tone === 'neutral')) {
    list.unshift({
      tone: 'success',
      eyebrow: 'All healthy',
      headline: `All ${monitored} monitored ${monitored === 1 ? 'position has a' : 'positions have'} a healthy price`,
      text: 'Every price behind them is fresh and usable right now.',
    })
  }
  if (!rows.value.length && !data.value.failed.length) {
    list.push({
      tone: 'neutral',
      eyebrow: 'Nothing found',
      headline: 'No positions on Kamino or marginfi',
      text: "No deposits or loans on Kamino or marginfi, and no Kamino vault shares held in this wallet (shares staked in a vault's farm are not read yet).",
    })
  }
  return list
})
const headline = computed(() => findings.value[0] ?? null)
const others = computed(() => findings.value.slice(1))
</script>

<template>
  <div class="ax-page-head">
    <div class="ax-page-head__row">
      <div>
        <h1 class="ax-page-head__title">My positions</h1>
        <p class="ax-page-head__subtitle">Is the price behind your deposits and loans working? Read-only: nothing is signed.</p>
      </div>
    </div>
  </div>

  <div class="ax-dash-grid">
    <!-- Before a wallet: the lookup is the page. -->
    <section v-if="!address || changing" class="ax-card ax-welcome ax-col--12" aria-label="Check a wallet">
      <div class="ax-welcome__body">
        <div class="ax-welcome__text start">
          <span class="ax-welcome__eyebrow">Kamino · marginfi · Kamino vaults</span>
          <h2 class="ax-welcome__title">Check any Solana wallet</h2>
          <p class="ax-welcome__lede">
            Paste an address or connect a wallet. Each deposit, loan and vault share is matched with the health of the price it depends on.
          </p>
          <WalletLookup large :initial="address" @lookup="lookup" />
        </div>
        <PositionLegend />
      </div>
    </section>

    <!-- With a wallet: a one-line bar, so the result takes the page. -->
    <section v-else class="ax-card ax-col--12" aria-label="Wallet">
      <div class="walletbar">
        <span class="ax-eyebrow">Wallet</span>
        <code class="walletbar__address">{{ address }}</code>
        <button type="button" class="ax-btn ax-btn--secondary ax-btn--sm" @click="changing = true">Check another wallet</button>
        <button v-if="!loading" type="button" class="ax-btn ax-btn--ghost ax-btn--sm" @click="lookup(address)">Refresh</button>
      </div>
    </section>

    <div v-if="error" class="ax-alert ax-alert--danger ax-col--12" role="alert">
      {{ error }}
      <button v-if="address && ADDRESS.test(address)" type="button" class="ax-btn ax-btn--secondary ax-btn--sm retry" @click="lookup(address)">
        Try again
      </button>
    </div>

    <template v-if="address && !error && !changing">
      <!-- Always mounted, so screen readers announce the answer when it lands. -->
      <section class="ax-card ax-col--12 verdict" :class="headline && !loading ? `verdict--${headline.tone}` : ''" role="status" aria-live="polite">
        <div v-if="loading" class="ax-skeleton-card verdict__body" aria-label="Reading this wallet">
          <span class="ax-skeleton ax-skeleton--line" style="width: 120px"></span>
          <span class="ax-skeleton ax-skeleton--line" style="width: 60%; height: 1.6em"></span>
          <span class="ax-skeleton ax-skeleton--line" style="width: 80%"></span>
          <span class="muted">Reading this wallet from the Solana network…</span>
        </div>
        <div v-else-if="headline" class="verdict__body">
          <span class="ax-eyebrow verdict__eyebrow">{{ headline.eyebrow }}</span>
          <p class="verdict__headline">{{ headline.headline }}</p>
          <p class="verdict__text">{{ headline.text }}</p>
          <ul v-if="others.length" class="verdict__others">
            <li v-for="(f, i) in others" :key="i">
              <span class="dot" :class="`dot--${f.tone}`" aria-hidden="true"></span>
              {{ f.text }}
            </li>
          </ul>
        </div>
        <div v-if="!loading && rows.length" class="ax-statgroup verdict__stats">
          <div class="ax-statgroup__cell">
            <div class="ax-statgroup__text">
              <span class="ax-statgroup__label">Deposits</span><span class="ax-statgroup__value">{{ usd(deposits) }}</span>
            </div>
          </div>
          <div class="ax-statgroup__cell">
            <div class="ax-statgroup__text">
              <span class="ax-statgroup__label">Borrowed</span><span class="ax-statgroup__value">{{ usd(borrowed) }}</span>
            </div>
          </div>
          <div class="ax-statgroup__cell">
            <div class="ax-statgroup__text">
              <span class="ax-statgroup__label">Deposits at risk now</span>
              <span class="ax-statgroup__value" :class="{ risk: atRiskNow > 0 }">{{ usd(atRiskNow) }}</span>
            </div>
          </div>
          <div class="ax-statgroup__cell">
            <div class="ax-statgroup__text">
              <span class="ax-statgroup__label">Loan accounts</span><span class="ax-statgroup__value">{{ accountCount }}</span>
            </div>
          </div>
        </div>
      </section>

      <section v-if="!loading && accountCount" class="ax-card ax-col--12" aria-label="Alerts for this wallet">
        <div class="alerts-cta">
        <div>
          <h2 class="ax-card__title">Get a message when this wallet is held up</h2>
          <p class="muted">
            OracleCanary checks it every 5 minutes and messages you on Telegram when a price the protocol cannot use holds up one of its
            Kamino or marginfi loan accounts, and again when it recovers. Pauses while the US market is closed, and curator vaults, are not
            alerted. Read-only: only the address is shared.
          </p>
        </div>
        <a class="ax-btn ax-btn--primary ax-btn--sm" :href="walletAlertsUrl(address)" target="_blank" rel="noopener">Get Telegram alerts</a>
        </div>
      </section>

      <section v-if="!loading && loanGroups.length" class="ax-card ax-col--12" aria-labelledby="whatif-title">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 id="whatif-title" class="ax-card__title">What if your deposits fall?</h2>
            <p class="ax-card__subtitle">
              Every deposit falls by the same share while loans keep their price, from the protocols' last stored prices: an estimate. While a
              price is blocked or paused, the protocol cannot liquidate the account even past this point, so a fall keeps growing the loss
              instead.
            </p>
          </div>
        </div>
        <div class="ax-card__body whatif">
          <label class="whatif__slider">
            <span>Deposit prices fall by <b class="ax-num">{{ shock }}%</b></span>
            <input
              v-model.number="shock"
              type="range"
              min="0"
              max="90"
              step="5"
              aria-label="Fall of deposit prices"
              :aria-valuetext="`${shock}%`"
            />
          </label>
          <ul class="whatif__list" aria-live="polite">
            <li v-for="g in loanGroups" :key="g.key">
              <span class="whatif__name">{{ g.title }} <span class="muted">{{ g.subtitle }}</span></span>
              <span
                class="ax-badge ax-badge--soft ax-badge--pill"
                :class="shockResult(g).liquidatable ? 'ax-badge--danger' : 'ax-badge--success'"
              >
                {{ shockResult(g).liquidatable ? 'Would be liquidated' : `Safe: can fall another ${pctDown(shockResult(g).buffer)}` }}
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="loading || rows.length" class="ax-card ax-col--12" aria-label="Positions">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 class="ax-card__title">Positions</h2>
            <p class="ax-card__subtitle">Grouped by loan account: one unusable price holds up the whole account.</p>
          </div>
        </div>
        <div v-if="loading" class="ax-card__body skeleton-rows" aria-hidden="true">
          <div v-for="n in 3" :key="n" class="ax-skeleton-row">
            <span class="ax-skeleton ax-skeleton--line" style="width: 18%"></span>
            <span class="ax-skeleton ax-skeleton--line" style="width: 12%"></span>
            <span class="ax-skeleton ax-skeleton--line" style="width: 10%"></span>
            <span class="ax-skeleton ax-skeleton--line" style="width: 45%"></span>
          </div>
        </div>
        <div v-else class="ax-table-wrap">
          <table class="ax-table">
            <thead class="ax-table__head">
              <tr>
                <th scope="col" class="ax-table__th">Position</th>
                <th scope="col" class="ax-table__th num">Value</th>
                <th scope="col" class="ax-table__th">Status</th>
                <th scope="col" class="ax-table__th">Price</th>
              </tr>
            </thead>
            <tbody v-for="g in groups" :key="g.key">
              <tr class="group" :class="{ 'ax-table__row--danger': g.state === 'blocked', 'group--info': g.state === 'paused' }">
                <th colspan="4" scope="colgroup" class="group__cell">
                  <div class="group__line">
                    <span class="group__title">{{ g.title }}</span>
                    <span v-if="g.subtitle" class="muted">{{ g.subtitle }}</span>
                    <span v-if="g.by" class="group__by">
                      {{ g.state === 'paused' ? 'Paused by' : 'Blocked by' }} {{ g.by }}: this account cannot borrow, withdraw or be liquidated
                    </span>
                    <span v-if="g.liquidation.kind === 'ok'" class="group__liq">
                      Loans use {{ pctUp(g.liquidation.use) }} of the liquidation limit<template v-if="g.liquidation.price"
                        >; liquidated if only {{ g.liquidation.price.asset }} falls to {{ money(g.liquidation.price.price) }}</template
                      ><template v-else-if="g.liquidation.loansRise !== null"
                        >; liquidated if the loans' prices rise {{ pctDown(g.liquidation.loansRise) }}</template
                      >
                    </span>
                    <span v-else-if="g.liquidation.kind === 'past'" class="group__by">At or past its liquidation limit</span>
                    <span v-else-if="g.liquidation.kind === 'unknown'" class="group__liq">Liquidation point unknown: a price is missing</span>
                  </div>
                </th>
              </tr>
              <tr v-for="r in g.rows" :key="r.key" class="ax-table__row">
                <td class="ax-table__td">
                  <RouterLink :to="r.to" class="name">{{ r.name }}</RouterLink>
                  <span class="ax-badge ax-badge--outline ax-badge--sm side">{{ r.side }}</span>
                  <div v-if="r.market && g.key === 'vaults'" class="muted">{{ r.market }}</div>
                </td>
                <td class="ax-table__td num ax-num">
                  {{ r.usd === null ? '—' : usd(r.usd) }}
                  <div v-if="r.tokens" class="muted">{{ r.tokens }}</div>
                </td>
                <td class="ax-table__td">
                  <div class="status">
                    <span class="ax-badge ax-badge--soft ax-badge--pill" :class="STATE_BADGE[r.state].badge">{{ STATE_BADGE[r.state].label }}</span>
                    <ReserveTags :checks="r.checks" hide-empty />
                  </div>
                </td>
                <td class="ax-table__td issue">{{ r.issue }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="data" class="muted footnote">
          Values use the last price each protocol stored (marginfi's can lag while a bank is idle). {{ sourceNames(data.notCovered) }} positions,
          and vault shares staked in a vault's farm, are not read yet.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.alerts-cta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ax-space-4);
  padding: var(--ax-space-5);
}
.start {
  gap: var(--ax-space-3);
}
.walletbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ax-space-3);
  padding: var(--ax-space-3) var(--ax-space-5);
}
.walletbar__address {
  flex: 1 1 280px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-sm);
  color: var(--ax-text-strong);
}
.retry {
  margin-inline-start: var(--ax-space-3);
}
/* The answer: one card whose edge carries the worst outcome's colour. */
.verdict {
  position: relative;
  overflow: hidden;
}
.verdict::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 4px;
  background: var(--ax-border-strong);
}
.verdict--danger::before {
  background: var(--ax-danger-500);
}
.verdict--warning::before {
  background: var(--ax-warning-500);
}
.verdict--info::before {
  background: var(--ax-info-500);
}
.verdict--success::before {
  background: var(--ax-success-500);
}
.verdict__body {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-2);
  padding: var(--ax-space-6);
}
.verdict--danger .verdict__eyebrow {
  color: var(--ax-danger-500);
}
.verdict--warning .verdict__eyebrow {
  color: var(--ax-warning-500);
}
.verdict--info .verdict__eyebrow {
  color: var(--ax-info-500);
}
.verdict--success .verdict__eyebrow {
  color: var(--ax-success-500);
}
.verdict__headline {
  font-family: var(--ax-font-display);
  font-size: clamp(1.4rem, 1.1rem + 1.2vw, 2rem);
  font-weight: var(--ax-weight-semibold);
  line-height: 1.15;
  color: var(--ax-text-strong);
}
.verdict__text {
  max-width: 80ch;
  color: var(--ax-text-muted);
}
.verdict__others {
  display: grid;
  gap: var(--ax-space-2);
  padding-block-start: var(--ax-space-2);
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.verdict__others li {
  display: flex;
  gap: var(--ax-space-2);
  align-items: baseline;
}
.verdict__stats {
  border-block-start: 1px solid var(--ax-border);
  border-radius: 0;
}
.dot {
  flex: 0 0 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateY(-1px);
  background: var(--ax-border-strong);
}
.dot--danger {
  background: var(--ax-danger-500);
}
.dot--warning {
  background: var(--ax-warning-500);
}
.dot--info {
  background: var(--ax-info-500);
}
.dot--success {
  background: var(--ax-success-500);
}
.risk {
  color: var(--ax-danger-500);
}
.skeleton-rows {
  display: grid;
  gap: var(--ax-space-4);
}
.group__cell {
  text-align: left;
  padding: var(--ax-space-3) var(--ax-space-4);
  font-weight: normal;
  text-transform: none;
  letter-spacing: normal;
}
.group__line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--ax-space-1) var(--ax-space-3);
}
.group--info {
  background: var(--ax-info-50);
}
.group__title {
  font-weight: 600;
  color: var(--ax-text-strong);
}
.group__by {
  font-size: var(--ax-text-sm);
  font-weight: 600;
  color: var(--ax-danger-500);
}
.group__liq {
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.whatif {
  display: grid;
  gap: var(--ax-space-4);
}
.whatif__slider {
  display: grid;
  gap: var(--ax-space-2);
  max-width: 480px;
  font-size: var(--ax-text-sm);
}
.whatif__slider input {
  width: 100%;
  accent-color: var(--ax-accent);
}
.whatif__list {
  display: grid;
  gap: var(--ax-space-2);
}
.whatif__list li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--ax-space-2);
}
.whatif__name {
  font-weight: 600;
  color: var(--ax-text-strong);
}
.group--info .group__by {
  color: var(--ax-info-500);
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
.side {
  margin-inline-start: var(--ax-space-2);
}
.status {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-1);
  align-items: center;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
.issue {
  font-size: var(--ax-text-sm);
  max-width: 60ch;
}
.footnote {
  padding: var(--ax-space-3) var(--ax-space-5);
}
</style>
