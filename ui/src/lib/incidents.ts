import type { Reserve } from '@/api/client'
import { healthState } from '@/lib/priceState'

/** Empty reserves (under $1, shown as $0) put no money at risk and are left out of incidents. */
export const MIN_EXPOSED_USD = 1

const largestFirst = (a: Reserve, b: Reserve) => b.totalSupplyUsd - a.totalSupplyUsd

/**
 * Open incidents: listed reserves holding at least $1 whose price is broken, largest first. A stock
 * paused only because its market is closed is expected, so it is counted apart (pausedReserves).
 * The one definition used by the front page, the Overview and the Incidents page.
 */
export function openIncidents(reserves: Reserve[]): Reserve[] {
  return reserves.filter((r) => healthState(r) === 'critical' && r.totalSupplyUsd >= MIN_EXPOSED_USD).sort(largestFirst)
}

/** Listed reserves holding at least $1 whose price is paused while their market is closed. */
export function pausedReserves(reserves: Reserve[]): Reserve[] {
  return reserves.filter((r) => healthState(r) === 'paused' && r.totalSupplyUsd >= MIN_EXPOSED_USD).sort(largestFirst)
}
