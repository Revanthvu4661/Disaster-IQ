import { useMemo, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import { CloudOff, RefreshCw } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SeverityBadge,
  SkeletonCard,
} from '../components/ui'
import { formatDateTime, formatNumber } from '../lib/format'

const SEVERITY_COLOR = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#16a34a',
}

/** Coloured circle markers avoid Leaflet's default icon asset problem entirely. */
const markerIcon = (severity) =>
  L.divIcon({
    className: '',
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${
      SEVERITY_COLOR[severity] ?? '#64748b'
    };border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })

export default function Hazards() {
  const [indiaOnly, setIndiaOnly] = useState(false)
  const [source, setSource] = useState('all')
  const { data, error, loading, reload } = useApi(
    () => api.hazards({ indiaOnly, source: source === 'all' ? undefined : source }),
    [indiaOnly, source],
  )

  const mapped = useMemo(
    () => (data?.hazards ?? []).filter((h) => h.latitude !== null && h.longitude !== null),
    [data],
  )

  if (loading) {
    return (
      <div className="stack">
        <PageHeader title="Live Hazards" description="Fetching open hazard feeds" />
        <SkeletonCard height={360} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="stack">
        <PageHeader title="Live Hazards" />
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  const offline = !data.online

  return (
    <div className="stack">
      <PageHeader
        title="Live Hazards"
        description="Open feeds from USGS, NASA EONET and GDACS, cached for ten minutes. This layer is independent of the message model and degrades to an offline state when a feed is unreachable."
        actions={
          <button type="button" className="btn btn-sm" onClick={reload}>
            <RefreshCw size={13} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      <section className="card" aria-label="Feed status">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 8 }}>
            {data.sources.map((feed) => (
              <span
                key={feed.source}
                className={`chip ${feed.status === 'ok' ? 'sev-low' : 'sev-high'}`}
                title={feed.description}
              >
                {feed.source.toUpperCase()}: {feed.status === 'ok' ? formatNumber(feed.count) : feed.status}
              </span>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <label className="visually-hidden" htmlFor="hazard-source">
              Source
            </label>
            <select
              id="hazard-source"
              className="select"
              style={{ width: 'auto' }}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">All sources</option>
              <option value="usgs">USGS earthquakes</option>
              <option value="eonet">NASA EONET</option>
              <option value="gdacs">GDACS alerts</option>
            </select>
            <button
              type="button"
              className="btn btn-sm"
              aria-pressed={indiaOnly}
              onClick={() => setIndiaOnly((value) => !value)}
              style={{ borderColor: indiaOnly ? 'var(--accent)' : undefined }}
            >
              India focus
            </button>
          </div>
        </div>
        <p className="text-xs muted" style={{ marginTop: 'var(--space-3)' }}>
          {offline
            ? 'All feeds are unreachable right now. The rest of DisasterIQ works offline.'
            : `Fetched ${formatDateTime(data.fetched_at)}${data.cached ? ` (cached ${data.age_seconds}s ago)` : ''}.`}
        </p>
      </section>

      {offline ? (
        <section className="card">
          <EmptyState
            icon={CloudOff}
            message="No live hazard data available. Check the network connection and refresh."
          >
            <button type="button" className="btn btn-sm" onClick={reload}>
              Try again
            </button>
          </EmptyState>
        </section>
      ) : (
        <>
          <section className="card" aria-label="Hazard map">
            <div className="card-header">
              <div>
                <h2 className="card-title">Hazard map</h2>
                <p className="card-insight">
                  {formatNumber(mapped.length)} located hazards
                  {data.india_count ? ` · ${formatNumber(data.india_count)} inside India` : ''}.
                </p>
              </div>
            </div>
            <div className="map-shell">
              <MapContainer
                center={indiaOnly ? [22, 79] : [20, 10]}
                zoom={indiaOnly ? 4 : 2}
                scrollWheelZoom={false}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mapped.slice(0, 300).map((hazard) => (
                  <Marker
                    key={hazard.id}
                    position={[hazard.latitude, hazard.longitude]}
                    icon={markerIcon(hazard.severity)}
                  >
                    <Popup>
                      <strong>{hazard.title}</strong>
                      <br />
                      {hazard.category} · {formatDateTime(hazard.time)}
                      {hazard.url && (
                        <>
                          <br />
                          <a href={hazard.url} target="_blank" rel="noreferrer noopener">
                            Source report
                          </a>
                        </>
                      )}
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </section>

          <section className="card" aria-label="Hazard list">
            <div className="card-header">
              <div>
                <h2 className="card-title">Latest hazards</h2>
                <p className="card-insight">Most recent first, across every selected feed.</p>
              </div>
            </div>
            {data.hazards.length === 0 ? (
              <EmptyState message="No hazards match this filter" />
            ) : (
              <div className="table-wrap" style={{ maxHeight: 380 }}>
                <table className="data">
                  <caption className="visually-hidden">Current hazards</caption>
                  <thead>
                    <tr>
                      <th scope="col">Severity</th>
                      <th scope="col">Type</th>
                      <th scope="col">Title</th>
                      <th scope="col">Time</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.hazards.slice(0, 120).map((hazard) => (
                      <tr key={hazard.id}>
                        <td>
                          <SeverityBadge level={hazard.severity ?? 'low'} />
                        </td>
                        <td>{hazard.category}</td>
                        <td className="wrap">
                          {hazard.url ? (
                            <a href={hazard.url} target="_blank" rel="noreferrer noopener">
                              {hazard.title}
                            </a>
                          ) : (
                            hazard.title
                          )}
                        </td>
                        <td>{formatDateTime(hazard.time)}</td>
                        <td>{hazard.source.toUpperCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
