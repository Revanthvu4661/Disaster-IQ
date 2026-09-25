import { disasterVar } from '../config/disasterTypes'

/**
 * Page header shared by the three disaster pages: coloured icon tile, title,
 * one-line definition, badges.
 */
export function DisasterHeader({ type, eyebrow, badges, actions }) {
  const Icon = type.icon
  return (
    <header className="disaster-header" style={{ '--dt': disasterVar(type.id) }}>
      <span className="disaster-tile" aria-hidden="true">
        <Icon size={24} strokeWidth={2} />
      </span>
      <div className="disaster-header-text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{type.label}</h1>
        <p className="text-sm secondary" style={{ marginTop: 2 }}>
          {type.definition}
        </p>
        {badges && <div className="row" style={{ marginTop: 'var(--space-3)', gap: 6 }}>{badges}</div>}
      </div>
      {actions && <div className="disaster-header-actions">{actions}</div>}
    </header>
  )
}

/** Small heading above a row of KPI tiles, with its provenance badge top-right. */
export function SectionHeading({ title, badge, id }) {
  return (
    <div className="section-heading">
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {badge}
    </div>
  )
}

export default DisasterHeader
