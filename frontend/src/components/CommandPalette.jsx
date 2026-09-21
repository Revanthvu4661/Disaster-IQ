import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Moon, Search, Sun } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { NAV_ITEMS } from '../navigation'

/**
 * Ctrl+K / Cmd+K command palette.
 *
 * Navigation and a theme toggle, filtered by a simple substring match. Arrow
 * keys move the selection, Enter runs it, Escape closes and returns focus.
 */
export function CommandPalette({ open, onClose }) {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef(null)

  const commands = useMemo(() => {
    const navCommands = NAV_ITEMS.map((item) => ({
      id: `nav:${item.to}`,
      label: `Go to ${item.label}`,
      hint: item.description,
      icon: item.icon,
      run: () => navigate(item.to),
    }))
    return [
      ...navCommands,
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        hint: 'Appearance',
        icon: theme === 'dark' ? Sun : Moon,
        run: toggleTheme,
      },
    ]
  }, [navigate, theme, toggleTheme])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      `${command.label} ${command.hint ?? ''}`.toLowerCase().includes(needle),
    )
  }, [commands, query])

  // The parent remounts this component on open, so state starts fresh and the
  // effect only has to move focus into the dialog.
  useEffect(() => {
    if (!open) return undefined
    const id = window.setTimeout(() => inputRef.current?.focus(), 10)
    return () => window.clearTimeout(id)
  }, [open])

  if (!open) return null

  const runCommand = (command) => {
    command.run()
    onClose()
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((current) => (current + 1) % Math.max(results.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((current) => (current - 1 + results.length) % Math.max(results.length, 1))
    } else if (event.key === 'Enter' && results[index]) {
      event.preventDefault()
      runCommand(results[index])
    }
  }

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className="row" style={{ padding: '0 var(--space-4)', gap: 8 }}>
          <Search size={15} aria-hidden="true" className="muted" />
          <input
            ref={inputRef}
            className="palette-input"
            style={{ padding: 'var(--space-4) 0', borderBottom: 0 }}
            placeholder="Search pages and actions"
            aria-label="Search pages and actions"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setIndex(0)
            }}
          />
        </div>
        <div className="palette-list" role="listbox" aria-label="Commands">
          {results.length === 0 && <p className="empty-state">No matching command</p>}
          {results.map((command, position) => {
            const Icon = command.icon
            return (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={position === index}
                className="palette-item"
                onMouseEnter={() => setIndex(position)}
                onClick={() => runCommand(command)}
              >
                {Icon && <Icon size={15} aria-hidden="true" />}
                <span style={{ flex: 1 }}>{command.label}</span>
                {command.hint && <span className="text-xs muted">{command.hint}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
