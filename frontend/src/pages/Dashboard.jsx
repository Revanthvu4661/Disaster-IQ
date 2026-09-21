import { useEffect, useState } from 'react'
import { MessageSquare, Tag, AlertTriangle, TrendingUp, BarChart2, Activity } from 'lucide-react'
import { api } from '../api/client'
import KpiCard from '../components/KpiCard'
import CategoryBarChart from '../components/CategoryBarChart'
import VolumeChart from '../components/VolumeChart'
import Spinner from '../components/Spinner'

/* ── section header ────────────────────────────────────────────────────── */
function SectionHeader({ icon: Icon, title, sub }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {Icon && <Icon size={15} color="#ef4444" strokeWidth={2} />}
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.2px' }}>
          {title}
        </h2>
      </div>
      {sub && <p style={{ margin: 0, fontSize: 11, color: '#334155', letterSpacing: '0.01em' }}>{sub}</p>}
    </div>
  )
}

/* ── error banner ──────────────────────────────────────────────────────── */
function ErrorBanner({ message }) {
  return (
    <div style={{
      borderRadius: 12,
      padding: '14px 18px',
      fontSize: 13,
      background: 'rgba(239,68,68,0.08)',
      border: '1px solid rgba(239,68,68,0.2)',
      color: '#fca5a5',
    }}>
      ⚠ {message}
    </div>
  )
}

/* ── segmented control ─────────────────────────────────────────────────── */
function SegControl({ options, value, onChange }) {
  return (
    <div className="seg-pill">
      {options.map((n) => (
        <button key={n} className={`seg-btn${value === n ? ' active' : ''}`} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
    </div>
  )
}

/* ── page ──────────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const [stats,   setStats]   = useState(null)
  const [cats,    setCats]    = useState([])
  const [volume,  setVolume]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [topN,    setTopN]    = useState(15)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const [s, c, v] = await Promise.all([
          api.summaryStats(),
          api.topCategories(topN),
          api.volumeByEvent(),
        ])
        setStats(s)
        setCats(c)
        setVolume(v)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [topN])

  if (loading) return <Spinner size="lg" label="Loading analytics…" />
  if (error)   return <ErrorBanner message={`Failed to load data: ${error}. Is the backend running on port 8000?`} />

  const genreTotal = Object.values(stats.genre_breakdown).reduce((a, b) => a + b, 0)
  const urgentPct  = ((stats.urgent_messages / stats.total_messages) * 100).toFixed(1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── page title ──────────────────────────────── */}
      <div className="fade-up">
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.6px' }}>
          Analytics Dashboard
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          Real Figure-Eight disaster response data — Haiti earthquake, Chile earthquake, Pakistan floods, Superstorm Sandy
        </p>
      </div>

      {/* ── KPI row ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}
           className="fade-up fade-up-1">
        <KpiCard
          title="Total Messages"
          value={stats.total_messages.toLocaleString()}
          sub="After deduplication"
          icon={<MessageSquare size={16} />}
          variant="accent"
        />
        <KpiCard
          title="Categories"
          value={stats.total_categories}
          sub="Multi-label classification"
          icon={<Tag size={16} />}
        />
        <KpiCard
          title="Urgent Messages"
          value={stats.urgent_messages.toLocaleString()}
          sub={`${urgentPct}% of total messages`}
          icon={<AlertTriangle size={16} />}
          variant="danger"
        />
        <KpiCard
          title="Top Categories"
          value=""
          sub="Most frequent labels"
          icon={<TrendingUp size={16} />}
          highlight={stats.top_categories.map(c => c.replace(/_/g, ' '))}
        />
      </div>

      {/* ── source breakdown ────────────────────────── */}
      <div className="card fade-up fade-up-2" style={{ padding: '20px 24px' }}>
        <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#334155' }}>
          Message Source Breakdown
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 14 }}>
          {Object.entries(stats.genre_breakdown).map(([genre, count]) => {
            const pct = ((count / genreTotal) * 100).toFixed(1)
            const COLS = { direct: '#ef4444', news: '#3b82f6', social: '#8b5cf6' }
            const color = COLS[genre] ?? '#64748b'
            return (
              <div key={genre} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#94a3b8', textTransform: 'capitalize' }}>{genre}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color }}>{count.toLocaleString()}</span>
                <span style={{ fontSize: 11, color: '#334155' }}>({pct}%)</span>
              </div>
            )
          })}
        </div>
        {/* proportional bar */}
        <div style={{ height: 6, borderRadius: 99, overflow: 'hidden', display: 'flex', gap: 2, background: 'rgba(255,255,255,0.04)' }}>
          {Object.entries(stats.genre_breakdown).map(([genre, count]) => {
            const pct = (count / genreTotal) * 100
            const COLS = { direct: '#ef4444', news: '#3b82f6', social: '#8b5cf6' }
            return (
              <div
                key={genre}
                style={{ width: `${pct}%`, background: COLS[genre] ?? '#64748b', borderRadius: 99, transition: 'width 0.6s ease' }}
                title={`${genre}: ${pct.toFixed(1)}%`}
              />
            )
          })}
        </div>
      </div>

      {/* ── charts row ──────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}
           className="fade-up fade-up-3">

        {/* category bar chart */}
        <div className="card" style={{ padding: '24px 24px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
            <SectionHeader
              icon={BarChart2}
              title="Category Distribution"
              sub="Message count per label — red bars = urgent categories"
            />
            <div style={{ flexShrink: 0 }}>
              <SegControl options={[10, 15, 20, 35]} value={topN} onChange={setTopN} />
            </div>
          </div>
          <CategoryBarChart data={cats} />
        </div>

        {/* volume chart */}
        <div className="card" style={{ padding: '24px 24px 20px' }}>
          <SectionHeader
            icon={Activity}
            title="Volume by Source"
            sub="Direct, news, and social media"
          />
          <VolumeChart data={volume} />

          {/* avg stat */}
          <div style={{
            marginTop: 16,
            borderRadius: 10,
            padding: '14px 16px',
            textAlign: 'center',
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.14)',
          }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#ef4444', letterSpacing: '-0.5px', lineHeight: 1 }}>
              {stats.avg_categories_per_message}
            </p>
            <p style={{ margin: '5px 0 0', fontSize: 11, color: '#475569' }}>avg categories per message</p>
          </div>
        </div>

      </div>

      {/* ── model info strip ────────────────────────── */}
      <div
        className="fade-up fade-up-4"
        style={{
          borderRadius: 12,
          padding: '14px 20px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 20,
          fontSize: 11,
          color: '#334155',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <InfoDot color="#22c55e" label="Model: TF-IDF + SGD + ComplementNB ensemble" />
        <InfoDot color="#3b82f6" label="35 active categories · macro F1 ≈ 0.405" />
        <InfoDot color="#ef4444" label="Dataset: Figure-Eight — 4 disaster events" />
        <div style={{ marginLeft: 'auto' }}>
          <a
            href="/predict"
            style={{
              display: 'inline-block',
              padding: '7px 14px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(239,68,68,0.12)',
              color: '#f87171',
              border: '1px solid rgba(239,68,68,0.22)',
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
          >
            Try Prediction →
          </a>
        </div>
      </div>

    </div>
  )
}

function InfoDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  )
}
