import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { History, Radio, RefreshCw } from 'lucide-react'
import { downSources, isIncomplete, useLiveEvents } from '../hooks/useLive'
import { DISASTER_IDS, DISASTER_TYPES, disasterVar } from '../config/disasterTypes'
import SourceBadge from '../components/SourceBadge'
import LiveEventMap from '../components/live/LiveEventMap'
import LiveEventTable from '../components/live/LiveEventTable'
import EventDetail from '../components/live/EventDetail'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui'
import { formatNumber, formatRelative } from '../lib/format'

const HistoricalLayer = lazy(() => import('../components/history/HistoricalLayer'))

const MODES = [
  { id: 'live', label: 'Live now', icon: Radio },
  { id: 'historical', label: 'Historical', icon: History },
]

/** Live / Historical switch. The two views never share a map, so a pin is always one or the other. */
function ModeSwitch({ mode, onChange }) {
  return (
    <div className="seg seg-mode" role="group" aria-label="Map mode">
      {MODES.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            className="seg-btn"
            aria-pressed={mode === item.id}
            onClick={() => onChange(item.id)}
          >
            <Icon size={14} aria-hidden="true" />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export default function WorldMap() {
  const [mode, setMode] = useState('live')
  const header = (
    <PageHeader
      title="World Map"
      description={
        mode === 'live'
          ? 'Current earthquakes, floods and cyclones worldwide, merged from USGS, GDACS and NASA EONET. Where two sources report the same event, both readings are kept.'
          : 'Past disasters by decade: USGS earthquakes (M6+) and NOAA IBTrACS cyclones at their exact positions, and EM-DAT flood records by country.'
      }
      actions={<ModeSwitch mode={mode} onChange={setMode} />}
    />
  )
  return (
    <div className="stack">
      {header}
      {mode === 'live' ? (
        <LiveMap />
      ) : (
        <Suspense fallback={<Skeleton height={520} />}>
          <HistoricalLayer />
        </Suspense>
      )}
    </div>
  )
}

/** True when the point is inside the bounds, allowing for the map wrapping at ±180°. */
function inBounds(bounds, event) {
  if (!bounds) return true
  return [0, 360, -360].some((shift) => bounds.contains([event.latitude, event.longitude + shift]))
}

const STATUS_TEXT = {
  ok: 'ok',
  stale: 'showing last good data',
  unavailable: 'temporarily unavailable',
  disabled: 'disabled',
}

function LiveMap() {
  const [nonce, setNonce] = useState(0)
  const { data, error, loading, reload } = useLiveEvents(undefined, { refreshNonce: nonce })
  const [enabled, setEnabled] = useState(() => new Set(DISASTER_IDS))
  const [bounds, setBounds] = useState(null)
  const [selected, setSelected] = useState(null)
  const [focus, setFocus] = useState(null)

  const visibleTypes = useMemo(
    () => (data?.events ?? []).filter((event) => enabled.has(event.type)),
    [data, enabled],
  )
  const inView = useMemo(
    () => visibleTypes.filter((event) => inBounds(bounds, event)),
    [visibleTypes, bounds],
  )
  const selectedEvent = data?.events.find((event) => event.id === selected) ?? null

  const toggle = (id) =>
    setEnabled((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onBoundsChange = useCallback((next) => setBounds(next), [])
  // Stable, so the memoised markers are not rebuilt on every pan.
  const onMarkerSelect = useCallback((event) => setSelected(event.id), [])
  const selectFromTable = (event) => {
    setSelected(event.id)
    setFocus({ latitude: event.latitude, longitude: event.longitude, id: event.id })
  }

  return (
    <div className="stack">
      <div className="row live-toolbar">
        <p className="callout callout-live" role="status">
          <span className="live-dot" aria-hidden="true" />
          <span>
            <strong>Live view.</strong> Current events from the feeds
            {data ? `, updated ${formatRelative(data.fetched_at)}` : ''}.
          </span>
        </p>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setNonce((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw size={13} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <section className="card" aria-labelledby="layers-title">
        <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="card-heading">
            <h2 className="card-title" id="layers-title">
              Layers
            </h2>
            <p className="card-insight">
              Toggle a disaster type. Larger dots carry a higher alert level.
            </p>
          </div>
          <div className="card-badge">
            <SourceBadge kind="live" detail="10-minute cache" />
          </div>
        </div>
        <div className="layer-toggles" role="group" aria-label="Disaster layers">
          {DISASTER_TYPES.map((type) => {
            const layer = data?.layers?.[type.id]
            const Icon = type.icon
            const on = enabled.has(type.id)
            const down = layer?.status === 'unavailable'
            return (
              <button
                key={type.id}
                type="button"
                className={`layer-toggle${on ? ' is-on' : ''}${down || isIncomplete(layer) ? ' is-down' : ''}`}
                aria-pressed={on}
                onClick={() => toggle(type.id)}
                style={{ '--dt': disasterVar(type.id) }}
              >
                <span className="layer-swatch" aria-hidden="true" />
                <Icon size={15} aria-hidden="true" />
                <span className="layer-name">{type.shortLabel}</span>
                <span className="layer-count">
                  {loading
                    ? '…'
                    : down
                      ? 'unavailable'
                      : !layer
                        ? '—'
                        : isIncomplete(layer)
                          ? layer.count === 0
                            ? `${downSources(layer).join(', ')} down`
                            : `${formatNumber(layer.count)}+ · incomplete`
                          : formatNumber(layer.count)}
                </span>
              </button>
            )
          })}
        </div>
        {data && (
          <ul className="source-status" aria-label="Feed status">
            {data.sources.map((source) => (
              <li key={source.id} className={`status-${source.status}`} title={source.current_rule}>
                <span className="status-dot" aria-hidden="true" />
                <strong>{source.name}</strong>
                <span className="muted">
                  {STATUS_TEXT[source.status] ?? source.status}
                  {source.status === 'ok' ? ` · ${formatNumber(source.count)} records` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="map-layout" aria-label="Live map and event list">
        <div className="card map-card">
          {loading ? (
            <div className="map-state" style={{ height: 'var(--map-height)' }} role="status">
              <Skeleton height="100%" />
              <span className="map-state-label">Loading live events…</span>
            </div>
          ) : error && !data ? (
            <div className="map-state map-state-error" style={{ height: 'var(--map-height)' }}>
              <ErrorState message={error} onRetry={reload} />
            </div>
          ) : (
            <LiveEventMap
              events={visibleTypes}
              selectedId={selected}
              onSelect={onMarkerSelect}
              onBoundsChange={onBoundsChange}
              focus={focus}
              fit
              fitKey={data?.fetched_at ?? 'initial'}
              height="var(--map-height)"
            />
          )}
        </div>

        <aside className="card map-panel" aria-labelledby="events-title">
          <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="card-heading">
              <h2 className="card-title" id="events-title">
                {data ? `${formatNumber(inView.length)} events in view` : 'Events'}
              </h2>
              <p className="card-insight">
                {data
                  ? `Of ${formatNumber(visibleTypes.length)} on the selected layers. Pan or zoom the map to filter this list.`
                  : 'Loading live events.'}
              </p>
            </div>
          </div>
          {selectedEvent && (
            <EventDetail event={selectedEvent} onClose={() => setSelected(null)} />
          )}
          {loading && <Skeleton height={300} />}
          {data && inView.length === 0 && (
            <EmptyState
              message={
                visibleTypes.length === 0
                  ? 'No layer is switched on, or the selected feeds are unavailable.'
                  : 'No events inside the current map view. Zoom out to see more.'
              }
            />
          )}
          {data && inView.length > 0 && (
            <LiveEventTable
              events={inView}
              selectedId={selected}
              onSelect={selectFromTable}
              caption="Current events inside the map view"
              maxHeight={selectedEvent ? 300 : 460}
            />
          )}
        </aside>
      </section>
    </div>
  )
}
