import type { Reserve } from '@/api/client'

/** Empty reserves (under $1, shown as $0) put no money at risk and are left out of incidents. */
export const MIN_EXPOSED_USD = 1

/**
 * Open incidents: listed reserves whose health is critical and that hold at least $1, largest first.
 * The one definition used by the front page, the Overview and the Incidents page.
 */
export function openIncidents(reserves: Reserve[]): Reserve[] {
  return reserves.filter((r) => r.severity === 'critical' && r.totalSupplyUsd >= MIN_EXPOSED_USD).sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)
}
