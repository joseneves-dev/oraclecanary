/**
 * Context about a reserve that is not a problem of its own, derived from its checks. Add a tag to
 * TAGS to show it wherever reserves are listed. Context is shown as neutral chips: it explains a
 * reserve's state, it does not raise the alarm.
 */
export const TAGS: { code: string; label: string; badge: string; fallbackTitle: string }[] = [
  {
    code: 'MARKET_CLOSED',
    label: 'Market hours',
    badge: 'ax-badge--outline ax-badge--neutral',
    fallbackTitle: 'The US stock market was closed, so the price was not updating: expected, but the protocol still rejects it.',
  },
  {
    code: 'FIXED_PRICE',
    label: 'Fixed price',
    badge: 'ax-badge--soft ax-badge--neutral',
    fallbackTitle: 'The price is a fixed value set by the protocol and does not follow the market.',
  },
  {
    code: 'WINDING_DOWN',
    label: 'Winding down',
    badge: 'ax-badge--outline ax-badge--neutral',
    fallbackTitle: 'No new deposits or borrows, and deposits count for no collateral, so its price backs no borrowing.',
  },
]

/** Whether a reserve carries any context tag, e.g. to leave out an all-empty Tags column. */
export function hasTags(checks: { code: string }[]): boolean {
  return TAGS.some((tag) => checks.some((c) => c.code === tag.code))
}
