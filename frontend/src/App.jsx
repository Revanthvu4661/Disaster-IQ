import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { Command, Moon, Radio, Sun } from 'lucide-react'
import { NAV_ITEMS } from './navigation'
import { useTheme } from './context/ThemeContext'
import { api } from './api/client'
import CommandPalette from './components/CommandPalette'
import { SkeletonCard } from './components/ui'

// Route-level code splitting keeps the initial bundle small.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Insights = lazy(() => import('./pages/Insights'))
const Predict = lazy(() => import('./pages/Predict'))
const Triage = lazy(() => import('./pages/Triage'))
const Hazards = lazy(() => import('./pages/Hazards'))
const ModelPage = lazy(() => import('./pages/Model'))
const About = lazy(() => import('./pages/About'))
const NotFound = lazy(() => import('./pages/NotFound'))

function ApiStatus() {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false
    const check = () =>
      api
        .health()
        .then((body) => {
          if (!cancelled) setStatus(body.model_loaded ? 'ok' : 'degraded')
        })
        .catch(() => {
          if (!cancelled) setStatus('offline')
        })
    check()
    const timer = window.setInterval(check, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const colors = {
    ok: 'var(--severity-low)',
    degraded: 'var(--severity-medium)',
    offline: 'var(--severity-critical)',
    checking: 'var(--text-muted)',
  }
  const labels = {
    ok: 'API online',
    degraded: 'Model unavailable',
    offline: 'API offline',
    checking: 'Checking API',
  }

  return (
    <span className="row text-xs muted" style={{ gap: 6 }} role="status">
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: colors[status],
          flexShrink: 0,
        }}
      />
      <span className="hide-sm">{labels[status]}</span>
    </span>
  )
}

function NavLinks({ variant }) {
  return NAV_ITEMS.map((item) => {
    const Icon = item.icon
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
      >
        <Icon size={variant === 'bottom' ? 17 : 15} aria-hidden="true" />
        <span>{item.label}</span>
      </NavLink>
    )
  })
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [paletteOpen, setPaletteOpen] = useState(false)

  const onKeyDown = useCallback((event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      setPaletteOpen((open) => !open)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <header className="topbar">
        <div className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'var(--accent)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Radio size={15} color="var(--accent-contrast)" strokeWidth={2.5} />
          </span>
          <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>DisasterIQ</span>
          <span className="chip hide-sm" style={{ fontWeight: 600 }}>
            Analyse · Predict · Recommend
          </span>
        </div>

        <ApiStatus />

        <button
          type="button"
          className="btn btn-sm hide-sm"
          onClick={() => setPaletteOpen(true)}
          aria-keyshortcuts="Control+K"
        >
          <Command size={13} aria-hidden="true" />
          Ctrl K
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <div className="shell-body">
        <nav className="sidebar" aria-label="Primary">
          <NavLinks variant="side" />
        </nav>

        <main className="main-content" id="main" tabIndex={-1}>
          <Suspense fallback={<SkeletonCard height={280} />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/predict" element={<Predict />} />
              <Route path="/triage" element={<Triage />} />
              <Route path="/hazards" element={<Hazards />} />
              <Route path="/model" element={<ModelPage />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary mobile">
        <NavLinks variant="bottom" />
      </nav>

      <footer className="footer">
        Figure-Eight disaster response corpus · Hazard feeds: USGS, NASA EONET, GDACS ·
        Map tiles: OpenStreetMap contributors
      </footer>

      <CommandPalette
        key={paletteOpen ? 'palette-open' : 'palette-closed'}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  )
}
