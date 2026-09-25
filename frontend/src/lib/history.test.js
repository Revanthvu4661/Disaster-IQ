import { describe, expect, it } from 'vitest'
import { maxBy, movingAverage, strength, trendStats, trendWords } from './history'

describe('movingAverage', () => {
  it('averages the trailing window, using fewer rows at the start', () => {
    const rows = [1, 2, 3, 4].map((value, index) => ({ year: 2000 + index, value }))
    const out = movingAverage(rows, 'value', 2)
    expect(out.map((row) => row.value_avg)).toEqual([1, 1.5, 2.5, 3.5])
    expect(out[0].year).toBe(2000)
  })
})

describe('wording', () => {
  it('names correlation strength by convention', () => {
    expect(strength(0.05)).toBe('no')
    expect(strength(-0.2)).toBe('a weak')
    expect(strength(0.45)).toBe('a moderate')
    expect(strength(0.8)).toBe('a strong')
    expect(strength(undefined)).toBe('unmeasured')
  })

  it('reports a trend only when the test is significant', () => {
    expect(trendWords({ direction: 'increasing' })).toBe('increasing')
    expect(trendWords({ direction: 'no clear trend' })).toBe('no clear trend')
    expect(trendWords({ direction: 'insufficient' })).toBe('too few years to judge')
    expect(trendStats({ spearman_rho: 0.512, p_value: 0.0004, from: 1980, to: 2025 })).toBe(
      'Spearman ρ = 0.51, p < 0.001, 1980–2025',
    )
  })

  it('finds the row with the largest value', () => {
    expect(maxBy([{ v: 1 }, { v: 5 }, { v: 3 }], 'v')).toEqual({ v: 5 })
    expect(maxBy([], 'v')).toBeNull()
  })
})
