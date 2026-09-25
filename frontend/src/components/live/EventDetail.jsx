import { AlertTriangle, ExternalLink, X } from 'lucide-react'
import { disasterVar, getDisasterType } from '../../config/disasterTypes'
import { formatDateTime } from '../../lib/format'

/**
 * Detail card for one live event. Lists every source's own reading, so when
 * USGS and GDACS disagree on a magnitude both numbers are visible.
 */
export function EventDetail({ event, onClose }) {
  if (!event) return null
  const type = getDisasterType(event.type)
  const Icon = type?.icon

  return (
    <article
      className="event-detail fade-in"
      aria-label={`Details: ${event.title}`}
      style={{ '--dt': disasterVar(event.type) }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="type-cell" style={{ color: 'var(--dt)' }}>
          {Icon && <Icon size={15} aria-hidden="true" />}
          <strong>{type?.label}</strong>
        </span>
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <h3 style={{ marginTop: 4 }}>{event.title}</h3>
      {event.location && event.location !== event.title && (
        <p className="text-sm secondary">{event.location}</p>
      )}

      <dl className="detail-list">
        <div>
          <dt>Started</dt>
          <dd>{formatDateTime(event.date)}</dd>
        </div>
        {event.updated && (
          <div>
            <dt>Last update</dt>
            <dd>{formatDateTime(event.updated)}</dd>
          </div>
        )}
        <div>
          <dt>Coordinates</dt>
          <dd className="mono">
            {event.latitude.toFixed(2)}, {event.longitude.toFixed(2)}
          </dd>
        </div>
      </dl>

      {event.disagreement && (
        <p className="note-warn" role="note">
          <AlertTriangle size={14} aria-hidden="true" />
          Sources disagree: {event.disagreement}. Both readings are shown below.
        </p>
      )}

      <h4 className="field-label" style={{ marginTop: 'var(--space-3)', marginBottom: 6 }}>
        {event.sources.length > 1 ? `${event.sources.length} sources` : 'Source'}
      </h4>
      <ul className="source-list">
        {event.sources.map((source) => (
          <li key={`${source.source}:${source.source_id}`}>
            <div>
              <strong className="text-sm">{source.source_name}</strong>
              {source.upstream && (
                <span className="text-xs muted"> · via {source.upstream}</span>
              )}
              <p className="text-sm secondary">{source.severity_label ?? 'No severity reported'}</p>
            </div>
            {source.url && (
              <a href={source.url} target="_blank" rel="noreferrer noopener" className="text-sm">
                Open
                <ExternalLink size={12} aria-hidden="true" style={{ marginLeft: 3 }} />
                <span className="visually-hidden"> {source.source_name} report (new tab)</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </article>
  )
}

export default EventDetail
