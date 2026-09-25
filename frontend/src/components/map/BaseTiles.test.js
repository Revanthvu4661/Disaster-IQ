import { describe, expect, it } from 'vitest'
import { tileConfig } from './BaseTiles'

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
