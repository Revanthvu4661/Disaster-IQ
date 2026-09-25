import { useEffect, useState } from 'react'
import { GeoJSON, MapContainer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../../context/ThemeContext'
import BaseTiles from '../map/BaseTiles'
import { SizeWatcher } from '../map/mapBehaviour'
import { RISK_LEVELS, formatProbability, levelHex, levelLabel, levelVar } from '../../lib/risk'

/** Map extents per region set: the Kerala districts and the states of India. */
export const MAP_AREAS = {
  kerala: {
    url: 'geo/kerala-districts.json',
    nameKey: 'district',
    bounds: [[8.17, 74.85], [12.8, 77.42]],
    limits: [[6.5, 73], [14.5, 79.5]],
    minZoom: 6,
    label: 'districts of Kerala',
  },
  india: {
    url: 'geo/india-states.json',
    nameKey: 'region',
    bounds: [[6.5, 68], [37.5, 97.5]],
    limits: [[-2, 55], [42, 108]],
    minZoom: 4,
    label: 'states of India',
  },
}

const cache = new Map()
/** Region polygons written by the data pipelines (geoBoundaries); fetched once per session. */
function loadShapes(url) {
  if (!cache.has(url)) {
    const promise = fetch(`${import.meta.env.BASE_URL}${url}`).then((response) => {
      if (!response.ok) throw new Error('Region shapes could not be loaded')
      return response.json()
    })
    promise.catch(() => cache.delete(url))
    cache.set(url, promise)
  }
  return cache.get(url)
}

const nameOf = (row) => row.district ?? row.region

/**
 * Regions filled by predicted risk level (Kerala districts for floods, Indian
 * states for earthquakes and cyclones). Clicking a region selects it. Colour is
 * never the only cue: each tooltip names the level and probability, and the
 * table beside the map lists every region.
 */
export function RiskMap({ area = 'kerala', rows, selected, onSelect, height = 460, label, probabilityWord = '' }) {
  const { theme } = useTheme()
  const config = MAP_AREAS[area]
  const [shapes, setShapes] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadShapes(config.url)
      .then((geo) => !cancelled && setShapes(geo))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [config.url])

  const byName = Object.fromEntries(rows.map((row) => [nameOf(row), row]))
  const border = theme === 'dark' ? '#e5e7eb' : '#1f2937'

  const style = (feature) => {
    const name = feature.properties[config.nameKey]
    const row = byName[name]
    const isSelected = name === selected
    return {
      color: isSelected ? border : theme === 'dark' ? '#0b0b10' : '#ffffff',
      weight: isSelected ? 3 : 1,
      opacity: 1,
      fillColor: row ? levelHex(row.level, theme) : '#64748b',
      fillOpacity: isSelected ? 0.8 : 0.62,
    }
  }

  const onEachFeature = (feature, layer) => {
    const name = feature.properties[config.nameKey]
    const row = byName[name]
    layer.bindTooltip(
      row ? `${name}: ${levelLabel(row.level)} (${formatProbability(row.probability)}${probabilityWord})` : name,
      { sticky: true, direction: 'top' },
    )
    layer.on('click', () => onSelect?.(name))
  }

  // Remount the layer when the data, selection or theme changes so styles refresh.
  const layerKey = `${area}-${theme}-${selected}-${rows.map((row) => `${nameOf(row)}:${row.level}`).join('|')}`

  return (
    <div className="history-map">
      <div className="map-shell" style={{ height }} role="region" aria-label={label}>
        <MapContainer
          key={area}
          bounds={config.bounds}
          minZoom={config.minZoom}
          maxZoom={12}
          maxBounds={config.limits}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <BaseTiles />
          <SizeWatcher />
          {shapes && <GeoJSON key={layerKey} data={shapes} style={style} onEachFeature={onEachFeature} />}
        </MapContainer>
      </div>
      <div className="map-legend">
        <span className="field-label">Predicted risk level</span>
        {error && <span className="text-xs muted">{error}</span>}
        <ul className="legend-scale">
          {[...RISK_LEVELS].reverse().map((band) => (
            <li key={band.level}>
              <span className="legend-scale-swatch" style={{ background: levelVar(band.level) }} aria-hidden="true" />
              <span className="text-xs">{band.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default RiskMap
