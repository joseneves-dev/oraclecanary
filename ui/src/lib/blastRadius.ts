/**
 * "If an oracle fails": which listed reserves would be left with no usable price if one oracle
 * provider (or one feed account) stopped, and which would keep a price through another source.
 *
 * Pure and dependency-free, so the indexer's test runner can check it against the checks that
 * indexer/src/health.ts writes (indexer/test/blastRadius.test.ts). It reads only what /api/reserves
 * returns, and follows the same rules health.ts uses to decide whether a price has a fallback:
 *
 * - Kamino (Scope): the reserve's chain multiplies its entries, so each is required; inside an entry,
 *   multiplied sources are all required and fallback sources only fail together. health.ts already
 *   walks that graph and names, in NO_FALLBACK and in a critical DEPRECATED_PROVIDER, every provider
 *   the price cannot do without (a fallback that is itself too old does not count as one). A provider
 *   the reserve reads but that is not named there has an alternative. Every Kamino price is also
 *   relayed through its Scope price account, so that account is required.
 * - Kamino without Scope: Pyth and Switchboard back each other up; a single one is required.
 * - marginfi: a bank prices from exactly one oracle account, so it is required.
 * - Jupiter Lend: the oracle multiplies or divides every source in turn, so every market source is
 *   required.
 *
 * Staking rates, pool pegs, exchange rates, maturity discounts and fixed prices describe the token
 * rather than its market, so they are structure, never a point of failure.
 */

/** The fields of an /api/reserves row this module reads. */
export interface DependencyReserve {
  address: string
  protocol: string
  totalSupplyUsd: number
  providers: string[]
  checks: { code: string; severity: string; message: string }[]
  oracleAccounts: {
    scopePrices: string | null
    scopeChain: number[]
    pyth: string | null
    switchboard: string | null
    oracle: string | null
    sources: { type: string; account: string }[]
  }
}

/**
 * How a reserve relies on a source: `required` if its failure alone stops the price, `fallback` if
 * the price can still come from another source, `structure` for a rate or peg that is not an oracle.
 */
export type Reliance = 'required' | 'fallback' | 'structure'

/** Sources that describe a token's structure rather than its market price (see health.ts). */
export const STRUCTURE_SOURCES = new Set([
  // Kamino Scope entries
  'FixedPrice', 'SplStake', 'MsolStake', 'JitoRestaking', 'DiscountToMaturity',
  // Jupiter Lend oracle sources
  'StakePool', 'MsolPool', 'SinglePool', 'JupLend', 'PstPool', 'Dex peg',
  // What a marginfi oracle setup multiplies its feed by
  'Stake pool rate', 'LST rate', 'mSOL rate', 'Kamino exchange rate', 'Drift exchange rate', 'Solend exchange rate',
  'Jupiter Lend exchange rate', 'PT discount',
])

/** Switchboard's oracle types; it ended support for Solana on 25 Sep 2026 (health.ts DEPRECATED_PROVIDERS). */
const SWITCHBOARD_TYPES = new Set(['SwitchboardOnDemand', 'SwitchboardV2'])

/** Kamino's price relay: every Kamino price is read from a Scope price account. */
export const SCOPE = 'Scope'
export const SWITCHBOARD = 'Switchboard'

/**
 * The provider a source type is grouped under. Each oracle product counts as its own provider, as
 * everywhere on the site (Chainlink and ChainlinkX are two), except Switchboard's two generations.
 */
export function providerKey(type: string): string {
  return SWITCHBOARD_TYPES.has(type) ? SWITCHBOARD : type
}

export const isStructure = (provider: string) => STRUCTURE_SOURCES.has(provider)

/** One oracle account the price is read from directly, as /api/reserves lists it. */
export interface FeedUse {
  account: string
  /** The provider the account belongs to: an oracle type, or Scope for a Scope price account. */
  provider: string
  reliance: Reliance
  /** Scope only: the entries of the price account the reserve's chain multiplies. */
  entries?: number[]
}

export interface Dependency {
  provider: string
  reliance: Reliance
}

