import { memo } from 'react'

function KpiCardBase({ title, value, sub, icon, accent = 'var(--accent)', footer, className = '' }) {
  return (
    <article
      className={`card ${className}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
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

      <div>
        <p className="kpi-value">{value}</p>
        {sub && (
          <p className="text-xs secondary" style={{ marginTop: 4 }}>
            {sub}
          </p>
        )}
      </div>

      {footer && (
        <div className="row text-xs" style={{ color: 'var(--text-muted)', gap: 6 }}>
          {footer}
        </div>
      )}
    </article>
  )
}

export const KpiCard = memo(KpiCardBase)
export default KpiCard
