import { describe, expect, it } from 'vitest'
import { ALL_INDIA, countByLevel, filterByState, mapHeadline, regionName, stateOptions } from './floodRegion'

const rows = [
  { district: 'Idukki', state: 'Kerala', level: 'high', probability: 0.61, rain_pct_normal: 180, observed: 1 },
  { district: 'Kollam', state: 'Kerala', level: 'low', probability: 0.05, rain_pct_normal: 90, observed: 0 },
  { district: 'Dhemaji', state: 'Assam', level: 'medium', probability: 0.3, rain_pct_normal: 120, observed: 1 },
  { district: 'Jaipur', state: 'Rajasthan', level: 'low', probability: 0.02, rain_pct_normal: 40, observed: 0 },
]

describe('flood region helpers', () => {
  it('filters by state and treats "All India" as everything', () => {
    expect(filterByState(rows, 'Kerala').map((r) => r.district)).toEqual(['Idukki', 'Kollam'])
    expect(filterByState(rows, ALL_INDIA)).toHaveLength(4)
  })

  it('lists states once, sorted', () => {
    expect(stateOptions(rows)).toEqual(['Assam', 'Kerala', 'Rajasthan'])
  })

  it('counts levels for the selected region only', () => {
    expect(countByLevel(filterByState(rows, 'Kerala'))).toEqual({ critical: 0, high: 1, medium: 0, low: 1 })
    expect(countByLevel(rows)).toEqual({ critical: 0, high: 1, medium: 1, low: 2 })
  })

  it('names the region in every headline', () => {
    const kerala = filterByState(rows, 'Kerala')
    expect(mapHeadline({ rows: kerala, state: 'Kerala', kind: 'current' })).toBe(
      '1 of 2 districts in Kerala are at high or critical flood risk; Idukki is highest at 61%',
    )
    const dry = filterByState(rows, 'Rajasthan')
    expect(mapHeadline({ rows: dry, state: 'Rajasthan', kind: 'current' })).toBe(
      'No district in Rajasthan is at high risk: the last 30 days brought 40–40% of normal rain',
    )
    expect(mapHeadline({ rows, state: ALL_INDIA, kind: 'current' })).toMatch(/in India/)
    expect(mapHeadline({ rows: kerala, state: 'Kerala', kind: 'backtest', scenarioLabel: 'August 2018' })).toBe(
      'August 2018, Kerala: the model rated 1 of 2 districts high or critical and 1 medium or above; the India Flood Inventory recorded floods in 1',
    )
  })

  it('says so when a region has no rows', () => {
    expect(mapHeadline({ rows: [], state: 'Goa', kind: 'current' })).toMatch(/No district in Goa has data/)
    expect(regionName(undefined)).toBe('India')
  })
})
