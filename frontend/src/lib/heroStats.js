import { formatCompact1, formatNumber } from './format'

/** The headline figure under each hero instrument, from the page's own human-impact totals. */
const HEADLINE_METRIC = { earthquake: 'deaths', flood: 'total_affected', cyclone: 'deaths' }
const HEADLINE_LABEL = { deaths: 'Deaths', total_affected: 'Affected' }

/** Records, span and one headline metric for the hero panel; empty until the data arrives. */
export function heroStats(type, data) {
  if (!data) return []
  const { coverage, human } = data
  const key = HEADLINE_METRIC[type.id] ?? 'deaths'
  const metric = human?.metrics?.find((item) => item.key === key)
  const stats = [
    { label: 'Records', value: formatNumber(coverage.records) },
    { label: 'Span', value: `${coverage.records_first_year}–${coverage.last_year}` },
  ]
  if (metric) stats.push({ label: HEADLINE_LABEL[key], value: formatCompact1(metric.value), tone: key })
  return stats
}
