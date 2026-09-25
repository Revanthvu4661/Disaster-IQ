import { describe, expect, it } from 'vitest'
import { WORLD_BASEMAPS, tileConfig, worldBasemap } from './BaseTiles'

describe('tileConfig', () => {
  it('falls back to keyless Esri canvas tiles, per theme', () => {
    expect(tileConfig('light', {}).url).toContain('World_Light_Gray_Base')
    expect(tileConfig('dark', {}).url).toContain('World_Dark_Gray_Base')
    expect(tileConfig('dark', {}).maxNativeZoom).toBe(16)
  })

  it('uses CARTO with the key on every tile URL when one is set', () => {
    const config = tileConfig('dark', { VITE_CARTO_KEY: 'abc' })
    expect(config.url).toBe('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=abc')
    expect(config.attribution).toMatch(/OpenStreetMap.*CARTO/)
    expect(tileConfig('light', { VITE_CARTO_KEY: 'abc' }).url).toContain('/voyager/')
  })

  it('prefers MapTiler over CARTO and honours custom styles', () => {
    const config = tileConfig('light', { VITE_MAPTILER_KEY: 'k', VITE_CARTO_KEY: 'c', VITE_MAPTILER_STYLE_LIGHT: 'basic-v2' })
    expect(config.provider).toBe('maptiler')
    expect(config.url).toBe('https://api.maptiler.com/maps/basic-v2/256/{z}/{x}/{y}{r}.png?key=k')
  })
})

describe('worldBasemap', () => {
  it('defaults to keyless Esri satellite imagery with the boundaries-and-places overlay', () => {
    const { base, labels } = worldBasemap('satellite')
    expect(base.url).toContain('/World_Imagery/MapServer/tile/{z}/{y}/{x}')
    expect(base.url).not.toContain('key=')
    expect(base.attribution).toMatch(/Esri/)
    expect(labels.url).toContain('/Reference/World_Boundaries_and_Places/')
    expect(worldBasemap(undefined).base.url).toBe(base.url)
  })

  it('offers a dark canvas with its own reference labels', () => {
    const { base, labels } = worldBasemap('dark')
    expect(base.url).toContain('World_Dark_Gray_Base')
    expect(labels.url).toContain('World_Dark_Gray_Reference')
    expect(WORLD_BASEMAPS.map((item) => item.label)).toEqual(['Satellite', 'Dark map'])
  })
})
