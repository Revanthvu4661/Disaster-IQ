import { formatINR, formatINRFull, formatUsdApprox } from '../lib/format'

export const CURRENCY_NOTE =
  "Converted from USD using that year's average exchange rate. Not adjusted for inflation."
export const NEAREST_NOTE = "Converted using nearest available year's exchange rate."

/** Tooltip text for a rupee figure: exact ₹, the source US$ figure, and the fallback note. */
export function inrTitle({ value, usd, estimated }) {
  const parts = [formatINRFull(value)]
  if (typeof usd === 'number' && usd > 0) parts.push(`(approx. ${formatUsdApprox(usd)} as reported by EM-DAT)`)
  let text = parts.join(' ')
  if (estimated) text += `. ${NEAREST_NOTE}`
  return text
}

/**
 * A rupee amount: short Indian-system form on screen, exact ₹ and the original
 * US$ figure on hover (and for screen readers). An asterisk marks figures that
 * used the nearest available year's exchange rate.
 */
export function Inr({ value, usd, estimated = false, full = false }) {
  if (typeof value !== 'number') return <span>—</span>
  const title = inrTitle({ value, usd, estimated })
  return (
    <span className="inr" title={title}>
      <span aria-hidden="true">{full ? formatINRFull(value) : formatINR(value)}</span>
      {estimated && (
        <sup className="inr-estimated" aria-hidden="true">
          *
        </sup>
      )}
      <span className="visually-hidden">{title}</span>
    </span>
  )
}

/** The unobtrusive caption placed by every economic figure or chart. */
export function CurrencyNote({ estimatedCount = 0 }) {
  return (
    <span className="currency-note">
      {CURRENCY_NOTE}
      {estimatedCount > 0 &&
        ` * ${estimatedCount} record${estimatedCount === 1 ? '' : 's'} from before 1960 use the 1960 rate (nearest available year).`}
    </span>
  )
}

export default Inr
