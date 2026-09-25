import { memo, useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Popup, Tooltip, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet/dist/leaflet.css'
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css'
import { DISASTER_TYPES, disasterHex, getDisasterType } from '../../config/disasterTypes'
import { useTheme } from '../../context/ThemeContext'
import { formatDateTime, formatRelative } from '../../lib/format'
import BaseTiles, { MAX_ZOOM } from '../map/BaseTiles'
import { BoundsWatcher, MAP_LIMITS, SizeWatcher } from '../map/mapBehaviour'

const WORLD_CENTER = [18, 12]

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Fixed pixel radius, 6–10 px by alert level; it does not grow with zoom. */
const markerRadius = (event) => 6 + Math.min(4, event.severity?.rank ?? 0)

/**
 * Cluster bubble: the count on the app surface, ringed in the colour of the
 * most common disaster type inside it. The colour is a CSS variable, so it
 * follows theme changes without rebuilding the clusters.
 */
function clusterIcon(cluster) {
  const counts = {}
  cluster.getAllChildMarkers().forEach((marker) => {
    const type = marker.options.eventType
    counts[type] = (counts[type] ?? 0) + 1
  })
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
  const count = cluster.getChildCount()
  const size = count < 10 ? 32 : count < 50 ? 38 : 44
  return L.divIcon({
    html: `<span style="--ring: var(--dt-${dominant}, var(--accent))">${count}</span>`,
    className: 'event-cluster',
    iconSize: L.point(size, size),
  })
}

/** Frames the given events once per `fitKey`, or the whole world when there are none. */
function FitToEvents({ events, fitKey }) {
  const map = useMap()
  const key = fitKey ?? events.map((event) => event.id).join('|')
  useEffect(() => {
    const points = events.map((event) => [event.latitude, event.longitude])
    if (points.length === 0) {
      map.setView(WORLD_CENTER, MAP_LIMITS.minZoom)
    } else if (points.length === 1) {
      map.setView(points[0], 4)
    } else {
      map.fitBounds(points, { padding: [28, 28], maxZoom: 5 })
    }
    // Refit only when the set of events changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/**
 * Flies to an event chosen outside the map (a list row), then makes sure it is
 * not hidden inside a cluster: a cluster still holding it is spiderfied, and
 * the event's popup opens.
 */
function FocusOn({ focus, clusterRef, markerRefs }) {
  const map = useMap()
  useEffect(() => {
    if (!focus) return undefined
    const target = [focus.latitude, focus.longitude]
    const zoom = Math.max(map.getZoom(), 6)
    const reveal = () => {
      const layer = markerRefs.current.get(focus.id)
      const group = clusterRef.current
      if (!layer || !group) return
      const parent = group.getVisibleParent(layer)
      if (parent && parent !== layer && typeof parent.spiderfy === 'function') parent.spiderfy()
      layer.openPopup()
    }
    map.once('moveend', reveal)
    if (prefersReducedMotion()) map.setView(target, zoom)
    else map.flyTo(target, zoom, { duration: 0.6 })
    return () => map.off('moveend', reveal)
  }, [map, focus, clusterRef, markerRefs])
  return null
}

function EventPopup({ event }) {
  const type = getDisasterType(event.type)
  return (
    <div className="event-popup">
      <p className="event-popup-type">{type?.label}</p>
      <p className="event-popup-place">{event.location ?? event.title}</p>
      <dl>
        <div>
          <dt>Alert</dt>
          <dd>{event.alert ? `${event.alert[0].toUpperCase()}${event.alert.slice(1)}` : 'None issued'}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd title={formatDateTime(event.updated ?? event.date)}>{formatRelative(event.updated ?? event.date)}</dd>
        </div>
        {event.kind === 'modelled' && (
          <div>
            <dt>Kind</dt>
            <dd>Modelled estimate</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

/** Type colours and the cluster symbol, drawn over the map. */
export function MapLegend({ types = DISASTER_TYPES }) {
  return (
    <div className="map-overlay-legend" aria-label="Map legend">
      <ul>
        {types.map((type) => (
          <li key={type.id}>
            <span className="map-legend-dot" style={{ background: `var(--dt-${type.id})` }} aria-hidden="true" />
            {type.shortLabel}
          </li>
        ))}
        <li>
          <span className="map-legend-cluster" aria-hidden="true">
            n
          </span>
          Cluster
        </li>
      </ul>
    </div>
  )
}

/** The markers, memoised so panning (which re-renders the page via bounds) does not rebuild them. */
const EventMarkers = memo(function EventMarkers({ events, selectedId, onSelect, theme, markerRefs }) {
  return events.map((event) => {
    const color = disasterHex(event.type, theme)
    const selected = event.id === selectedId
    const radius = markerRadius(event)
    return (
      <CircleMarker
        key={event.id}
        ref={(layer) => {
          if (layer) markerRefs.current.set(event.id, layer)
          else markerRefs.current.delete(event.id)
        }}
        center={[event.latitude, event.longitude]}
        radius={radius}
        eventType={event.type}
        pathOptions={{
          color: selected ? (theme === 'dark' ? '#ffffff' : '#11151c') : color,
          weight: selected ? 3 : 1.5,
          fillColor: color,
          fillOpacity: 0.8,
        }}
        eventHandlers={{ click: () => onSelect?.(event) }}
      >
        <Tooltip direction="top" offset={[0, -radius]}>
          {getDisasterType(event.type)?.label}: {event.location ?? event.title}
        </Tooltip>
        <Popup>
          <EventPopup event={event} />
        </Popup>
      </CircleMarker>
    )
  })
})

/**
 * Leaflet map of live events, coloured by the shared disaster palette.
 *
 * Events are filled circles. Nearby events cluster at low zoom and separate as
 * you zoom in. Tiles follow the app theme; panning is limited to one world
 * copy. Every marker also exists as a row in the accompanying table, which is
 * the keyboard path.
 */
export function LiveEventMap({
  events,
  selectedId,
  onSelect,
  onBoundsChange,
  focus,
  fit = false,
  fitKey,
  height = 460,
  label = 'Map of current disaster events',
}) {
  const { theme } = useTheme()
  const clusterRef = useRef(null)
  const markerRefs = useRef(new Map())
  const presentTypes = useMemo(() => {
    const ids = new Set(events.map((event) => event.type))
    return DISASTER_TYPES.filter((type) => ids.has(type.id))
  }, [events])

  return (
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
        {onBoundsChange && <BoundsWatcher onChange={onBoundsChange} />}
        {fit && <FitToEvents events={events} fitKey={fitKey} />}
        <FocusOn focus={focus} clusterRef={clusterRef} markerRefs={markerRefs} />
        <MarkerClusterGroup
          ref={clusterRef}
          chunkedLoading
          maxClusterRadius={44}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          iconCreateFunction={clusterIcon}
        >
          <EventMarkers
            events={events}
            selectedId={selectedId}
            onSelect={onSelect}
            theme={theme}
            markerRefs={markerRefs}
          />
        </MarkerClusterGroup>
      </MapContainer>
      {presentTypes.length > 0 && (
        <MapLegend types={presentTypes} />
      )}
    </div>
  )
}

export default LiveEventMap