/** "Price has no fallback for PythLazer, Chainlink: if it stops…": the providers named. */
const NO_FALLBACK_TYPES = /^Price has no fallback for (.+?): /
/** "Price breaks without SwitchboardOnDemand, which has shut down." */
const BREAKS_WITHOUT_TYPES = /^Price breaks without (.+?), which has shut down/
/** "Price still reads SwitchboardOnDemand, which has shut down, but has another source." */
const STILL_READS_TYPES = /^Price still reads (.+?), which has shut down/

function namedTypes(reserve: DependencyReserve, code: string, pattern: RegExp, severity?: string): string[] {
  return reserve.checks
    .filter((c) => c.code === code && (!severity || c.severity === severity))
    .flatMap((c) => pattern.exec(c.message)?.[1].split(', ') ?? [])
}

/** Market providers (not structure) a reserve's price comes from, as its `providers` names them. */
const marketProviders = (r: DependencyReserve) => [...new Set(r.providers.filter((p) => !isStructure(p)).map(providerKey))]

/** How a reserve relies on each provider it reads, Scope included for Kamino. */
export function dependencies(r: DependencyReserve): Dependency[] {
  const out = new Map<string, Reliance>()
  const set = (provider: string, reliance: Reliance) => {
    // A provider required through one type and not another (Switchboard's two) is required.
    if (out.get(provider) !== 'required') out.set(provider, reliance)
  }
  for (const p of r.providers) if (isStructure(p)) set(p, 'structure')

  if (r.protocol === 'kamino' && r.oracleAccounts.scopePrices) {
    set(SCOPE, 'required')
    const required = new Set(
      [...namedTypes(r, 'NO_FALLBACK', NO_FALLBACK_TYPES), ...namedTypes(r, 'DEPRECATED_PROVIDER', BREAKS_WITHOUT_TYPES, 'critical')].map(providerKey),
    )
    const boundsOnly = namedTypes(r, 'DEPRECATED_PROVIDER', STILL_READS_TYPES).map(providerKey)
    for (const p of [...marketProviders(r), ...required, ...boundsOnly]) set(p, required.has(p) ? 'required' : 'fallback')
  } else if (r.protocol === 'kamino') {
    const market = marketProviders(r)
    for (const p of market) set(p, market.length === 1 ? 'required' : 'fallback')
  } else {
    // marginfi reads one oracle account; Jupiter Lend multiplies every source. A marginfi bank on a
    // Scope setup reads a Scope price account, which `providers` already names.
    for (const p of marketProviders(r)) set(p, 'required')
  }
  return [...out].map(([provider, reliance]) => ({ provider, reliance }))
}

/** How a reserve relies on `provider`, or null when its price does not read it. */
export function relianceOn(r: DependencyReserve, provider: string): Reliance | null {
  return dependencies(r).find((d) => d.provider === provider)?.reliance ?? null
}

/** The oracle accounts a reserve reads directly, with how it relies on each. */
export function feedUses(r: DependencyReserve): FeedUse[] {
  const a = r.oracleAccounts
  const uses: FeedUse[] = []
  const deps = dependencies(r)
  const reliance = (provider: string): Reliance => deps.find((d) => d.provider === provider)?.reliance ?? 'required'

  if (a.scopePrices) uses.push({ account: a.scopePrices, provider: SCOPE, reliance: 'required', entries: a.scopeChain.length ? a.scopeChain : undefined })
  if (r.protocol === 'jupiter-lend') {
    for (const s of a.sources) {
      const provider = s.type.startsWith('DexSmart') ? 'Dex peg' : providerKey(s.type)
      uses.push({ account: s.account, provider, reliance: isStructure(provider) ? 'structure' : 'required' })
    }
    return uses
  }
  // marginfi names the Pyth feed's provider by its setup; Kamino reads Pyth itself.
  const pythProvider = marketProviders(r).find((p) => p !== SWITCHBOARD && p !== SCOPE) ?? 'Pyth'
  if (a.pyth) uses.push({ account: a.pyth, provider: pythProvider, reliance: reliance(pythProvider) })
  if (a.switchboard) uses.push({ account: a.switchboard, provider: SWITCHBOARD, reliance: reliance(SWITCHBOARD) })
  return uses
}

