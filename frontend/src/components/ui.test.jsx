import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CategoryChip,
  ConfidenceMeter,
  EmptyState,
  ErrorState,
  SeverityBadge,
} from './ui'
import SeverityGauge from './SeverityGauge'

describe('SeverityBadge', () => {
  it('states the level in words, not only colour', () => {
    render(<SeverityBadge level="critical" score={92} />)
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByText('92')).toBeInTheDocument()
  })
})

describe('SeverityGauge', () => {
  it('exposes the score to assistive technology', () => {
    render(<SeverityGauge score={73.4} level="critical" />)
    expect(
      screen.getByRole('img', { name: /severity critical, score 73 out of 100/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/critical severity/i)).toBeInTheDocument()
  })
})

describe('ConfidenceMeter', () => {
  it('reports its value as a meter', () => {
    render(<ConfidenceMeter value={0.42} label="Water confidence" />)
    const meter = screen.getByRole('meter', { name: 'Water confidence' })
    expect(meter).toHaveAttribute('aria-valuenow', '42')
  })

  it('clamps out-of-range values', () => {
    render(<ConfidenceMeter value={4} label="Clamped" />)
    expect(screen.getByRole('meter', { name: 'Clamped' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })
})

describe('CategoryChip', () => {
  it('renders a readable label and confidence', () => {
    render(<CategoryChip category="search_and_rescue" confidence={0.87} threshold={0.4} />)
    expect(screen.getByText('Search And Rescue')).toBeInTheDocument()
    expect(screen.getByText('87%')).toBeInTheDocument()
  })

  it('becomes a button when it is selectable', async () => {
    const onClick = vi.fn()
    render(<CategoryChip category="water" confidence={0.5} onClick={onClick} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('ErrorState', () => {
  it('announces the failure and offers a retry', async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="API offline" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('API offline')
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('EmptyState', () => {
  it('shows the supplied message', () => {
    render(<EmptyState message="Nothing here yet" />)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
  })
})
