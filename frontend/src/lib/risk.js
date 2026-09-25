/**
 * Risk levels (Level 2, all three hazards) and priority tiers (Level 3), shared by the
 * Disaster Risk Prediction and Preparedness & Response pages. Colours come from the
 * severity tokens; the hex pairs are for Leaflet, which cannot read CSS
 * variables, and match `--severity-*` in styles/tokens.css.
 */

export const RISK_LEVELS = [
  { level: 'critical', label: 'Critical', min: 0.75 },
  { level: 'high', label: 'High', min: 0.5 },
  { level: 'medium', label: 'Medium', min: 0.25 },
  { level: 'low', label: 'Low', min: 0 },
]

const LEVEL_HEX = {
  dark: { low: '#16a34a', medium: '#d97706', high: '#ea580c', critical: '#dc2626' },
  light: { low: '#15803d', medium: '#b45309', high: '#c2410c', critical: '#b91c1c' },
}

export const levelLabel = (level) => RISK_LEVELS.find((item) => item.level === level)?.label ?? level

/** CSS variable for a level's colour. */
export const levelVar = (level, soft = false) => `var(--severity-${level}${soft ? '-soft' : ''})`

/** Hex for Leaflet paths. */
export const levelHex = (level, theme = 'dark') => LEVEL_HEX[theme]?.[level] ?? '#64748b'

/** Sort key: critical first. */
export const levelRank = (level) => RISK_LEVELS.findIndex((item) => item.level === level)

/** 0.347 -> "35%". */
export const formatProbability = (value) =>
  typeof value === 'number' ? `${Math.round(value * 100)}%` : '—'

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']

/** "2026-08-23" -> "23 Aug 2026" (fixed format, independent of the browser locale). */
export function formatDay(iso) {
  if (!iso) return '—'
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS[month - 1].slice(0, 3)} ${year}`
}
