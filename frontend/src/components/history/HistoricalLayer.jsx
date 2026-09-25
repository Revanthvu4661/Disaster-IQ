import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { api } from '../../api/client'
import { useApi } from '../../hooks/useApi'
import { DISASTER_IDS, DISASTER_TYPES, disasterHex, disasterVar, getDisasterType } from '../../config/disasterTypes'
import { sourceName } from '../../config/sources'
import { useTheme } from '../../context/ThemeContext'
import SourceBadge from '../SourceBadge'
import SortableTable from '../SortableTable'
import { ErrorState, Skeleton } from '../ui'
import HistoryMap from './HistoryMap'
import { formatDecade, formatNumber } from '../../lib/format'

const DECADE_DEFAULT = 2010
const STRONGEST_PER_TYPE = 10

/** Marker radius from what each layer is sized by. */
const RADIUS = {
  magnitude: (value) => 2 + (value - 6) * 3,
  max_wind_kt: (value) => 2 + (value - 34) / 15,
  severity: (value) => 3 + (value ?? 0) / 9,
}

const SIZE_WORDS = {
  magnitude: 'magnitude',
  max_wind_kt: 'peak wind',
  severity: 'highest Severity Index that decade',
}

const measure = (layer, point) => {
  if (layer.size_by === 'magnitude') return `M${point.magnitude.toFixed(1)}`
  if (layer.size_by === 'max_wind_kt') return `${point.max_wind_kt} kt${point.category ? ` · cat. ${point.category}` : ''}`
  return `severity ${point.severity?.toFixed(0)} · ${formatNumber(point.deaths)} deaths`
}

/**
 * The World Map's historical layer: past events for one decade, drawn as
 * hollow dashed rings so they are never mistaken for the live layer's filled
 * dots. Earthquakes and cyclones are exact positions (USGS, NOAA IBTrACS);
 * floods are one ring at each affected country's centre,
 * because EM-DAT via OWID has no event locations.
 */
