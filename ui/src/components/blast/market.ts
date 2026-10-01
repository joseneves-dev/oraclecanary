import { protocolName, shortAddress } from '@/lib/format'

/**
 * "Kamino · Main Market", without repeating a protocol name the market already carries
 * ("Jupiter Lend", not "Jupiter Lend · Jupiter Lend"), as ReserveTable writes it.
 */
export function marketLine(r: { protocol: string; market: { name: string | null; address: string } }): string {
  const name = r.market.name ?? shortAddress(r.market.address)
  const protocol = protocolName(r.protocol)
  return name.toLowerCase().startsWith(protocol.toLowerCase()) ? name : `${protocol} · ${name}`
}

/** Solscan's "open in new tab" glyph (Tabler external-link). */
export const EXTERNAL_LINK_ICON = '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" /><path d="M11 13l9 -9" /><path d="M15 4h5v5" />'
