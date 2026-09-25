import { GLYPHS } from '../map/eventIcons'
import { DEFAULT_SEVERITY_RULE, mapType, severityMeta } from '../../lib/liveEvents'

/**
 * Round type badge, the same artwork as the map marker. The SVG strings are
 * static constants from eventIcons.js, never data from a feed.
 */
export function TypeIcon({ type, size = 40, decorative = false }) {
  const label = mapType(type)?.label ?? type
  return (
    <span
      className={`wm-badge wm-${type}`}
      style={{ width: size, height: size }}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      dangerouslySetInnerHTML={{ __html: GLYPHS[type] ?? '' }}
    />
  )
}

/**
 * Severity pill. The tooltip names what this event's class was based on and
 * states the whole rule, so the class is never a black box.
 */
export function SeverityPill({ event, rule = DEFAULT_SEVERITY_RULE }) {
  const meta = severityMeta(event.severity_level)
  if (!meta) {
    return (
      <span className="wm-pill wm-pill-unrated" title={`Not rated. ${rule}`}>
        Not rated
      </span>
    )
  }
  const basis = event.severity_basis ? `${meta.label}: ${event.severity_basis}. ` : ''
  return (
    <span className={`wm-pill wm-pill-${meta.id}`} title={`${basis}Rule: ${rule}`}>
      {meta.label}
    </span>
  )
}
