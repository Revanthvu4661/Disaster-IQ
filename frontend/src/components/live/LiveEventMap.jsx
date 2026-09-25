import { memo, useEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Pane, Polyline, Popup, ScaleControl, TileLayer, Tooltip, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet/dist/leaflet.css'
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { formatDateTime, formatRelative } from '../../lib/format'
import {
  DEFAULT_SEVERITY_RULE,
  eventHeadline,
  eventLabel,
  eventSubline,
  eventTime,
  mapType,
} from '../../lib/liveEvents'
import { MAX_ZOOM, worldBasemap } from '../map/BaseTiles'
import { BoundsWatcher, MAP_LIMITS, SizeWatcher } from '../map/mapBehaviour'
import { clusterIcon, eventIcon } from '../map/eventIcons'
import { GeoLabels, LayersMenu, MapLegend, PlateBoundaries, ZoomLocateControls } from '../map/worldOverlays'
import { SeverityPill, TypeIcon } from './parts'

const WORLD_CENTER = [20, 10]
/** Clusters split into single markers from this zoom. */
export const CLUSTER_OFF_ZOOM = 5
const CYCLONE_HEX = '#60a5fa'
/** Borders and place names (Esri reference layer) start at this zoom. */
const REFERENCE_MIN_ZOOM = 3

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Smallest zoom (in quarter steps, never below `floor`) at which one world copy fills `width` px. */
export function fillZoom(width, floor = MAP_LIMITS.minZoom) {
  if (!width) return floor
  return Math.max(floor, Math.ceil(Math.log2(width / 256) * 4) / 4)
}

/**
 * One copy of the world, edge to edge: on a wide map the minimum zoom rises
 * just enough that no empty band shows beside the world.
 */
function FillWorldWidth() {
  const map = useMap()
  useEffect(() => {
    const apply = () => {
      const min = fillZoom(map.getSize().x)
      map.setMinZoom(min)
      if (map.getZoom() < min) map.setZoom(min, { animate: false })
    }
    apply()
    map.on('resize', apply)
    return () => map.off('resize', apply)
  }, [map])
  return null
}

/** Frames the events once per `fitKey`, or the whole world when there are none. */
function FitToEvents({ events, fitKey }) {
  const map = useMap()
  useEffect(() => {
    const points = events.map((event) => [event.latitude, event.longitude])
    if (points.length === 0) map.setView(WORLD_CENTER, MAP_LIMITS.minZoom)
    else if (points.length === 1) map.setView(points[0], 4)
    else map.fitBounds(points, { padding: [28, 28], maxZoom: 4 })
    // Refit only when the data is reloaded, not on filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey])
  return null
}

/**
 * Flies to an event chosen in the list, then lets the cluster layer reveal
 * the marker (zoom or spiderfy) and opens its popup.
 */
function FocusOn({ focus, clusterRef, markerRefs }) {
  const map = useMap()
  useEffect(() => {
    if (!focus) return undefined
    const target = [focus.latitude, focus.longitude]
    const zoom = Math.max(map.getZoom(), CLUSTER_OFF_ZOOM + 1)
    let cancelled = false
    const reveal = () => {
      const layer = markerRefs.current.get(focus.id)
      const group = clusterRef.current
      if (cancelled || !layer) return
      if (group?.hasLayer(layer)) group.zoomToShowLayer(layer, () => !cancelled && layer.openPopup())
      else layer.openPopup()
    }
    map.once('moveend', reveal)
    if (prefersReducedMotion()) map.setView(target, zoom)
    else map.flyTo(target, zoom, { duration: 0.7 })
    return () => {
      cancelled = true
      map.off('moveend', reveal)
    }
  }, [map, focus, clusterRef, markerRefs])
  return null
}

/**
 * Adds `is-hot` (list row hovered) and `is-selected` classes to the marker,
 * or to the cluster that currently holds it, without rebuilding any icon.
 */
function MarkerHighlight({ id, className, clusterRef, markerRefs }) {
  const map = useMap()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    // Clusters are rebuilt after zooming and panning; re-apply the class then.
    const bump = () => setTick((value) => value + 1)
    const group = clusterRef.current
    map.on('moveend', bump)
    group?.on('animationend', bump)
    return () => {
      map.off('moveend', bump)
      group?.off('animationend', bump)
    }
  }, [map, clusterRef])
  useEffect(() => {
    if (!id) return undefined
    const layer = markerRefs.current.get(id)
    if (!layer) return undefined
    const group = clusterRef.current
    const shown = group?.getVisibleParent?.(layer) ?? layer
    const element = shown?.getElement?.()
    if (!element) return undefined
    element.classList.add(className)
    return () => element.classList.remove(className)
  }, [id, className, clusterRef, markerRefs, tick])
  return null
}

/** One line of tooltip text: only the fields the source gave. */
export function tooltipText(event) {
  const parts = []
  if (event.type === 'earthquake') {
    parts.push(event.place ?? event.title)
    if (event.magnitude != null) parts.push(`M${event.magnitude.toFixed(1)}`)
    parts.push(formatRelative(eventTime(event)))
  } else if (event.type === 'cyclone') {
    parts.push(event.storm_name ?? event.title)
    if (event.wind_kmh != null) parts.push(`${Math.round(event.wind_kmh)} km/h`)
    if (event.gdacs_alert) parts.push(`${event.gdacs_alert[0].toUpperCase()}${event.gdacs_alert.slice(1)} alert`)
  } else {
    parts.push(event.title)
    if (event.gdacs_alert) parts.push(`${event.gdacs_alert[0].toUpperCase()}${event.gdacs_alert.slice(1)} alert`)
    parts.push(formatRelative(eventTime(event)))
  }
  return parts.filter(Boolean).join(' · ')
}

const capital = (text) => `${text[0].toUpperCase()}${text.slice(1)}`

/** Dark popup card: type, place, time, the readings that exist, severity and sources. */
export function EventPopup({ event, rule }) {
  const type = mapType(event.type)
  const headline = eventHeadline(event)
  const subline = eventSubline(event)
  const when = eventTime(event)
  const storm =
    event.storm_name && !headline?.toLowerCase().includes(event.storm_name.toLowerCase()) ? event.storm_name : null
  const rows = [
    event.type === 'earthquake' && event.magnitude != null && ['Magnitude', `M${event.magnitude.toFixed(1)}`],
    storm && ['Storm', storm],
    event.wind_kmh != null && ['Wind', `${Math.round(event.wind_kmh)} km/h`],
    event.gdacs_alert && ['GDACS alert', capital(event.gdacs_alert)],
  ].filter(Boolean)
  const track = event.track
  return (
    <div className="wm-popup-card">
      <div className="wm-popup-top">
        <TypeIcon type={event.type} size={34} decorative />
        <div>
          <p className={`wm-type-label wm-text-${event.type}`}>{type?.label}</p>
          <p className="wm-popup-place">{headline}</p>
          {subline && <p className="wm-popup-sub">{subline}</p>}
        </div>
      </div>
      <p className="wm-popup-time">
        <time dateTime={when} title={formatDateTime(when)}>
          {formatRelative(when)}
        </time>
        <span className="visually-hidden"> ({formatDateTime(when)})</span>
      </p>
      {rows.length > 0 && (
        <dl className="wm-popup-facts">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="wm-popup-sev">
        <span className="wm-popup-sev-label">Severity</span>
        <SeverityPill event={event} rule={rule} />
      </div>
      {event.disagreement && (
        <p className="wm-popup-note" role="note">
          <AlertTriangle size={13} aria-hidden="true" />
          Sources disagree: {event.disagreement}.
        </p>
      )}
      {track && (
        <p className="wm-popup-track">
          Dotted line: {track.observed?.length ? 'observed track' : ''}
          {track.observed?.length && track.forecast?.length ? ' and ' : ''}
          {track.forecast?.length ? 'forecast path (fainter)' : ''} from {track.source}.
        </p>
      )}
      <p className="wm-popup-sources">
        <span>{event.sources.length > 1 ? `${event.sources.length} sources:` : 'Source:'}</span>
        {event.sources.map((source) =>
          source.url ? (
            <a key={`${source.source}:${source.source_id}`} href={source.url} target="_blank" rel="noreferrer noopener">
              {source.source_name}
              <ExternalLink size={11} aria-hidden="true" />
              <span className="visually-hidden"> report (opens in a new tab)</span>
            </a>
          ) : (
            <span key={`${source.source}:${source.source_id}`}>{source.source_name}</span>
          ),
        )}
      </p>
    </div>
  )
}

/** Markers, memoised on the event list so panning and hovering never rebuild them. */
const EventMarkers = memo(function EventMarkers({ events, onSelect, markerRefs, rule }) {
  return events.map((event) => (
    <Marker
      key={event.id}
      ref={(layer) => {
        if (layer) markerRefs.current.set(event.id, layer)
        else markerRefs.current.delete(event.id)
      }}
      position={[event.latitude, event.longitude]}
      icon={eventIcon(event.type, event.severity_level, event.latitude)}
      eventType={event.type}
      keyboard={false}
      riseOnHover
      eventHandlers={{
        click: () => onSelect?.(event),
        add: (leafletEvent) => leafletEvent.target.getElement()?.firstElementChild?.setAttribute('aria-label', eventLabel(event)),
      }}
    >
      <Tooltip direction="top" className="wm-tooltip">
        {tooltipText(event)}
      </Tooltip>
      <Popup className="wm-popup" maxWidth={300} minWidth={240}>
        <EventPopup event={event} rule={rule} />
      </Popup>
    </Marker>
  ))
})

/** Observed tracks (dotted) and forecast paths (fainter dots) for cyclones that have them. */
const CycloneTracks = memo(function CycloneTracks({ events }) {
  const tracks = events.filter((event) => event.type === 'cyclone' && event.track)
  if (tracks.length === 0) return null
  return (
    <Pane name="wm-tracks" style={{ zIndex: 410 }}>
      {tracks.flatMap((event) => [
        event.track.observed?.length > 1 && (
          <Polyline
            key={`${event.id}:observed`}
            positions={event.track.observed}
            pathOptions={{ color: CYCLONE_HEX, weight: 2.5, opacity: 0.9, dashArray: '1 7', lineCap: 'round', interactive: false }}
          />
        ),
        event.track.forecast?.length > 1 && (
          <Polyline
            key={`${event.id}:forecast`}
            positions={event.track.forecast}
            pathOptions={{ color: CYCLONE_HEX, weight: 2, opacity: 0.55, dashArray: '1 9', lineCap: 'round', interactive: false }}
          />
        ),
      ].filter(Boolean))}
    </Pane>
  )
})

/** Imagery (or the dark canvas) plus the borders-and-places reference layer. */
function Basemap({ basemap, labels }) {
  const config = worldBasemap(basemap)
  return (
    <>
      <TileLayer
        key={`base-${basemap}`}
        url={config.base.url}
        attribution={config.base.attribution}
        maxZoom={MAX_ZOOM}
        maxNativeZoom={config.base.maxNativeZoom}
        noWrap
        bounds={MAP_LIMITS.maxBounds}
        className={basemap === 'satellite' ? 'wm-imagery' : undefined}
      />
      {labels && (
        <Pane name="wm-reference" style={{ zIndex: 340 }}>
          <TileLayer
            key={`labels-${basemap}`}
            url={config.labels.url}
            // Below zoom 3 the continent and ocean names come from GeoLabels;
            // Esri's own low-zoom names would print them twice.
            minZoom={REFERENCE_MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            maxNativeZoom={config.labels.maxNativeZoom}
            noWrap
            bounds={MAP_LIMITS.maxBounds}
          />
        </Pane>
      )}
    </>
  )
}

export const DEFAULT_MAP_SETTINGS = { basemap: 'satellite', plates: true, labels: true }

/**
 * Live World Map: satellite basemap, animated markers by type and severity,
 * clusters that split at zoom 5, plate boundaries, cyclone tracks, and the
 * zoom / locate / legend / layers controls.
 *
 * Markers are not in the tab order: the Live Events list next to the map is
 * the keyboard path to every event (a row opens the same popup).
 */
export function LiveEventMap({
  events,
  selectedId,
  hoverId,
  onSelect,
  onBoundsChange,
  focus,
  fitKey,
  settings = DEFAULT_MAP_SETTINGS,
  onSettingsChange,
  types,
  onToggleType,
  typeNotes,
  rule = DEFAULT_SEVERITY_RULE,
  label = 'Map of current disaster events',
}) {
  const [map, setMap] = useState(null)
  const [me, setMe] = useState(null)
  const clusterRef = useRef(null)
  const markerRefs = useRef(new Map())

  return (
    <div className="wm-map-shell" role="region" aria-label={label}>
      <MapContainer
        ref={setMap}
        center={WORLD_CENTER}
        zoom={MAP_LIMITS.minZoom}
        minZoom={MAP_LIMITS.minZoom}
        maxZoom={MAX_ZOOM}
        maxBounds={MAP_LIMITS.maxBounds}
        maxBoundsViscosity={MAP_LIMITS.maxBoundsViscosity}
        worldCopyJump={false}
        zoomControl={false}
        zoomSnap={0.25}
        scrollWheelZoom
        className="wm-leaflet"
        style={{ height: '100%', width: '100%' }}
      >
        <Basemap basemap={settings.basemap} labels={settings.labels} />
        {settings.plates && <PlateBoundaries />}
        {settings.labels && <GeoLabels />}
        <ScaleControl position="bottomleft" imperial={false} />
        <SizeWatcher />
        <FillWorldWidth />
        {onBoundsChange && <BoundsWatcher onChange={onBoundsChange} />}
        <FitToEvents events={events} fitKey={fitKey} />
        <FocusOn focus={focus} clusterRef={clusterRef} markerRefs={markerRefs} />
        <CycloneTracks events={events} />
        <MarkerClusterGroup
          ref={clusterRef}
          chunkedLoading
          maxClusterRadius={48}
          disableClusteringAtZoom={CLUSTER_OFF_ZOOM}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          zoomToBoundsOnClick
          iconCreateFunction={clusterIcon}
        >
          <EventMarkers events={events} onSelect={onSelect} markerRefs={markerRefs} rule={rule} />
        </MarkerClusterGroup>
        <MarkerHighlight id={hoverId} className="is-hot" clusterRef={clusterRef} markerRefs={markerRefs} />
        <MarkerHighlight id={selectedId} className="is-selected" clusterRef={clusterRef} markerRefs={markerRefs} />
        {me && (
          <CircleMarker
            center={me}
            radius={7}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#22d3ee', fillOpacity: 1 }}
            interactive={false}
          />
        )}
      </MapContainer>
      <div className="wm-vignette" aria-hidden="true" />
      <ZoomLocateControls map={map} onLocated={setMe} />
      <MapLegend />
      {onSettingsChange && (
        <LayersMenu
          settings={settings}
          onChange={(patch) => onSettingsChange({ ...settings, ...patch })}
          types={types}
          onToggleType={onToggleType}
          typeNotes={typeNotes}
        />
      )}
    </div>
  )
}

export default LiveEventMap
