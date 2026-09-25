import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CalendarHeatmap, YearMonthHeatmap, shade } from './Heatmap'

describe('heatmaps', () => {
  it('shades zero as empty and rises with the count', () => {
    expect(shade(0, 10)).toBe(0)
    expect(shade(1, 100)).toBeGreaterThan(0.2)
    expect(shade(10, 10)).toBe(1)
    expect(shade(4, 10)).toBeLessThan(shade(9, 10))
  })

  it('draws one cell per day, with a text title for each, and marks the busiest day', () => {
    const { container } = render(
      <CalendarHeatmap year={2024} counts={{ 71: 3, 72: 1 }} color="red" unit="earthquakes" ariaLabel="Calendar 2024" />,
    )
    expect(container.querySelectorAll('rect')).toHaveLength(366)          // 2024 is a leap year
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Calendar 2024')
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent)
    expect(titles).toContain('11 Mar 2024: 3 earthquakes')
    expect(titles).toContain('1 Jan 2024: 0 earthquakes')
    expect([...container.querySelectorAll('rect')].filter((r) => r.getAttribute('stroke'))).toHaveLength(1)
  })

  it('draws twelve rows per year for the month heatmap', () => {
    const matrix = [Array(12).fill(0), Array(12).fill(0)]
    matrix[1][2] = 73
    const { container } = render(
      <YearMonthHeatmap years={[2010, 2011]} matrix={matrix} color="red" unit="earthquakes" ariaLabel="Months" />,
    )
    expect(container.querySelectorAll('rect')).toHaveLength(24)
    expect([...container.querySelectorAll('title')].map((t) => t.textContent)).toContain('Mar 2011: 73 earthquakes')
    expect(container.querySelector('.heatmap-legend')).toHaveTextContent('73 earthquakes or more in a cell')
  })
})
