/** Shared formatting helpers. */

export const formatNumber = (value) =>
  typeof value === 'number' ? value.toLocaleString() : '—'

export const formatPercent = (value, digits = 1) =>
  typeof value === 'number' ? `${(value * 100).toFixed(digits)}%` : '—'

export const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

/** "5 min ago", "3 h ago", "2 days ago"; falls back to a date. */
export const formatRelative = (value, now = Date.now()) => {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return String(value)
  const seconds = Math.round((now - time) / 1000)
  if (seconds < 0) return new Date(time).toLocaleDateString()
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days} days ago`
  return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
}

/** plural(3, 'flood') -> "3 floods"; plural(1, 'estimate') -> "1 estimate". */
export const plural = (count, singular, pluralForm = `${singular}s`) =>
  `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`

const compactOne = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * US$ in compact form, e.g. 1.482e8 -> "$148.2M". Only used as the secondary,
 * cross-reference figure next to a rupee amount (EM-DAT reports in US$).
 */
export const formatUsdApprox = (value) =>
  typeof value === 'number' ? `$${compactOne.format(value)}` : '—'

const inrGroup = (digits) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
const INR_FULL = inrGroup(0)
const INR_SHORT = inrGroup(1)

/**
 * Rupees in the Indian numbering system, shortened for cards, labels and axes:
 * "₹45.2 L" (lakh, 10^5), "₹1,234.5 Cr" (crore, 10^7), "₹2.9 lakh Cr" (10^12).
 * Below one lakh the full amount is shown. Every money value in the UI goes
 * through this function or `formatINRFull`.
 */
export function formatINR(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${sign}₹${INR_SHORT.format(abs / 1e12)} lakh Cr`
  if (abs >= 1e7) return `${sign}₹${INR_SHORT.format(abs / 1e7)} Cr`
  if (abs >= 1e5) return `${sign}₹${INR_SHORT.format(abs / 1e5)} L`
  return `${sign}₹${INR_FULL.format(abs)}`
}

/** The exact rupee amount with Indian digit grouping: 123456789 -> "₹12,34,56,789". */
export const formatINRFull = (value) =>
  typeof value === 'number' && !Number.isNaN(value) ? `₹${INR_FULL.format(Math.round(value))}` : '—'

/** 1234567 -> "1.2M": compact notation with one decimal. */
export const formatCompact1 = (value) =>
  typeof value === 'number' ? compactOne.format(value) : '—'

/** A count with Indian digit grouping: 3241830 -> "32,41,830". */
export const formatIndian = (value) =>
  typeof value === 'number' && !Number.isNaN(value) ? INR_FULL.format(Math.round(value)) : '—'

/**
 * A count in the Indian system, shortened: "32.4 lakh", "1.2 crore"; below one
 * lakh the full grouped number. Used for people and supplies, never money.
 */
export function formatLakh(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e7) return `${INR_SHORT.format(value / 1e7)} crore`
  if (abs >= 1e5) return `${INR_SHORT.format(value / 1e5)} lakh`
  return INR_FULL.format(Math.round(value))
}

/** 1990 -> "1990s". */
export const formatDecade = (decade) => (typeof decade === 'number' ? `${decade}s` : '—')

/** Signed percentage change with an arrow word, e.g. "+12% on the 2000s". */
export const formatChange = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${Math.round(value)}%`
}
