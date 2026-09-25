/**
 * Pure helpers for live events: labels, severity classes, sorting, filtering
 * and the short text shown in the Live Events list, popups and tooltips.
 *
 * Every function only reads fields the backend actually sent. A missing value
 * (no magnitude, no wind, no storm name) is left out, never filled in.
 */
import { formatRelative } from './format'

/** Map-page labels per type, in legend order. */
export const MAP_TYPES = [
  { id: 'earthquake', label: 'Earthquake', legend: 'Earthquake', plural: 'Earthquakes' },
  { id: 'cyclone', label: 'Cyclone', legend: 'Cyclone / Hurricane', plural: 'Cyclones' },
  { id: 'flood', label: 'Flood', legend: 'Flood', plural: 'Floods' },
]
export const MAP_TYPE_IDS = MAP_TYPES.map((type) => type.id)
const TYPE_BY_ID = Object.fromEntries(MAP_TYPES.map((type) => [type.id, type]))
export const mapType = (id) => TYPE_BY_ID[id]

/** Severity classes set by the backend rule, lowest first. `size` is the marker diameter in px. */
export const SEVERITY_LEVELS = [
  { id: 'moderate', label: 'Moderate', rank: 1, size: 30 },
  { id: 'high', label: 'High', rank: 2, size: 38 },
  { id: 'very_high', label: 'Very High', rank: 3, size: 46 },
]
const SEVERITY_BY_ID = Object.fromEntries(SEVERITY_LEVELS.map((level) => [level.id, level]))
export const severityMeta = (id) => SEVERITY_BY_ID[id]

/** Filter value for events the rule does not rate (e.g. an EONET-only storm). */
export const UNRATED = 'unrated'
export const SEVERITY_FILTERS = [...SEVERITY_LEVELS.map((level) => level.id), UNRATED]

/** Shown when the API is older and sends no rule text; same wording as the backend. */
export const DEFAULT_SEVERITY_RULE =
  'GDACS alert Green = Moderate, Orange = High, Red = Very High. USGS earthquakes without a GDACS alert: M4.5-5.9 Moderate, M6.0-6.9 High, M7.0+ Very High. Events neither rule covers are not rated.'

/** Marker diameter: 30 / 38 / 46 px by severity; an unrated event uses the smallest. */
export const markerSize = (level) => severityMeta(level)?.size ?? SEVERITY_LEVELS[0].size

/** Northern-hemisphere cyclones turn counter-clockwise, southern ones clockwise. */
export const spinDirection = (latitude) => (latitude < 0 ? 'cw' : 'ccw')

/** When the event happened or was last reported (backend `time`, else the older fields). */
export const eventTime = (event) =>
  event.time ?? (event.type === 'earthquake' ? event.date : event.updated ?? event.date)

const titleCase = (text) => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text)

/** Bold first line of a list row: the place of a quake, the storm or flood name otherwise. */
export function eventHeadline(event) {
  if (event.type === 'earthquake') return event.place ?? event.location ?? event.title
  return event.title ?? event.place
}

/** Second line (country / region) when the source gives one that the headline lacks. */
export function eventSubline(event) {
  const headline = eventHeadline(event) ?? ''
  const region = event.type === 'earthquake' ? null : event.location
  if (!region) return null
  return headline.toLowerCase().includes(region.toLowerCase()) ? null : shortenList(region)
}

/** "Austria, Belgium, Belarus, …" -> "Austria, Belgium +23 more". */
function shortenList(text) {
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 3) return text
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`
}

/** The event's place, with long multi-country lists shortened. */
export const shortPlace = (event) => shortenList(event.location ?? event.title ?? '')

/** Short severity text (used by the per-disaster live cards). */
export const severityShort = (event) => {
  const parts = []
  if (event.magnitude != null && event.type === 'earthquake') parts.push(`M${event.magnitude.toFixed(1)}`)
  if (event.alert) parts.push(`${titleCase(event.alert)} alert`)
  if (!parts.length && event.severity?.label) parts.push(event.severity.label.split(' | ')[0])
  return parts.join(' · ') || '—'
}

/**
 * The facts after the time in a list row, only those that exist:
 * "M5.8", "Wind: 65 km/h", "Alert: Orange".
 */
export function eventFacts(event) {
  const facts = []
  if (event.type === 'earthquake' && event.magnitude != null) facts.push(`M${event.magnitude.toFixed(1)}`)
  if (event.wind_kmh != null) facts.push(`Wind: ${Math.round(event.wind_kmh)} km/h`)
  if (event.gdacs_alert) facts.push(`Alert: ${titleCase(event.gdacs_alert)}`)
  return facts
}

/** "2 h ago • M5.8 • Alert: Green" */
export const metaLine = (event, now = Date.now()) =>
  [formatRelative(eventTime(event), now), ...eventFacts(event)].join(' • ')

/** True when the point is inside the bounds, allowing for the map wrapping at ±180°. */
export function inBounds(bounds, event) {
  if (!bounds) return true
  return [0, 360, -360].some((shift) => bounds.contains([event.latitude, event.longitude + shift]))
}

/** Keep the events whose type and severity class are switched on. */
export function filterEvents(events, { types, severities }) {
  return events.filter(
    (event) => types.has(event.type) && severities.has(event.severity_level ?? UNRATED),
  )
}

export const SORTS = [
  { id: 'recent', label: 'Most recent' },
  { id: 'severity', label: 'Severity' },
  { id: 'magnitude', label: 'Magnitude' },
]

const timeValue = (event) => {
  const value = new Date(eventTime(event) ?? 0).getTime()
  return Number.isNaN(value) ? 0 : value
}
const severityRank = (event) => severityMeta(event.severity_level)?.rank ?? 0

/**
 * Sorted copy. Ties (and events without the sorted value, e.g. a flood when
 * sorting by magnitude) fall back to most recent first, and always sort last.
 */
export function sortEvents(events, sort) {
  const byTime = (a, b) => timeValue(b) - timeValue(a)
  const compare = {
    recent: byTime,
    severity: (a, b) => severityRank(b) - severityRank(a) || byTime(a, b),
    magnitude: (a, b) => {
      const am = a.type === 'earthquake' ? a.magnitude ?? null : null
      const bm = b.type === 'earthquake' ? b.magnitude ?? null : null
      if (am == null && bm == null) return byTime(a, b)
      if (am == null) return 1
      if (bm == null) return -1
      return bm - am || byTime(a, b)
    },
  }[sort] ?? byTime
  return [...events].sort(compare)
}

/** The type most events in a group share (ties: legend order). */
export function dominantType(types) {
  const counts = {}
  types.forEach((type) => {
    counts[type] = (counts[type] ?? 0) + 1
  })
  return MAP_TYPE_IDS.reduce(
    (best, id) => ((counts[id] ?? 0) > (counts[best] ?? 0) ? id : best),
    MAP_TYPE_IDS.find((id) => counts[id]) ?? MAP_TYPE_IDS[0],
  )
}

/** Screen-reader label for one marker or row. */
export function eventLabel(event) {
  const type = mapType(event.type)?.label ?? event.type
  const severity = severityMeta(event.severity_level)?.label
  return [type, eventHeadline(event), severity ? `${severity} severity` : 'not rated'].join(', ')
}
