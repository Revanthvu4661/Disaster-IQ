import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState, ErrorState } from './ui'

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
