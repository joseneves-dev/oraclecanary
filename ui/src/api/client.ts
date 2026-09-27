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

const api = createClient<paths>({ baseUrl: '', headers: { Accept: 'application/json' } })

export class ApiError extends Error {}

export async function fetchReserves(query: ReserveQuery): Promise<Reserve[]> {
  const { data, response } = await api.GET('/api/reserves', { params: { query } })
  const status: number = response.status
  if (!data) throw new ApiError(`Could not load reserves (HTTP ${status})`)
  return data as Reserve[]
}

export async function fetchReserve(address: string): Promise<Reserve | null> {
  const { data, response } = await api.GET('/api/reserves/{address}', { params: { path: { address } } })
  const status: number = response.status
  if (status === 404) return null
  if (!data) throw new ApiError(`Could not load reserve (HTTP ${status})`)
  return data as Reserve
}
