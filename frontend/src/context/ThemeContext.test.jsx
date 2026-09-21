import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from './ThemeContext'

function Probe() {
  const { theme, toggleTheme, followsSystem } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="follows">{String(followsSystem)}</span>
      <button type="button" onClick={toggleTheme}>
        toggle
      </button>
    </div>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to following the system preference', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('follows')).toHaveTextContent('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('toggles, applies and persists the choice', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(window.localStorage.getItem('disasteriq.theme')).toBe('light')
  })

  it('restores a stored preference', () => {
    window.localStorage.setItem('disasteriq.theme', 'light')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(screen.getByTestId('follows')).toHaveTextContent('false')
  })

  it('ignores a corrupted stored value', () => {
    window.localStorage.setItem('disasteriq.theme', 'banana')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('follows')).toHaveTextContent('true')
  })
})
