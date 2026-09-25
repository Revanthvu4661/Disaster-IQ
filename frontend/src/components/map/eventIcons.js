/**
 * Marker, cluster and legend artwork for the live map.
 *
 * One inline SVG per disaster type, shared by the map markers (as
 * `L.divIcon` HTML), the legend and the Live Events list, so the same symbol
 * means the same thing everywhere. Animation is pure CSS (see worldmap.css)
 * and stops under `prefers-reduced-motion`.
 *
 * Icons are built once per type + severity (+ spin direction for cyclones)
 * and reused, so 150+ markers share a handful of icon objects.
 */
import L from 'leaflet'
import { dominantType, mapType, markerSize, severityMeta, spinDirection } from '../../lib/liveEvents'

/** Seismograph trace. */
const QUAKE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12h4l2-5 3 10 2.5-13 3 14 2-6h3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/** Hurricane swirl: three curved arms around an eye. */
const SWIRL_ARM = 'M0-2.6C5.2-3 8.6-6.2 8.4-10.6 11.6-5.2 9 0.8 2.6 2.2Z'
const CYCLONE_SVG = `<svg viewBox="-12 -12 24 24" aria-hidden="true" focusable="false"><g class="wm-swirl" fill="currentColor"><path d="${SWIRL_ARM}"/><path d="${SWIRL_ARM}" transform="rotate(120)"/><path d="${SWIRL_ARM}" transform="rotate(240)"/><circle r="3.4"/></g><circle r="1.6" class="wm-eye"/></svg>`

/** Three wave lines. */
const WAVE = 'q2.25-2.2 4.5 0t4.5 0 4.5 0 4.5 0'
const FLOOD_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7.5${WAVE}"/><path d="M3 12.5${WAVE}"/><path d="M3 17.5${WAVE}"/></g></svg>`

export const GLYPHS = { earthquake: QUAKE_SVG, cyclone: CYCLONE_SVG, flood: FLOOD_SVG }

/** Very High cyclones are drawn as a large translucent storm, as on a satellite image. */
export const BIG_STORM_SIZE = 90

/** Diameter of the marker for this event type and severity. */
export const iconSize = (type, level) =>
  type === 'cyclone' && level === 'very_high' ? BIG_STORM_SIZE : markerSize(level)

/**
 * The marker's HTML. Pulse rings (quake), ripples (flood) and the spinning
 * swirl (cyclone) are extra elements animated in CSS.
 */
export function markerHtml(type, level, spin = 'ccw') {
  const severity = severityMeta(level)?.label ?? 'Not rated'
  const label = `${mapType(type)?.label ?? type}, ${severity}`
  const rings =
    type === 'earthquake'
      ? '<span class="wm-ring"></span><span class="wm-ring wm-ring-2"></span>'
      : type === 'flood'
        ? '<span class="wm-ripple"></span>'
        : '<span class="wm-halo"></span>'
  return `<span class="wm-marker wm-${type} wm-sev-${level ?? 'unrated'} wm-spin-${spin}" role="img" aria-label="${label}">${rings}<span class="wm-core">${GLYPHS[type] ?? ''}</span></span>`
}

const iconCache = new Map()

/** Cached `L.divIcon` for a type, severity and (cyclones only) spin direction. */
export function eventIcon(type, level, latitude = 0) {
  const spin = type === 'cyclone' ? spinDirection(latitude) : 'ccw'
  const key = `${type}|${level ?? 'unrated'}|${spin}`
  let icon = iconCache.get(key)
  if (!icon) {
    const size = iconSize(type, level)
    icon = L.divIcon({
      html: markerHtml(type, level, spin),
      className: 'wm-icon',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      tooltipAnchor: [0, -size / 2],
      popupAnchor: [0, -size / 2],
    })
    iconCache.set(key, icon)
  }
  return icon
}

/** Number of cached icons (tests check that icons are reused). */
export const iconCacheSize = () => iconCache.size

/**
 * Cluster bubble: dark centre, white count, glowing ring in the colour of the
 * most common type inside. The label names the count and that type.
 */
export function clusterIcon(cluster) {
  const types = cluster.getAllChildMarkers().map((marker) => marker.options.eventType)
  const dominant = dominantType(types)
  const count = cluster.getChildCount()
  const size = count < 10 ? 38 : count < 50 ? 46 : 54
  const noun = mapType(dominant)?.plural.toLowerCase() ?? 'events'
  return L.divIcon({
    html: `<span class="wm-cluster wm-cluster-${dominant}" role="img" aria-label="${count} events here, mostly ${noun}. Zoom in to see them.">${count}</span>`,
    className: 'wm-cluster-icon',
    iconSize: L.point(size, size),
  })
}
