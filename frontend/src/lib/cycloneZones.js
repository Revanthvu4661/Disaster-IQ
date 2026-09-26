import { INDIA_DISTRICTS } from '../data/indiaDistricts'

/**
 * Fixed-distance impact rings around a cyclone's centre, like the bands on a
 * weather alert map. The distances are fixed, not the storm's own wind
 * radii (the live feeds do not carry those), so the rings show distance from
 * the eye, not a forecast of where the wind will reach.
 *
 * Each zone is a band: a district belongs to the innermost ring it falls in.
 */
export const CYCLONE_ZONES = [
  { id: 'danger', name: 'Danger', label: 'Red Alert — Direct Impact', inner: 0, outer: 50, color: '#FF0000', opacity: 0.25 },
  { id: 'high', name: 'High Alert', label: 'Orange Alert', inner: 50, outer: 150, color: '#FF6600', opacity: 0.18 },
  { id: 'watch', name: 'Watch', label: 'Yellow Watch', inner: 150, outer: 300, color: '#FFD700', opacity: 0.12 },
  { id: 'advisory', name: 'Advisory', label: 'Blue Advisory', inner: 300, outer: 500, color: '#0099FF', opacity: 0.08 },
]

export const ZONE_MAX_KM = CYCLONE_ZONES[CYCLONE_ZONES.length - 1].outer

const EARTH_RADIUS_KM = 6371
const rad = (deg) => (deg * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

/** Great-circle distance in km (haversine). */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** The zone a distance falls in, or null beyond the outermost ring. */
export function zoneFor(km) {
  return CYCLONE_ZONES.find((zone) => km >= zone.inner && km < zone.outer) ?? null
}

/** `radiusKm` circle around a point as [lat, lon] pairs, true on the globe (not a screen circle). */
export function circlePoints(lat, lon, radiusKm, steps = 96) {
  const d = radiusKm / EARTH_RADIUS_KM
  const lat1 = rad(lat)
  const lon1 = rad(lon)
  return Array.from({ length: steps }, (_, index) => {
    const bearing = (2 * Math.PI * index) / steps
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing))
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
    return [+deg(lat2).toFixed(4), +deg(lon2).toFixed(4)]
  })
}

/** Leaflet polygon positions for a zone: a disc for the centre, a ring (outer with a hole) for the rest. */
export function zoneRing(lat, lon, zone) {
  const outer = circlePoints(lat, lon, zone.outer)
  return zone.inner > 0 ? [outer, circlePoints(lat, lon, zone.inner)] : outer
}

/**
 * Indian districts within the rings of one cyclone, grouped by zone, nearest
 * first: `{ danger: [{ district, state, km }], high: [...], ... }`. A district
 * is placed by its centroid, so this is approximate at the ring edges.
 */
export function districtsByZone(lat, lon, districts = INDIA_DISTRICTS) {
  const groups = Object.fromEntries(CYCLONE_ZONES.map((zone) => [zone.id, []]))
  for (const [district, state, dLat, dLon] of districts) {
    // Cheap reject: 500 km is under 4.6° of latitude anywhere.
    if (Math.abs(dLat - lat) > 5) continue
    const km = distanceKm(lat, lon, dLat, dLon)
    const zone = zoneFor(km)
    if (zone) groups[zone.id].push({ district, state, km: Math.round(km) })
  }
  Object.values(groups).forEach((list) => list.sort((a, b) => a.km - b.km))
  return groups
}

/** Total districts across every zone. */
export const zoneCount = (groups) => Object.values(groups).reduce((sum, list) => sum + list.length, 0)

/**
 * "Puri, Odisha". A few names already carry their state to tell two
 * districts apart ("Bijapur (Chhattisgarh)"); those are shown as they are.
 */
export const districtLabel = ({ district, state }) =>
  district.includes(`(${state})`) ? district : `${district}, ${state}`

/** "0–50 km", "50–150 km". */
export const zoneRange = (zone) => `${zone.inner}–${zone.outer} km`
