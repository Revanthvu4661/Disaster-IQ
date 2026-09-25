import { describe, expect, it } from 'vitest'
import {
  formatChange,
  formatDecade,
  formatNumber,
  formatPercent,
  formatINR,
  formatINRFull,
  formatIndian,
  formatLakh,
  formatRelative,
  formatUsdApprox,
} from './format'
import { toCsv } from './download'

describe('formatRelative', () => {
  const now = Date.parse('2026-09-25T12:00:00Z')
  it('reads a time slightly ahead of the clock as just now', () => {
    expect(formatRelative('2026-09-25T12:00:20Z', now)).toBe('just now')
    expect(formatRelative('2026-09-25T12:05:00Z', now)).toBe('just now')
  })

  it('shows a date for a time well in the future', () => {
    expect(formatRelative('2026-10-25T12:00:00Z', now)).not.toMatch(/ago|just now/)
  })

  it('counts minutes, hours and days in the past', () => {
    expect(formatRelative('2026-09-25T11:30:00Z', now)).toBe('30 min ago')
    expect(formatRelative('2026-09-25T09:00:00Z', now)).toBe('3 h ago')
    expect(formatRelative('2026-09-20T12:00:00Z', now)).toBe('5 days ago')
  })
})

describe('formatting helpers', () => {
  it('formats money, decades and changes', () => {
    expect(formatUsdApprox(1.482e8)).toBe('$148.2M')
    expect(formatDecade(1990)).toBe('1990s')
    expect(formatChange(12.4)).toBe('+12%')
    expect(formatChange(-3.2)).toBe('-3%')
    expect(formatChange(null)).toBe('—')
  })

  it('formats numbers and percentages', () => {
    expect(formatNumber(26175)).toBe((26175).toLocaleString())
    expect(formatNumber(undefined)).toBe('—')
    expect(formatPercent(0.4463)).toBe('44.6%')
    expect(formatPercent(0.0071, 2)).toBe('0.71%')
  })
})

describe('rupees', () => {
  it('uses lakh and crore, with the exact amount in Indian grouping', () => {
    expect(formatINRFull(123456789)).toBe('₹12,34,56,789')
    expect(formatINR(12345678900)).toBe('₹1,234.6 Cr')
    expect(formatINR(4520000)).toBe('₹45.2 L')
    expect(formatINR(2.9e12)).toBe('₹2.9 lakh Cr')
    expect(formatINR(1.23e17)).toBe('₹1,23,000 lakh Cr')
    expect(formatINR(98765)).toBe('₹98,765')
    expect(formatINR(null)).toBe('—')
  })

  it('shortens counts to lakh and crore without a rupee sign', () => {
    expect(formatIndian(3241830)).toBe('32,41,830')
    expect(formatLakh(3241830)).toBe('32.4 lakh')
    expect(formatLakh(33406061)).toBe('3.3 crore')
    expect(formatLakh(66029)).toBe('66,029')
    expect(formatLakh(undefined)).toBe('—')
  })
})

describe('toCsv', () => {
  it('writes a header and quotes awkward values', () => {
    const csv = toCsv([{ country: 'Congo, Dem. Rep.', count: 12 }])
    expect(csv).toBe('country,count\n"Congo, Dem. Rep.",12')
  })

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('honours an explicit column order', () => {
    expect(toCsv([{ a: 1, b: 2 }], ['b', 'a'])).toBe('b,a\n2,1')
  })
})
