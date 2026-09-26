import { describe, expect, it } from 'vitest'
import {
  CYCLONE_ZONES,
  circlePoints,
  districtLabel,
  distanceKm,
  districtsByZone,
  zoneCount,
  zoneFor,
  zoneRange,
  zoneRing,
} from './cycloneZones'
import { INDIA_DISTRICTS } from '../data/indiaDistricts'

describe('cycloneZones', () => {
  it('defines the four bands edge to edge, 0 to 500 km', () => {
    expect(CYCLONE_ZONES.map((zone) => [zone.inner, zone.outer])).toEqual([
      [0, 50],
      [50, 150],
      [150, 300],
      [300, 500],
    ])
    expect(CYCLONE_ZONES.map(zoneRange)).toEqual(['0–50 km', '50–150 km', '150–300 km', '300–500 km'])
  })

  it('measures great-circle distance', () => {
    // Chennai to Kolkata is about 1,360 km.
    expect(distanceKm(13.08, 80.27, 22.57, 88.36)).toBeGreaterThan(1300)
    expect(distanceKm(13.08, 80.27, 22.57, 88.36)).toBeLessThan(1420)
    expect(distanceKm(10, 80, 10, 80)).toBe(0)
  })

  it('puts a distance in the innermost band that holds it', () => {
    expect(zoneFor(0).id).toBe('danger')
    expect(zoneFor(49.9).id).toBe('danger')
    expect(zoneFor(50).id).toBe('high')
    expect(zoneFor(299).id).toBe('watch')
    expect(zoneFor(499).id).toBe('advisory')
    expect(zoneFor(500)).toBeNull()
  })

  it('labels a district with its state unless the name already carries it', () => {
    expect(districtLabel({ district: 'Puri', state: 'Odisha' })).toBe('Puri, Odisha')
    expect(districtLabel({ district: 'Bijapur (Chhattisgarh)', state: 'Chhattisgarh' })).toBe('Bijapur (Chhattisgarh)')
    expect(districtLabel({ district: 'Kaimur (Bhabua)', state: 'Bihar' })).toBe('Kaimur (Bhabua), Bihar')
  })

  it('draws circles at the right distance and rings with a hole', () => {
    const points = circlePoints(15, 85, 150, 24)
    expect(points).toHaveLength(24)
    points.forEach(([lat, lon]) => expect(distanceKm(15, 85, lat, lon)).toBeCloseTo(150, 0))
    expect(zoneRing(15, 85, CYCLONE_ZONES[0])[0]).toHaveLength(2) // a disc: [lat, lon] pairs
    expect(zoneRing(15, 85, CYCLONE_ZONES[1])).toHaveLength(2) // a ring: [outer, hole]
  })

  it('groups districts by band, nearest first, and ignores anything beyond 500 km', () => {
    const districts = [
      ['Near', 'S', 15.1, 85],
      ['Mid', 'S', 16, 85],
      ['Far', 'S', 18, 85],
      ['Out', 'S', 25, 85],
    ]
    const groups = districtsByZone(15, 85, districts)
    expect(groups.danger.map((d) => d.district)).toEqual(['Near'])
    expect(groups.high.map((d) => d.district)).toEqual(['Mid'])
    expect(groups.advisory.map((d) => d.district)).toEqual(['Far'])
    expect(zoneCount(groups)).toBe(3)
  })

  it('finds real districts near the Odisha coast and none far out at sea', () => {
    expect(INDIA_DISTRICTS.length).toBeGreaterThan(700)
    const odisha = districtsByZone(19.8, 86.0)
    expect(odisha.danger.some((d) => d.district === 'Puri')).toBe(true)
    expect(zoneCount(districtsByZone(29.9, -43.4))).toBe(0)
  })
})
