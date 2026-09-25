import { describe, expect, it } from 'vitest'
import L from 'leaflet'
import {
  SEVERITY_FILTERS,
  UNRATED,
  dominantType,
  eventFacts,
  eventHeadline,
  eventLabel,
  eventSubline,
  filterEvents,
  inBounds,
  markerSize,
  metaLine,
  shortPlace,
  sortEvents,
  spinDirection,
} from './liveEvents'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const hoursAgo = (hours) => new Date(NOW - hours * 3600_000).toISOString()

const quake = (id, magnitude, hours, extra = {}) => ({
  id,
  type: 'earthquake',
  title: `M ${magnitude} - ${id}`,
  place: `10 km N of ${id}`,
  latitude: 0,
  longitude: 0,
  magnitude,
  time: hoursAgo(hours),
  sources: [{}],
  ...extra,
})

describe('severity helpers', () => {
  it('sizes markers 30 / 38 / 46 px by severity', () => {
    expect(markerSize('moderate')).toBe(30)
    expect(markerSize('high')).toBe(38)
    expect(markerSize('very_high')).toBe(46)
    expect(markerSize(null)).toBe(30)
  })

  it('spins cyclones counter-clockwise in the north and clockwise in the south', () => {
    expect(spinDirection(15.4)).toBe('ccw')
    expect(spinDirection(0)).toBe('ccw')
    expect(spinDirection(-18)).toBe('cw')
  })
})

describe('row text uses only the fields a source gave', () => {
  it('shows magnitude for a quake and nothing invented', () => {
    const event = quake('Kainantu', 5.8, 2)
    expect(metaLine(event, NOW)).toBe('2 h ago • M5.8')
    expect(eventFacts(event)).toEqual(['M5.8'])
  })

  it('shows wind and GDACS alert for a cyclone only when present', () => {
    const storm = { type: 'cyclone', title: 'Tropical Cyclone POLO-26', location: 'Mexico', time: hoursAgo(1), wind_kmh: 287, gdacs_alert: 'orange' }
    expect(eventFacts(storm)).toEqual(['Wind: 287 km/h', 'Alert: Orange'])
    expect(eventFacts({ type: 'cyclone', title: 'Hurricane Polo' })).toEqual([])
  })

  it('never shows a magnitude for a flood or storm', () => {
    expect(eventFacts({ type: 'flood', magnitude: 3, gdacs_alert: 'green' })).toEqual(['Alert: Green'])
  })

  it('puts the place first for quakes and the name first for storms and floods', () => {
    expect(eventHeadline(quake('Kainantu', 6, 1))).toBe('10 km N of Kainantu')
    const storm = { type: 'cyclone', title: 'Tropical Cyclone POLO-26', location: 'Mexico' }
    expect(eventHeadline(storm)).toBe('Tropical Cyclone POLO-26')
    expect(eventSubline(storm)).toBe('Mexico')
    expect(eventSubline({ type: 'flood', title: 'Flood in Italy', location: 'Italy' })).toBeNull()
    expect(eventSubline({ type: 'cyclone', title: 'Hurricane Polo' })).toBeNull()
  })

  it('shortens long country lists', () => {
    expect(shortPlace({ location: 'Austria, Belgium, Belarus, Czechia' })).toBe('Austria, Belgium +2 more')
    expect(shortPlace({ location: '35 km NNE of X, Indonesia' })).toBe('35 km NNE of X, Indonesia')
  })

  it('labels every event for screen readers, including unrated ones', () => {
    expect(eventLabel({ ...quake('A', 6.1, 1), severity_level: 'high' })).toBe('Earthquake, 10 km N of A, High severity')
    expect(eventLabel({ type: 'cyclone', title: 'Hurricane Polo' })).toBe('Cyclone, Hurricane Polo, not rated')
  })
})

describe('sorting and filtering', () => {
  const events = [
    quake('old-big', 7.1, 30, { severity_level: 'very_high' }),
    quake('new-small', 4.6, 1, { severity_level: 'moderate' }),
    { id: 'flood', type: 'flood', title: 'Flood', time: hoursAgo(0.5), severity_level: 'high', sources: [] },
    { id: 'storm', type: 'cyclone', title: 'Storm', time: hoursAgo(5), severity_level: null, sources: [] },
  ]

  it('sorts by most recent, severity and magnitude', () => {
    expect(sortEvents(events, 'recent').map((e) => e.id)).toEqual(['flood', 'new-small', 'storm', 'old-big'])
    expect(sortEvents(events, 'severity').map((e) => e.id)).toEqual(['old-big', 'flood', 'new-small', 'storm'])
    // Events without a magnitude go last, most recent first.
    expect(sortEvents(events, 'magnitude').map((e) => e.id)).toEqual(['old-big', 'new-small', 'flood', 'storm'])
  })

  it('does not mutate the input', () => {
    const copy = [...events]
    sortEvents(events, 'severity')
    expect(events).toEqual(copy)
  })

  it('filters by type and severity, with unrated events as their own option', () => {
    const all = { types: new Set(['earthquake', 'cyclone', 'flood']), severities: new Set(SEVERITY_FILTERS) }
    expect(filterEvents(events, all)).toHaveLength(4)
    expect(filterEvents(events, { ...all, types: new Set(['earthquake']) }).map((e) => e.id)).toEqual(['old-big', 'new-small'])
    expect(filterEvents(events, { ...all, severities: new Set([UNRATED]) }).map((e) => e.id)).toEqual(['storm'])
  })

  it('keeps events inside the map bounds, across the date line', () => {
    const bounds = L.latLngBounds([-10, 170], [10, 200])
    expect(inBounds(bounds, { latitude: 0, longitude: -175 })).toBe(true)
    expect(inBounds(bounds, { latitude: 0, longitude: 0 })).toBe(false)
    expect(inBounds(null, { latitude: 0, longitude: 0 })).toBe(true)
  })

  it('names the dominant type of a cluster', () => {
    expect(dominantType(['flood', 'earthquake', 'flood'])).toBe('flood')
    expect(dominantType(['cyclone'])).toBe('cyclone')
  })
})
