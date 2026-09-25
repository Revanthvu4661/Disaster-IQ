import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LevelChain from './LevelChain'
import { formatDay, levelHex, levelLabel, levelRank } from '../lib/risk'

const renderChain = (props) =>
  render(
    <MemoryRouter>
      <LevelChain {...props} />
    </MemoryRouter>,
  )

describe('Analyze → Predict → Recommend chain', () => {
  it('links the other two steps on the same hazard and marks the current one', () => {
    renderChain({ current: 'analyze', hazard: 'earthquake' })
    expect(screen.getByRole('link', { name: /see earthquake risk prediction/i })).toHaveAttribute(
      'href',
      '/risk?type=earthquake',
    )
    expect(screen.getByRole('link', { name: /recommended preparedness and response/i })).toHaveAttribute(
      'href',
      '/preparedness?type=earthquake',
    )
    expect(screen.getByText('Earthquake history').closest('[aria-current="step"]')).not.toBeNull()
  })

  it('links back to the hazard page from the later steps', () => {
    renderChain({ current: 'recommend', hazard: 'cyclone' })
    expect(screen.getByRole('link', { name: /see cyclone history/i })).toHaveAttribute('href', '/cyclone')
    expect(screen.getByRole('link', { name: /see cyclone risk prediction/i })).toHaveAttribute('href', '/risk?type=cyclone')
  })
})

describe('risk helpers', () => {
  it('orders and labels the four levels', () => {
    expect(['low', 'critical', 'medium', 'high'].sort((a, b) => levelRank(a) - levelRank(b))).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ])
    expect(levelLabel('critical')).toBe('Critical')
    expect(levelHex('high', 'dark')).toMatch(/^#/)
  })

  it('formats dates without depending on the locale', () => {
    expect(formatDay('2026-08-23')).toBe('23 Aug 2026')
    expect(formatDay(null)).toBe('—')
  })
})
