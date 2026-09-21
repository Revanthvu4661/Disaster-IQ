import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../context/ThemeContext'
import CommandPalette from './CommandPalette'

const renderPalette = (props = {}) =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <CommandPalette open onClose={() => {}} {...props} />
      </MemoryRouter>
    </ThemeProvider>,
  )

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <CommandPalette open={false} onClose={() => {}} />
        </MemoryRouter>
      </ThemeProvider>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists navigation and theme commands', () => {
    renderPalette()
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /go to dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /switch to .* theme/i })).toBeInTheDocument()
  })

  it('filters as you type', async () => {
    renderPalette()
    await userEvent.type(screen.getByRole('textbox'), 'triage')
    expect(screen.getByRole('option', { name: /triage/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /go to dashboard/i })).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing matches', async () => {
    renderPalette()
    await userEvent.type(screen.getByRole('textbox'), 'zzzz')
    expect(screen.getByText(/no matching command/i)).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    renderPalette({ onClose })
    await userEvent.click(screen.getByRole('textbox'))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('moves the selection with the arrow keys', async () => {
    renderPalette()
    await userEvent.click(screen.getByRole('textbox'))
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('runs the selected command on Enter', async () => {
    const onClose = vi.fn()
    renderPalette({ onClose })
    await userEvent.click(screen.getByRole('textbox'))
    await userEvent.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
