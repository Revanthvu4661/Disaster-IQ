/**
 * Region helpers for the flood risk page: the state filter, the level counts
 * that follow it, and the map headline, which always names the region it covers.
 */
import { RISK_LEVELS, formatProbability } from './risk'

export const ALL_INDIA = 'All India'

/** Rows in the chosen state, or every row for "All India". */
export const filterByState = (rows, state) =>
  !state || state === ALL_INDIA ? rows : rows.filter((row) => row.state === state)

/** Sorted state names present in the rows. */
export const stateOptions = (rows) => [...new Set(rows.map((row) => row.state).filter(Boolean))].sort()

/** "All India" reads as "India" inside a sentence. */
export const regionName = (state) => (!state || state === ALL_INDIA ? 'India' : state)

/** Rows per risk level, in the order critical, high, medium, low. */
export function countByLevel(rows) {
  const counts = Object.fromEntries(RISK_LEVELS.map((band) => [band.level, 0]))
  rows.forEach((row) => {
    counts[row.level] += 1
  })
  return counts
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * One sentence for the map card. `rows` are already limited to the region
 * (highest risk first for a live view). `kind` is "current" or "backtest".
 */
export function mapHeadline({ rows, state, kind, scenarioLabel }) {
  const region = regionName(state)
  if (!rows.length) return `No district in ${region} has data for this window`
  const counts = countByLevel(rows)
  const raised = counts.critical + counts.high
  if (kind === 'backtest') {
    const observed = rows.filter((row) => row.observed).length
    const mediumUp = raised + counts.medium
    return `${scenarioLabel}, ${region}: the model rated ${raised} of ${plural(rows.length, 'district')} high or critical and ${mediumUp} medium or above; the India Flood Inventory recorded floods in ${observed}`
  }
  if (raised === 0) {
    const rain = rows.map((row) => row.rain_pct_normal)
    const low = Math.round(Math.min(...rain))
    const high = Math.round(Math.max(...rain))
    return `No district in ${region} is at high risk: the last 30 days brought ${low}–${high}% of normal rain`
  }
  const top = [...rows].sort((a, b) => b.probability - a.probability)[0]
  return `${raised} of ${plural(rows.length, 'district')} in ${region} are at high or critical flood risk; ${top.district} is highest at ${formatProbability(top.probability)}`
}
