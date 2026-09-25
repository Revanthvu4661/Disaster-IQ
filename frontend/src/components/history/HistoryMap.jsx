import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../../context/ThemeContext'
import BaseTiles, { MAX_ZOOM } from '../map/BaseTiles'
import { MAP_LIMITS, SizeWatcher } from '../map/mapBehaviour'

const WORLD_CENTER = [20, 10]
const BINS = 5
const OPACITY = [0.14, 0.3, 0.46, 0.64, 0.82]

let geoPromise = null
/** Natural Earth 110 m shapes, written by the data pipeline; fetched once per session. */
export function loadCountryShapes() {
  if (!geoPromise) {
    geoPromise = fetch(`${import.meta.env.BASE_URL}geo/countries-110m.json`).then((response) => {
      if (!response.ok) throw new Error('Country shapes could not be loaded')
      return response.json()
    })
    geoPromise.catch(() => {
      geoPromise = null
    })
  }
  return geoPromise
}

/**
 * Log-spaced bin edges between the smallest and largest positive value. Disaster
 * impact spans several orders of magnitude, so equal-width bins would put
 * almost every country in the lowest one.
 */
export function logBins(values, bins = BINS) {
  const positive = values.filter((value) => value > 0)
  if (!positive.length) return []
  const low = Math.log10(Math.min(...positive))
  const high = Math.log10(Math.max(...positive))
  const step = (high - low) / bins || 1
  return Array.from({ length: bins - 1 }, (_, index) => 10 ** (low + step * (index + 1)))
}

const binOf = (value, edges) => {
  let index = 0
  while (index < edges.length && value >= edges[index]) index += 1
  return index
}

/**
 * Leaflet map of historical impact: an optional country choropleth (one hue,
 * opacity steps on a log scale) and optional point markers. `color` must be a
 * hex value (canvas rendering cannot resolve CSS variables). Countries without a
 * record stay unfilled, never shaded as zero. The legend is HTML beside the
 * map; the accompanying data table is the keyboard path.
 */
export function HistoryMap({
  choropleth,
  points = [],
  color,
  height = 420,
  label,
  pointStyle = 'filled',
}) {
  const { theme } = useTheme()
  const border = theme === 'dark' ? '#5b6170' : '#9aa1ab'
  const [shapes, setShapes] = useState(null)
  const [shapeError, setShapeError] = useState(null)

  useEffect(() => {
    if (!choropleth) return undefined
    let cancelled = false
    loadCountryShapes()
      .then((geo) => !cancelled && setShapes(geo))
      .catch((error) => !cancelled && setShapeError(error.message))
    return () => {
      cancelled = true
    }
  }, [choropleth])

  const edges = useMemo(
    () => (choropleth ? logBins(Object.values(choropleth.values)) : []),
    [choropleth],
  )

  const style = (feature) => {
    const value = choropleth?.values[feature.properties.iso3]
    const has = value > 0
    return {
      color: border,
      weight: 0.6,
      opacity: 0.6,
      fillColor: color,
      fillOpacity: has ? OPACITY[binOf(value, edges)] : 0,
    }
  }

  const onEachFeature = (feature, layer) => {
    const value = choropleth?.values[feature.properties.iso3]
    layer.bindTooltip(
      `${feature.properties.name}: ${value > 0 ? choropleth.format(value) : 'no record'}`,
      { sticky: true, direction: 'top' },
    )
  }

  const hollow = pointStyle === 'hollow'

  return (
    <div className="history-map">
      <div className="map-shell" style={{ height }} role="region" aria-label={label}>
        <MapContainer
          center={WORLD_CENTER}
          zoom={MAP_LIMITS.minZoom}
          minZoom={MAP_LIMITS.minZoom}
          maxZoom={MAX_ZOOM}
          maxBounds={MAP_LIMITS.maxBounds}
          maxBoundsViscosity={MAP_LIMITS.maxBoundsViscosity}
          preferCanvas
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <BaseTiles />
          <SizeWatcher />
          {choropleth && shapes && (
            <GeoJSON
              key={`${choropleth.key}-${color}-${theme}`}
              data={shapes}
              style={style}
              onEachFeature={onEachFeature}
            />
          )}
          {points.map((point) => (
            <CircleMarker
              key={point.id}
              center={[point.latitude, point.longitude]}
              radius={point.radius}
              pathOptions={{
                color: point.color ?? color,
                weight: hollow ? 1.6 : 1,
                fillColor: point.color ?? color,
                fillOpacity: hollow ? 0.08 : 0.55,
                dashArray: hollow ? '4 3' : undefined,
              }}
            >
              <Tooltip direction="top">{point.title}</Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      {choropleth && (
        <div className="map-legend" aria-hidden={edges.length === 0}>
          <span className="field-label">{choropleth.label}</span>
          {shapeError && <span className="text-xs muted">{shapeError}</span>}
          {edges.length > 0 && (
            <ul className="legend-scale">
              {OPACITY.map((opacity, index) => (
                <li key={opacity}>
                  <span
                    className="legend-scale-swatch"
                    style={{ background: color, opacity }}
                    aria-hidden="true"
                  />
                  <span className="text-xs">
                    {index === 0 ? '<' : '≥'} {choropleth.format(index === 0 ? edges[0] : edges[index - 1])}
                  </span>
                </li>
              ))}
              <li>
                <span className="legend-scale-swatch legend-scale-empty" aria-hidden="true" />
                <span className="text-xs">no record</span>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default HistoryMap
