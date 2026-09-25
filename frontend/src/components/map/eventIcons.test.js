import { describe, expect, it } from 'vitest'
import { BIG_STORM_SIZE, clusterIcon, eventIcon, iconCacheSize, iconSize, markerHtml } from './eventIcons'

describe('event marker icons', () => {
  it('are built once per type and severity and then reused', () => {
    const first = eventIcon('earthquake', 'high', 10)
    const before = iconCacheSize()
    for (let i = 0; i < 150; i += 1) eventIcon('earthquake', 'high', i % 60)
    expect(eventIcon('earthquake', 'high', -30)).toBe(first) // latitude only matters for cyclones
    expect(iconCacheSize()).toBe(before)
  })

  it('size markers by severity and draw Very High cyclones as a large storm', () => {
    expect(eventIcon('flood', 'moderate').options.iconSize).toEqual([30, 30])
    expect(eventIcon('earthquake', 'high').options.iconSize).toEqual([38, 38])
    expect(eventIcon('earthquake', 'very_high').options.iconSize).toEqual([46, 46])
    expect(iconSize('cyclone', 'very_high')).toBe(BIG_STORM_SIZE)
    expect(eventIcon('cyclone', 'very_high', 20).options.iconSize).toEqual([90, 90])
  })

  it('spin cyclones by hemisphere', () => {
    expect(eventIcon('cyclone', 'high', 15).options.html).toContain('wm-spin-ccw')
    expect(eventIcon('cyclone', 'high', -15).options.html).toContain('wm-spin-cw')
    expect(eventIcon('cyclone', 'high', 15)).not.toBe(eventIcon('cyclone', 'high', -15))
  })

  it('carry a text label, so type is never shown by colour alone', () => {
    const html = markerHtml('flood', 'very_high')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Flood, Very High"')
    expect(markerHtml('earthquake', null)).toContain('aria-label="Earthquake, Not rated"')
    expect(markerHtml('earthquake', 'high')).toContain('wm-ring')
  })
})

describe('cluster icon', () => {
  const cluster = (types) => ({
    getAllChildMarkers: () => types.map((eventType) => ({ options: { eventType } })),
    getChildCount: () => types.length,
  })

  it('takes the colour and label of the most common type', () => {
    const icon = clusterIcon(cluster(['flood', 'earthquake', 'earthquake']))
    expect(icon.options.html).toContain('wm-cluster-earthquake')
    expect(icon.options.html).toContain('>3</span>')
    expect(icon.options.html).toContain('aria-label="3 events here, mostly earthquakes. Zoom in to see them."')
  })

  it('grows with the count', () => {
    expect(clusterIcon(cluster(Array(5).fill('flood'))).options.iconSize.x).toBe(38)
    expect(clusterIcon(cluster(Array(20).fill('flood'))).options.iconSize.x).toBe(46)
    expect(clusterIcon(cluster(Array(80).fill('flood'))).options.iconSize.x).toBe(54)
  })
})
