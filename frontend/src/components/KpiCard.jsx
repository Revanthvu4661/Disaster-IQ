import { memo } from 'react'

/**
 * One figure in a KPI grid.
 *
 * `tone` names what the figure measures (deaths, total_affected, …) as a
 * `data-tone` attribute, so a page theme can colour it; it changes no text.
 * `meter` (0–1) draws a small bar under the value, e.g. the share of records
 * that report the figure; it repeats what `sub` says and is hidden from
 * assistive tech.
 */
function KpiCardBase({ title, value, sub, icon, accent = 'var(--accent)', footer, className = '', tone, meter }) {
  const share = typeof meter === 'number' && Number.isFinite(meter) ? Math.max(0, Math.min(1, meter)) : null
  return (
    <article className={`card kpi-card ${className}`} data-tone={tone} style={{ '--kpi-accent': accent }}>
      <div className="row kpi-card-top">
        <span className="kpi-title">{title}</span>
        {icon && <span className="kpi-icon">{icon}</span>}
      </div>

      <div>
        <p className="kpi-value">{value}</p>
        {share !== null && (
          <span className="kpi-meter" aria-hidden="true">
            <span style={{ width: `${(share * 100).toFixed(1)}%` }} />
          </span>
        )}
        {sub && <p className="text-xs secondary kpi-sub">{sub}</p>}
      </div>

      {footer && <div className="row text-xs kpi-footer">{footer}</div>}
    </article>
  )
}

export const KpiCard = memo(KpiCardBase)
export default KpiCard
