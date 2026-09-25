import { RefreshCw } from 'lucide-react'
import { formatNumber, formatRelative } from '../../lib/format'
import { useNow } from '../../hooks/useNow'

/** "cached, updated 25 min ago" for a feed served from its last good copy. */
function cachedText(source, now) {
  if (source.fetched_at) return `cached, updated ${formatRelative(source.fetched_at, now)}`
  if (source.age_seconds != null) return `cached, updated ${formatRelative(now - source.age_seconds * 1000, now)}`
  return 'cached copy'
}

/** Status text for one feed; the dot colour only names the source, never the status. */
export function sourceStatusText(source, now = Date.now()) {
  const records = `${formatNumber(source.count)} ${source.count === 1 ? 'record' : 'records'}`
  switch (source.status) {
    case 'ok':
      return records
    case 'stale':
      return `${records} · ${cachedText(source, now)}`
    case 'disabled':
      return 'disabled'
    default:
      return 'temporarily unavailable'
  }
}

/**
 * Feed status pills (USGS red, GDACS blue, NASA EONET purple), when the data
 * was fetched, and a refresh button. The tooltip on each pill states the
 * feed's rule for what counts as current.
 */
export function SourceStrip({ sources = [], fetchedAt, loading, onRefresh }) {
  const now = useNow()
  return (
    <div className="wm-strip">
      <ul className="wm-strip-pills" aria-label="Live feed status">
        {sources.map((source) => (
          <li key={source.id} className={`wm-src wm-src-${source.id} is-${source.status}`} title={source.current_rule}>
            <span className="wm-src-dot" aria-hidden="true" />
            <strong>{source.name}</strong>
            <span className="wm-src-status">{sourceStatusText(source, now)}</span>
          </li>
        ))}
        {loading && sources.length === 0 && <li className="wm-src is-loading">Checking live feeds…</li>}
      </ul>
      <div className="wm-strip-actions">
        {fetchedAt && (
          <span className="wm-strip-time" role="status">
            <span className="live-dot" aria-hidden="true" />
            Updated {formatRelative(fetchedAt, now)}
          </span>
        )}
        <button type="button" className="wm-btn" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={13} aria-hidden="true" className={loading ? 'wm-spin' : undefined} />
          Refresh
        </button>
      </div>
    </div>
  )
}

export default SourceStrip
