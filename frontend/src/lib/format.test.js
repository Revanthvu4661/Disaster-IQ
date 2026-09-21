import { describe, expect, it } from 'vitest'
import {
  SEVERITY_ORDER,
  formatDelta,
  formatNumber,
  formatPercent,
  humanCategory,
  seriesColor,
  severityMeta,
  titleCase,
} from './format'
import { toCsv } from './download'

describe('formatting helpers', () => {
  it('title-cases snake_case categories', () => {
    expect(titleCase('search_and_rescue')).toBe('Search And Rescue')
    expect(humanCategory('medical_help')).toBe('medical help')
  })

  it('formats numbers and percentages', () => {
    expect(formatNumber(26175)).toBe((26175).toLocaleString())
    expect(formatNumber(undefined)).toBe('—')
    expect(formatPercent(0.4463)).toBe('44.6%')
    expect(formatPercent(0.0071, 2)).toBe('0.71%')
  })

  it('signs deltas and ignores invalid values', () => {
    expect(formatDelta(12.34)).toBe('+12.3%')
    expect(formatDelta(-3)).toBe('-3.0%')
    expect(formatDelta(null)).toBeNull()
  })
})

describe('severity language', () => {
  it('covers every level with an icon and a label', () => {
    SEVERITY_ORDER.forEach((level) => {
      const meta = severityMeta(level)
      expect(meta.label).toBeTruthy()
      expect(meta.icon).toBeTruthy()
      expect(meta.className).toBe(`sev-${level}`)
    })
  })

  it('falls back to low for an unknown level', () => {
    expect(severityMeta('nonsense').label).toBe('Low')
  })
})

describe('series colours', () => {
  it('cycles through the token palette', () => {
    expect(seriesColor(0)).toBe('var(--series-1)')
    expect(seriesColor(7)).toBe(seriesColor(0))
  })
})

describe('toCsv', () => {
  it('writes a header and quotes awkward values', () => {
    const csv = toCsv([{ category: 'water, clean', count: 12 }])
    expect(csv).toBe('category,count\n"water, clean",12')
  })

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('honours an explicit column order', () => {
    expect(toCsv([{ a: 1, b: 2 }], ['b', 'a'])).toBe('b,a\n2,1')
  })
})
