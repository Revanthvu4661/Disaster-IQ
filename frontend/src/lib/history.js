/**
 * Helpers that turn the API's computed statistics into chart series and plain
 * words. They describe numbers the backend computed; none of them invents one.
 */

/** Trailing moving average over `window` rows (fewer at the start of the series). */
export function movingAverage(rows, key, window = 10, outKey = `${key}_avg`) {
  let sum = 0
  return rows.map((row, index) => {
    sum += row[key] ?? 0
    if (index >= window) sum -= rows[index - window][key] ?? 0
    const count = Math.min(index + 1, window)
    return { ...row, [outKey]: sum / count }
  })
}

/** Conventional wording for the size of a correlation coefficient. */
export function strength(r) {
  if (typeof r !== 'number') return 'unmeasured'
  const size = Math.abs(r)
  if (size < 0.1) return 'no'
  if (size < 0.3) return 'a weak'
  if (size < 0.6) return 'a moderate'
  return 'a strong'
}

/** "increasing" / "decreasing" / "no clear trend", with the test behind it. */
export function trendWords(trend) {
  if (!trend || trend.direction === 'insufficient') return 'too few years to judge'
  if (trend.direction === 'no clear trend') return 'no clear trend'
  return trend.direction
}

/** Spearman ρ and p, formatted for a footnote. */
export function trendStats(trend) {
  if (!trend || typeof trend.spearman_rho !== 'number') return ''
  const p = trend.p_value < 0.001 ? 'p < 0.001' : `p = ${trend.p_value.toFixed(3)}`
  return `Spearman ρ = ${trend.spearman_rho.toFixed(2)}, ${p}, ${trend.from}–${trend.to}`
}

/** The row with the largest value of `key`. */
export const maxBy = (rows, key) =>
  rows.reduce((best, row) => (best === null || (row[key] ?? -Infinity) > best[key] ? row : best), null)
