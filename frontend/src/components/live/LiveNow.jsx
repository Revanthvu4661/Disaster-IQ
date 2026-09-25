import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { downSources, isIncomplete, useLiveEvents } from '../../hooks/useLive'
import SourceBadge from '../SourceBadge'
import { ErrorState, Skeleton } from '../ui'
import { formatRelative, plural } from '../../lib/format'
import { severityShort, shortPlace } from '../../lib/liveEvents'

/**
 * Live counterpart on a historical page: what the feeds report right now, in
 * one compact card. A failed feed is named, never read as "no events".
 */
export function LiveNow({ type, headingLevel = 3 }) {
  const { data, error, loading, reload } = useLiveEvents(type.id)
  const layer = data?.layers?.[type.id]
  const recent = (data?.events ?? []).slice(0, 3)
  const [singular, pluralNoun] = type.noun
  const Heading = `h${headingLevel}`

  return (
    <section className="card live-now" aria-labelledby={`live-${type.id}`}>
      <div className="card-header">
        <div className="card-heading">
          <Heading className="card-title" id={`live-${type.id}`}>
            Right now
          </Heading>
          <p className="card-insight">
            {loading && 'Checking the live feeds…'}
            {error && 'Live feeds could not be reached.'}
            {layer &&
              (layer.status === 'unavailable'
                ? `The ${singular} layer is temporarily unavailable.`
                : isIncomplete(layer)
                  ? `${downSources(layer).join(' and ')} is temporarily unavailable, so this list is incomplete: ${plural(layer.count, singular, pluralNoun)} from the feeds that answered.`
                  : `${plural(layer.count, singular, pluralNoun)} currently reported by ${layer.sources
                      .map((source) => source.name)
                      .join(' and ')}. This is live monitoring, separate from the historical records above.`)}
          </p>
        </div>
        <div className="card-badge">
          <SourceBadge kind="live" detail={type.liveSources.join(', ')} />
        </div>
      </div>
      {loading && <Skeleton height={64} />}
      {error && <ErrorState compact message={error} onRetry={reload} />}
      {recent.length > 0 && (
        <ul className="live-now-list">
          {recent.map((event) => (
            <li key={event.id}>
              <span className="live-now-place">{shortPlace(event)}</span>
              <span className="text-xs secondary">
                {severityShort(event)} · {formatRelative(event.updated ?? event.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/map" className="text-link">
        See all live events on the World Map
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </section>
  )
}

export default LiveNow
