import { memo } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatDelta } from '../lib/format'

/** Inline sparkline drawn as a plain SVG path (no chart library needed). */
function Sparkline({ values = [], color = 'var(--accent)', label }) {
  if (!values.length) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const width = 96
  const height = 26
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((value, index) => {
    const x = index * step
    const y = height - ((value - min) / span) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      style={{ overflow: 'visible' }}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function KpiCardBase({
  title,
  value,
  sub,
  icon,
  delta,
  sparkline,
  accent = 'var(--accent)',
  footer,
}) {
  const deltaText = formatDelta(delta)
  const DeltaIcon = (delta ?? 0) >= 0 ? TrendingUp : TrendingDown
  const deltaColor =
    delta === undefined || delta === null || delta === 0
      ? 'var(--text-muted)'
      : delta > 0
        ? 'var(--severity-high)'
        : 'var(--severity-low)'

  return (
    <article className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span
          className="text-xs"
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            fontWeight: 600,
            color: 'var(--text-muted)',
          }}
        >
          {title}
        </span>
        {icon && <span style={{ color: accent, display: 'flex' }}>{icon}</span>}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, lineHeight: 1.1 }}>{value}</p>
          {sub && (
            <p className="text-xs secondary" style={{ marginTop: 4 }}>
              {sub}
            </p>
          )}
        </div>
        {sparkline?.length > 0 && (
          <Sparkline
            values={sparkline}
            color={accent}
            label={`${title} trend across corpus order`}
          />
        )}
      </div>

      {(deltaText || footer) && (
        <div className="row text-xs" style={{ color: 'var(--text-muted)', gap: 6 }}>
          {deltaText && (
            <span className="row" style={{ gap: 4, color: deltaColor }}>
              <DeltaIcon size={13} aria-hidden="true" />
              {deltaText}
            </span>
          )}
          {footer}
        </div>
      )}
    </article>
  )
}

export const KpiCard = memo(KpiCardBase)
export default KpiCard
