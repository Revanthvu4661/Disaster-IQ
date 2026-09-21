import { useState, useEffect, useRef } from 'react'
import { BrainCircuit, Zap, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react'
import { api } from '../api/client'
import Spinner from '../components/Spinner'

/* ── severity config ────────────────────────────────────────────────────── */
const SEV = {
  critical: {
    color: '#ef4444', bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.35)', label: 'CRITICAL',
    barColor: '#ef4444', pulse: true,
  },
  high: {
    color: '#f97316', bg: 'rgba(249,115,22,0.08)',
    border: 'rgba(249,115,22,0.3)', label: 'HIGH',
    barColor: '#f97316', pulse: false,
  },
  medium: {
    color: '#eab308', bg: 'rgba(234,179,8,0.08)',
    border: 'rgba(234,179,8,0.25)', label: 'MEDIUM',
    barColor: '#eab308', pulse: false,
  },
  low: {
    color: '#94a3b8', bg: 'rgba(148,163,184,0.06)',
    border: 'rgba(148,163,184,0.15)', label: 'LOW',
    barColor: '#475569', pulse: false,
  },
}

const EXAMPLES = [
  'People need food and water urgently after the earthquake destroyed the village',
  'The flood has damaged all bridges — rescue teams cannot reach the northern district',
  'We have 50 injured people and no medical supplies at the shelter',
  'Missing family members in the Léogâne area, please help locate survivors',
  'Heavy rain continues, roads are blocked, emergency shelter needed',
]

/* ── animated confidence bar ────────────────────────────────────────────── */
function ConfBar({ value, color }) {
  const [width, setWidth] = useState(0)
  const pct = Math.round(value * 100)
  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), 60)
    return () => clearTimeout(t)
  }, [pct])

  const barColor =
    pct >= 70 ? color || '#ef4444' :
    pct >= 40 ? '#f97316' :
    '#1e293b'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <div className="conf-track">
        <div
          className="conf-fill"
          style={{ width: `${width}%`, background: barColor }}
        />
      </div>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        color: pct >= 50 ? barColor : '#334155',
        minWidth: 34,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {pct}%
      </span>
    </div>
  )
}

/* ── category row ───────────────────────────────────────────────────────── */
function CatRow({ cat, confidence, triggered }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '9px 14px',
      borderRadius: 10,
      background: triggered ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${triggered ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.04)'}`,
      transition: 'background 0.15s',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: triggered ? '#ef4444' : '#1e293b',
        boxShadow: triggered ? '0 0 6px rgba(239,68,68,0.5)' : 'none',
      }} />
      <span style={{
        fontSize: 13,
        fontWeight: triggered ? 500 : 400,
        color: triggered ? '#e2e8f0' : '#334155',
        textTransform: 'capitalize',
        minWidth: 150,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {cat.replace(/_/g, ' ')}
      </span>
      <ConfBar value={confidence} color={triggered ? '#ef4444' : undefined} />
    </div>
  )
}

/* ── severity score ring ────────────────────────────────────────────────── */
function ScoreRing({ score, color }) {
  const r = 28
  const circ = 2 * Math.PI * r
  const [dash, setDash] = useState(circ)
  useEffect(() => {
    const t = setTimeout(() => setDash(circ * (1 - score / 100)), 100)
    return () => clearTimeout(t)
  }, [score, circ])
  return (
    <svg width={72} height={72} viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={5} />
      <circle
        cx="36" cy="36" r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={circ}
        strokeDashoffset={dash}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.34,1.2,0.64,1)' }}
      />
      <text x="36" y="40" textAnchor="middle" fontSize="15" fontWeight="800" fill={color}>
        {Math.round(score)}
      </text>
    </svg>
  )
}

