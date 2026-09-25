import { disasterVar } from '../config/disasterTypes'

/**
 * Page header shared by the three disaster pages: eyebrow, coloured icon tile
 * beside the title, one-line definition, badges.
 *
 * Optional theme slots (all decorative except the panel's readouts):
 *   `hazardNo`  "Hazard 01" tag before the eyebrow
 *   `panel`     instrument panel on the right (seismograph / gauge / radar)
 *   `backdrop`  faint drawing behind the header
 *   `motif`     decoration around the icon tile (ripples, storm spiral)
 */
export function DisasterHeader({ type, eyebrow, badges, actions, hazardNo, panel, backdrop, motif }) {
  const Icon = type.icon
  return (
    <header className="disaster-header" style={{ '--dt': disasterVar(type.id) }}>
      {backdrop}
      <div className="disaster-header-text">
        {(eyebrow || hazardNo) && (
          <p className="eyebrow">
            {hazardNo && <span className="hazard-no">{hazardNo}</span>}
            {eyebrow}
          </p>
        )}
        <div className="disaster-title-row">
          <span className="disaster-tile" aria-hidden="true">
            {motif}
            <Icon size={24} strokeWidth={2} />
          </span>
          {/* A zero-width space after the slash lets "Cyclone/Hurricane" wrap there. */}
          <h1>{type.label.replace('/', '/\u200b')}</h1>
        </div>
        <p className="disaster-definition">{type.definition}</p>
        {badges && <div className="row disaster-badges">{badges}</div>}
      </div>
      {panel}
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