export function HistoricalLayer() {
  const { theme } = useTheme()
  const [decade, setDecade] = useState(DECADE_DEFAULT)
  const [enabled, setEnabled] = useState(() => new Set(DISASTER_IDS))
  const { data, error, loading, reload } = useApi(
    () => api.historyMap({ decade }),
    [decade],
  )
  const decades = data?.decades ?? []

  const toggle = (id) =>
    setEnabled((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const markers = useMemo(() => {
    if (!data) return []
    return DISASTER_IDS.filter((id) => enabled.has(id)).flatMap((id) => {
      const layer = data.layers[id]
      const radius = RADIUS[layer.size_by]
      return layer.points.map((point) => ({
        id: `${id}:${point.id}`,
        latitude: point.latitude,
        longitude: point.longitude,
        radius: Math.max(2, radius(point.value)),
        color: disasterHex(id, theme),
        title: `${getDisasterType(id).shortLabel}, ${point.year}: ${point.title} (${measure(layer, point)})${layer.precision === 'country' ? ' · country centre' : ''}`,
      }))
    })
  }, [data, enabled, theme])

  const strongest = useMemo(() => {
    if (!data) return []
    return DISASTER_IDS.filter((id) => enabled.has(id)).flatMap((id) => {
      const layer = data.layers[id]
      return [...layer.points]
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .slice(0, STRONGEST_PER_TYPE)
        .map((point) => ({ ...point, type: id, key: `${id}:${point.id}`, measure: measure(layer, point), precision: layer.precision }))
    })
  }, [data, enabled])

  const index = decades.indexOf(decade)

  return (
    <div className="stack">
      <p className="callout callout-historical" role="status">
        <History size={16} aria-hidden="true" />
        <span>
          <strong>Historical view: {formatDecade(decade)}.</strong> These are past events, not current ones.
          Switch to “Live now” for what is happening today.
        </span>
      </p>

      <section className="card" aria-labelledby="hist-layers-title">
        <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="card-heading">
            <h2 className="card-title" id="hist-layers-title">
              Historical layers
            </h2>
            <p className="card-insight">
              Hollow dashed rings mark historical records. Earthquakes and cyclones sit at their exact
              positions; floods sit at the centre of each affected country
              (country-level data).
            </p>
          </div>
          <div className="card-badge">
            <SourceBadge source={['emdat', 'usgs', 'ibtracs']} />
          </div>
        </div>

        <div className="decade-control">
          <label htmlFor="decade-slider" className="field-label">
            Decade: <strong>{formatDecade(decade)}</strong>
          </label>
          <input
            id="decade-slider"
            type="range"
            min={0}
            max={Math.max(0, decades.length - 1)}
            step={1}
            value={Math.max(0, index)}
            disabled={!decades.length}
            onChange={(event) => setDecade(decades[Number(event.target.value)])}
            aria-valuetext={formatDecade(decade)}
          />
          <div className="decade-ticks" aria-hidden="true">
            <span>{formatDecade(decades[0])}</span>
            <span>{formatDecade(decades[decades.length - 1])}</span>
          </div>
        </div>

        <div className="layer-toggles" role="group" aria-label="Historical disaster layers">
          {DISASTER_TYPES.map((type) => {
            const layer = data?.layers?.[type.id]
            const Icon = type.icon
            const on = enabled.has(type.id)
            return (
              <button
                key={type.id}
                type="button"
                className={`layer-toggle layer-toggle-historical${on ? ' is-on' : ''}${layer && !layer.available ? ' is-down' : ''}`}
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
                    : !layer
                      ? '—'
                      : !layer.available
                        ? 'not covered'
                        : `${formatNumber(layer.count)} ${layer.precision === 'point' ? `events (${sourceName(layer.source.id)})` : 'countries'}`}
                </span>
              </button>
            )
          })}
        </div>

        {data && (
          <ul className="history-legend text-xs secondary">
            {DISASTER_IDS.filter((id) => data.layers[id]).map((id) => {
              const layer = data.layers[id]
              return (
                <li key={id}>
                  <strong>{getDisasterType(id).shortLabel}:</strong>{' '}
                  {layer.available
                    ? `${layer.precision === 'point' ? 'exact positions' : 'country centres'}, size = ${SIZE_WORDS[layer.size_by]} (${layer.source.name})`
                    : layer.reason}
                  {layer.unmapped?.length > 0 && ` · not mapped: ${layer.unmapped.join(', ')}`}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {error && <ErrorState message={error} onRetry={reload} />}

      <section className="map-layout" aria-label="Historical map and strongest events">
        <div className="card map-card">
          {loading && !data ? (
            <Skeleton height={520} />
          ) : (
            <HistoryMap
              points={markers}
              pointStyle="hollow"
              height="var(--map-height)"
              label={`Map of historical disaster records, ${formatDecade(decade)}`}
            />
          )}
        </div>
        <aside className="card map-panel" aria-labelledby="hist-list-title">
          <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="card-heading">
              <h2 className="card-title" id="hist-list-title">
                Strongest of the {formatDecade(decade)}
              </h2>
              <p className="card-insight">
                Up to {STRONGEST_PER_TYPE} per switched-on type, by magnitude, peak wind or Severity Index.
                {data && ` ${formatNumber(markers.length)} rings on the map.`}
              </p>
            </div>
          </div>
          {loading && <Skeleton height={300} />}
          {data && (
            <SortableTable
              caption={`Strongest historical records, ${formatDecade(decade)}`}
              maxHeight={460}
              rowKey={(row) => row.key}
              columns={[
                {
                  key: 'type',
                  label: 'Type',
                  render: (row) => (
                    <span className="type-cell" style={{ '--dt': disasterVar(row.type) }}>
                      {getDisasterType(row.type).shortLabel}
                    </span>
                  ),
                },
                {
                  key: 'title',
                  label: 'Where',
                  render: (row) => (
                    <>
                      {row.title}
                      <span className="text-xs muted"> · {row.year}</span>
                    </>
                  ),
                },
                { key: 'measure', label: 'Measure', sortValue: (row) => row.value },
              ]}
              rows={strongest}
            />
          )}
          {data && strongest.some((row) => row.precision === 'country') && (
            <p className="text-xs muted" style={{ marginTop: 'var(--space-2)' }}>
              Flood rows are country totals for the decade (EM-DAT via OWID), not
              single events; their rings sit at the country&apos;s centre.
            </p>
          )}
        </aside>
      </section>
    </div>
  )
}

export default HistoricalLayer
