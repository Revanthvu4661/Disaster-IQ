import { Routes, Route, NavLink } from 'react-router-dom'
import { LayoutDashboard, BrainCircuit, Radio } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Predict from './pages/Predict'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0a0a0f' }}>

      {/* ── top nav ─────────────────────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(10,10,15,0.85)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 24px',
            height: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: 'linear-gradient(135deg,#b91c1c,#ef4444)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 2px 12px rgba(239,68,68,0.35)',
              }}
            >
              <Radio size={15} color="#fff" strokeWidth={2.5} />
            </div>
            <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>
              DisasterIQ
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: 99,
                background: 'rgba(239,68,68,0.12)',
                color: '#f87171',
                border: '1px solid rgba(239,68,68,0.2)',
                marginLeft: 2,
              }}
            >
              Live
            </span>
          </div>

          {/* nav */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <NavLink
              to="/"
              end
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <LayoutDashboard size={14} />
              Dashboard
            </NavLink>
            <NavLink
              to="/predict"
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <BrainCircuit size={14} />
              Predict
            </NavLink>
          </nav>

          {/* api status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569' }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#22c55e',
                display: 'inline-block',
                boxShadow: '0 0 6px #22c55e',
                animation: 'pulse 2s infinite',
              }}
            />
            API live
          </div>
        </div>
      </header>

      {/* ── page content ────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 1200, width: '100%', margin: '0 auto', padding: '32px 24px' }}>
        <Routes>
          <Route path="/"        element={<Dashboard />} />
          <Route path="/predict" element={<Predict />} />
        </Routes>
      </main>

      {/* ── footer ──────────────────────────────────── */}
      <footer
        style={{
          borderTop: '1px solid rgba(255,255,255,0.04)',
          padding: '14px 24px',
          textAlign: 'center',
          fontSize: 11,
          color: '#1e293b',
        }}
      >
        DisasterIQ · Figure-Eight dataset · 26,177 messages · 35 categories
      </footer>
    </div>
  )
}