/* ── page ───────────────────────────────────────────────────────────────── */
export default function Predict() {
  const [message,  setMessage]  = useState('')
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [showAll,  setShowAll]  = useState(false)
  const textareaRef = useRef(null)

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!message.trim()) return
    try {
      setLoading(true)
      setError(null)
      setResult(null)
      setShowAll(false)
      const data = await api.predict(message.trim())
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleExample = (msg) => {
    setMessage(msg)
    setResult(null)
    setError(null)
    textareaRef.current?.focus()
  }

  const sev       = result ? SEV[result.severity.level] ?? SEV.low : null
  const triggered = result?.predictions.filter(p => p.triggered) ?? []

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}
         className="fade-up">

      {/* ── hero header ───────────────────────────── */}
      <div className="fade-up-1">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BrainCircuit size={16} color="#ef4444" />
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.5px' }}>
            Message Classifier
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          Enter a disaster-related message and the model will classify it across 35 response categories.
        </p>
      </div>

      {/* ── input card ────────────────────────────── */}
      <div className="card fade-up-2" style={{ padding: '28px 28px 22px' }}>
        <form onSubmit={handleSubmit}>
          <label style={{
            display: 'block',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#334155',
            marginBottom: 10,
          }}>
            Disaster Message
          </label>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe a disaster situation, a relief need, or a crisis message…"
            rows={5}
            style={{
              width: '100%',
              background: 'rgba(10,10,15,0.7)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 12,
              padding: '14px 16px',
              fontSize: 14,
              color: '#e2e8f0',
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
              caretColor: '#ef4444',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              boxSizing: 'border-box',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'rgba(239,68,68,0.4)'
              e.target.style.boxShadow   = '0 0 0 3px rgba(239,68,68,0.08)'
            }}
            onBlur={e => {
              e.target.style.borderColor = 'rgba(255,255,255,0.07)'
              e.target.style.boxShadow   = 'none'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0 18px', fontSize: 11, color: '#1e293b' }}>
            <span>{message.length} / 2000</span>
            {message.length > 0 && (
              <button
                type="button"
                onClick={() => setMessage('')}
                style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', fontSize: 11, padding: 0 }}
              >
                Clear
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || message.trim().length < 3}
            style={{
              width: '100%',
              padding: '13px 0',
              borderRadius: 10,
              border: 'none',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.01em',
              cursor: loading || message.trim().length < 3 ? 'not-allowed' : 'pointer',
              background: loading || message.trim().length < 3
                ? 'rgba(239,68,68,0.2)'
                : 'linear-gradient(135deg,#b91c1c,#ef4444)',
              color: loading || message.trim().length < 3 ? '#334155' : '#fff',
              boxShadow: loading || message.trim().length < 3 ? 'none' : '0 2px 16px rgba(239,68,68,0.35)',
              transition: 'opacity 0.15s, box-shadow 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? (
              'Classifying…'
            ) : (
              <>
                Classify Message
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

        {/* ── example chips ─────────────────────── */}
        <div style={{ marginTop: 22 }}>
          <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#1e293b' }}>
            Try an example
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {EXAMPLES.map((msg, i) => (
              <button key={i} className="example-chip" onClick={() => handleExample(msg)}>
                {msg}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── loading ───────────────────────────────── */}
      {loading && (
        <div className="card" style={{ padding: '8px 0' }}>
          <Spinner label="Running ensemble classifier…" />
        </div>
      )}

      {/* ── error ─────────────────────────────────── */}
      {error && (
        <div style={{
          borderRadius: 12, padding: '14px 18px', fontSize: 13,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5',
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── results ───────────────────────────────── */}
      {result && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} className="fade-up">

          {/* severity card */}
          <div
            className={sev.pulse ? 'severity-critical-card' : ''}
            style={{
              borderRadius: 16,
              padding: '22px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 20,
              background: sev.bg,
              border: `1px solid ${sev.border}`,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Zap size={14} color={sev.color} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: sev.color }}>
                  Severity — {sev.label}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.4px' }}>
                <span style={{ color: sev.color }}>{triggered.length}</span>
                <span style={{ fontWeight: 400, fontSize: 14, color: '#475569', marginLeft: 6 }}>
                  of 35 categories triggered
                </span>
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#334155' }}>
                Urgency score: <span style={{ color: sev.color, fontWeight: 700 }}>{result.severity.score.toFixed(0)}</span> / 100
              </p>
            </div>
            <ScoreRing score={result.severity.score} color={sev.color} />
          </div>

          {/* triggered categories */}
          {triggered.length > 0 && (
            <div className="card" style={{ padding: '20px 20px 16px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#334155' }}>
                Triggered Categories ({triggered.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {triggered.map((p) => (
                  <CatRow key={p.category} cat={p.category} confidence={p.confidence} triggered />
                ))}
              </div>
            </div>
          )}

          {triggered.length === 0 && (
            <div className="card" style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: '#334155' }}>
              No categories triggered above 50% confidence threshold.
            </div>
          )}

          {/* all categories (expandable) */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <button
              onClick={() => setShowAll(v => !v)}
              style={{
                width: '100%',
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: '#334155',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
              onMouseLeave={e => e.currentTarget.style.color = '#334155'}
            >
              <span>All 35 categories — sorted by confidence</span>
              {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showAll && (
              <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {result.predictions.map((p) => (
                  <CatRow key={p.category} cat={p.category} confidence={p.confidence} triggered={p.triggered} />
                ))}
              </div>
            )}
          </div>

          {/* model meta */}
          <p style={{ fontSize: 11, color: '#1e293b', textAlign: 'right', margin: 0 }}>
            Model macro F1: {result.model_macro_f1} · Threshold: 50%
          </p>
        </div>
      )}

    </div>
  )
}
