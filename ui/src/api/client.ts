import createClient from 'openapi-fetch'
import type { components, paths } from './schema'

/**
 * The API always returns every field (null when unknown), but the OpenAPI spec does not list
 * required properties, so the generated types mark everything optional. This restores the
 * real shape while keeping nullable fields nullable.
 */
type Complete<T> = T extends (infer U)[]
  ? Complete<U>[]
  : T extends object
    ? { [K in keyof T]-?: Complete<Exclude<T[K], undefined>> }
    : T

export type Reserve = Complete<components['schemas']['Reserve']>
export type Severity = Reserve['severity']
export type ReserveQuery = NonNullable<paths['/api/reserves']['get']['parameters']['query']>

export interface ReservePage {
  rows: Reserve[]
  /** Number of reserves matching the filters, across all pages. */
  total: number
}

const api = createClient<paths>({ baseUrl: '', headers: { Accept: 'application/json' } })

export class ApiError extends Error {}

export async function fetchReserves(query: ReserveQuery, signal?: AbortSignal): Promise<Reserve[]> {
  const { data, response } = await api.GET('/api/reserves', { params: { query }, signal })
  const status: number = response.status
  if (!data) throw new ApiError(`Could not load reserves (HTTP ${status})`)
  return data as Reserve[]
}

/** One page of reserves with the total count, which only the JSON-LD format reports. */
export async function fetchReservePage(query: ReserveQuery, signal?: AbortSignal): Promise<ReservePage> {
  const { data, response } = await api.GET('/api/reserves', {
    params: { query },
    headers: { Accept: 'application/ld+json' },
    signal,
  })
  const status: number = response.status
  if (!data) throw new ApiError(`Could not load reserves (HTTP ${status})`)
  const page = data as unknown as { member: Reserve[]; totalItems: number }
  return { rows: page.member, total: page.totalItems }
}

export async function fetchReserve(address: string, signal?: AbortSignal): Promise<Reserve | null> {
  const { data, response } = await api.GET('/api/reserves/{address}', { params: { path: { address } }, signal })
  const status: number = response.status
  if (status === 404) return null
  if (!data) throw new ApiError(`Could not load reserve (HTTP ${status})`)
  return data as Reserve
}

export type ReserveEvent = Complete<components['schemas']['ReserveEvent']>
export type ReserveSnapshot = Complete<components['schemas']['ReserveSnapshot']>
export type EventQuery = NonNullable<paths['/api/events']['get']['parameters']['query']>

/** Every reserve matching the filters, across pages. */
export async function fetchAllReserves(query: Omit<ReserveQuery, 'page' | 'itemsPerPage'>, signal?: AbortSignal): Promise<Reserve[]> {
  const itemsPerPage = 500
  const rows: Reserve[] = []
  for (let page = 1; ; page++) {
    const batch = await fetchReserves({ ...query, page, itemsPerPage }, signal)
    rows.push(...batch)
    if (batch.length < itemsPerPage) return rows
  }
}

export async function fetchEvents(query: EventQuery, signal?: AbortSignal): Promise<ReserveEvent[]> {
  const { data, response } = await api.GET('/api/events', { params: { query }, signal })
  const status: number = response.status
  if (!data) throw new ApiError(`Could not load events (HTTP ${status})`)
  return data as ReserveEvent[]
}

/** Hourly health of a reserve since `after`, oldest first. */
export async function fetchReserveHistory(address: string, after: Date, signal?: AbortSignal): Promise<ReserveSnapshot[]> {
  const { data, response } = await api.GET('/api/reserves/{address}/history', {
    params: {
      path: { address },
      query: { 'hour[after]': after.toISOString().replace(/\.\d{3}Z$/, 'Z'), 'order[hour]': 'asc', itemsPerPage: 2160 },
    },
    signal,
  })
  const status: number = response.status
  if (!data) throw new ApiError(`Could not load history (HTTP ${status})`)
  return data as ReserveSnapshot[]
}

export type ReserveIncident = Complete<components['schemas']['ReserveIncident']>
export type IncidentQuery = NonNullable<paths['/api/incidents']['get']['parameters']['query']>

export type Vault = Complete<components['schemas']['Vault']>
export type VaultAllocation = Vault['allocations'][number]

/** Kamino curator vaults, largest first. */
export async function fetchVaults(signal?: AbortSignal): Promise<Vault[]> {
  const { data, response } = await api.GET('/api/vaults', { signal })
  const status: number = response.status
  if (!data) throw new ApiError(`Could not load vaults (HTTP ${status})`)
  return data as Vault[]
}

export async function fetchVault(address: string, signal?: AbortSignal): Promise<Vault | null> {
  const { data, response } = await api.GET('/api/vaults/{address}', { params: { path: { address } }, signal })
  const status: number = response.status
  if (status === 404) return null
  if (!data) throw new ApiError(`Could not load vault (HTTP ${status})`)
  return data as Vault
}

export async function fetchIncidents(query: IncidentQuery, signal?: AbortSignal): Promise<ReserveIncident[]> {
  const { data, response } = await api.GET('/api/incidents', { params: { query }, signal })
  const status: number = response.status
  if (!data) throw new ApiError(`Could not load incidents (HTTP ${status})`)
  return data as ReserveIncident[]
}

/** One of a wallet's positions, as the positions service reads it from the chain. */
export type WalletPosition =
  | { protocol: 'kamino' | 'marginfi'; side: 'deposit' | 'borrow'; reserve: string; account: string; tokens: number; usd: number }
  | { protocol: 'kamino-vault'; side: 'deposit'; vault: string; share: number }

export interface WalletPositions {
  wallet: string
  positions: WalletPosition[]
  /** Protocols whose positions are not read yet. */
  notCovered: string[]
  /** Sources that could not be read this time; the other positions are still listed. */
  failed: string[]
  checkedAt: string
}

/**
 * A wallet's lending positions. Served by the indexer's positions service rather than the Symfony
 * API, so it is not in the OpenAPI schema.
 */
export async function fetchWalletPositions(address: string, signal?: AbortSignal): Promise<WalletPositions> {
  const response = await fetch(`/api/wallets/${encodeURIComponent(address)}/positions`, { signal, headers: { Accept: 'application/json' } })
  const body = (await response.json().catch(() => null)) as (WalletPositions & { error?: string }) | null
  if (!response.ok || !body) throw new ApiError(body?.error ?? `Could not load this wallet (HTTP ${response.status})`)
  return body
}