export interface Exposure<R> {
  /** Price stops: no other source. */
  stops: R[]
  /** Price keeps coming from another source. */
  keeps: R[]
  /** Uses it as a rate or peg rather than an oracle. */
  structure: R[]
  stopsUsd: number
  keepsUsd: number
  structureUsd: number
}

const supply = (rows: { totalSupplyUsd: number }[]) => rows.reduce((sum, r) => sum + r.totalSupplyUsd, 0)
const bySupply = (a: { totalSupplyUsd: number }, b: { totalSupplyUsd: number }) => b.totalSupplyUsd - a.totalSupplyUsd

function exposure<R extends DependencyReserve>(rows: [R, Reliance][]): Exposure<R> {
  const pick = (reliance: Reliance) => rows.filter(([, x]) => x === reliance).map(([r]) => r).sort(bySupply)
  const stops = pick('required')
  const keeps = pick('fallback')
  const structure = pick('structure')
  return { stops, keeps, structure, stopsUsd: supply(stops), keepsUsd: supply(keeps), structureUsd: supply(structure) }
}

/** What happens to each reserve's price if `provider` stops. */
export function providerExposure<R extends DependencyReserve>(reserves: R[], provider: string): Exposure<R> {
  return exposure(reserves.flatMap((r) => {
    const reliance = relianceOn(r, provider)
    return reliance ? [[r, reliance] as [R, Reliance]] : []
  }))
}

/** What happens to each reserve's price if the oracle account `account` stops updating. */
export function feedExposure<R extends DependencyReserve>(reserves: R[], account: string): Exposure<R> & { provider: string | null } {
  let provider: string | null = null
  const rows = reserves.flatMap((r) => {
    const use = feedUses(r).find((u) => u.account === account)
    if (!use) return []
    provider ??= use.provider
    return [[r, use.reliance] as [R, Reliance]]
  })
  return { ...exposure(rows), provider }
}

export interface ProviderSummary {
  provider: string
  structure: boolean
  stopsUsd: number
  stopsCount: number
  keepsUsd: number
  keepsCount: number
  /** Every reserve that reads it, whatever the reliance. */
  totalUsd: number
  count: number
}

/** Every provider the reserves read, the largest exposure first; structure sources last. */
export function providerSummaries(reserves: DependencyReserve[]): ProviderSummary[] {
  const all = new Map<string, ProviderSummary>()
  for (const r of reserves) {
    for (const { provider, reliance } of dependencies(r)) {
      const s = all.get(provider) ?? { provider, structure: reliance === 'structure', stopsUsd: 0, stopsCount: 0, keepsUsd: 0, keepsCount: 0, totalUsd: 0, count: 0 }
      if (reliance === 'required') {
        s.stopsUsd += r.totalSupplyUsd
        s.stopsCount++
      } else if (reliance === 'fallback') {
        s.keepsUsd += r.totalSupplyUsd
        s.keepsCount++
      }
      s.totalUsd += r.totalSupplyUsd
      s.count++
      all.set(provider, s)
    }
  }
  return [...all.values()].sort((a, b) => Number(a.structure) - Number(b.structure) || b.stopsUsd - a.stopsUsd || b.totalUsd - a.totalUsd)
}

export interface FeedSummary {
  account: string
  provider: string
  stopsUsd: number
  stopsCount: number
  count: number
  totalUsd: number
}

/** The oracle accounts read directly for `provider`, the largest first. */
export function feedsOf(reserves: DependencyReserve[], provider: string): FeedSummary[] {
  const feeds = new Map<string, FeedSummary>()
  for (const r of reserves) {
    for (const use of feedUses(r)) {
      if (use.provider !== provider) continue
      const f = feeds.get(use.account) ?? { account: use.account, provider, stopsUsd: 0, stopsCount: 0, count: 0, totalUsd: 0 }
      if (use.reliance === 'required') {
        f.stopsUsd += r.totalSupplyUsd
        f.stopsCount++
      }
      f.count++
      f.totalUsd += r.totalSupplyUsd
      feeds.set(use.account, f)
    }
  }
  return [...feeds.values()].sort((a, b) => b.stopsUsd - a.stopsUsd || b.totalUsd - a.totalUsd)
}
