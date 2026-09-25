import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Moon, Radio, Sun } from 'lucide-react'
import { NAV_ITEMS } from './navigation'
import { DISASTER_TYPES, disasterVar } from './config/disasterTypes'
import { useTheme } from './context/ThemeContext'
import { api } from './api/client'
import CommandPalette from './components/CommandPalette'
import { SkeletonCard } from './components/ui'

// Route-level code splitting keeps the initial bundle small.
const Overview = lazy(() => import('./pages/Overview'))
const DisasterPage = lazy(() => import('./pages/DisasterPage'))
const WorldMap = lazy(() => import('./pages/WorldMap'))
const DisasterRisk = lazy(() => import('./pages/DisasterRisk'))
const Recommendations = lazy(() => import('./pages/Recommendations'))
const About = lazy(() => import('./pages/About'))
const NotFound = lazy(() => import('./pages/NotFound'))

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

function ApiStatus() {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false
    const check = () =>
      api
        .health()
        .then((body) => {
          if (!cancelled) setStatus(body.analytics_ready ? 'ok' : 'degraded')
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

  const labels = {
    ok: 'Data online',
    degraded: 'Historical data unavailable',
    offline: 'API offline',
    checking: 'Checking API',
  }

  return (
    <span className={`api-status api-status-${status}`} role="status">
      <span className="api-status-dot" aria-hidden="true" />
      <span>{labels[status]}</span>
    </span>
  )
}

/**
 * The only navigation: one row of tabs in the top bar. When the tabs do
 * not fit (phones), the row scrolls sideways instead of collapsing into a menu,
 * and the active tab is scrolled into view on every route change. Edge fades
 * show that more tabs are off-screen.
 */
function TabNav() {
  const scrollerRef = useRef(null)
  const location = useLocation()
  const [edges, setEdges] = useState({ left: false, right: false })

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    })
  }, [])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    const active = el?.querySelector('[aria-current="page"]')
    if (el && active) {
      // Centre the active tab inside the bar without scrolling the page.
      const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2
      el.scrollTo({ left: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
    updateEdges()
  }, [location.pathname, updateEdges])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(updateEdges)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateEdges])

  return (
    <nav
      className={`tabnav${edges.left ? ' fade-left' : ''}${edges.right ? ' fade-right' : ''}`}
      aria-label="Primary"
    >
      <ul className="tabnav-list" ref={scrollerRef} onScroll={updateEdges}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}
                style={item.disasterId ? { '--tab-color': disasterVar(item.disasterId) } : undefined}
              >
                <Icon size={16} aria-hidden="true" className="tab-icon" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()

  // The section colour tints the bar's top border: a disaster's own colour on
  // its page (and on Flood Risk Prediction), the brand accent elsewhere.
  const currentType =
    DISASTER_TYPES.find((type) => location.pathname === type.path) ??
    NAV_ITEMS.find((item) => item.to === location.pathname && item.disasterId)
  const sectionColor = currentType
    ? disasterVar(currentType.disasterId ?? currentType.id)
    : 'var(--accent)'

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

  // New page: start at the top.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <header className="topbar" style={{ '--section-color': sectionColor }}>
        <Link to="/" className="brand" aria-label="DisasterIQ overview">
          <span className="brand-mark" aria-hidden="true">
            <Radio size={15} strokeWidth={2.5} />
          </span>
          <span className="brand-name">DisasterIQ</span>
        </Link>

        <TabNav />

        <button
          type="button"
          className="icon-btn topbar-theme"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <div className="shell-body">
        <main className="main-content" id="main" tabIndex={-1}>
          <Suspense fallback={<SkeletonCard height={280} />}>
            <Routes>
              <Route path="/" element={<Overview />} />
              {DISASTER_TYPES.map((type) => (
                <Route key={type.id} path={type.path} element={<DisasterPage id={type.id} />} />
              ))}
              <Route path="/map" element={<WorldMap />} />
              <Route path="/risk" element={<DisasterRisk />} />
              <Route path="/preparedness" element={<Recommendations />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <footer className="footer">
        <p>
          Historical data: EM-DAT (CRED / UCLouvain) via Our World in Data, USGS earthquake catalogue,
          NOAA IBTrACS · Live feeds: USGS, GDACS, NASA EONET · Flood risk: India Flood Inventory, NASA
          POWER, Copernicus DEM, Census of India 2011 · Map: OpenStreetMap contributors, Natural Earth,
          geoBoundaries
        </p>
        <p className="footer-tools">
          <Link to="/about">About the data</Link>
          <button type="button" className="footer-link" onClick={() => setPaletteOpen(true)}>
            Command palette (Ctrl K)
          </button>
        </p>
        <p className="footer-status">
          <ApiStatus />
        </p>
      </footer>

      <CommandPalette
        key={paletteOpen ? 'palette-open' : 'palette-closed'}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  )
}
