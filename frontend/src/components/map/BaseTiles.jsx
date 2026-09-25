import { TileLayer } from 'react-leaflet'
import { useTheme } from '../../context/ThemeContext'

/**
 * Basemap tiles for every Leaflet map, matched to the app theme.
 *
 * Provider, first match wins (all keys are read at build time, never hardcoded):
 *   1. VITE_MAPTILER_KEY  MapTiler raster styles (VITE_MAPTILER_STYLE_LIGHT / _DARK)
 *   2. VITE_CARTO_KEY     CARTO Voyager (light) / Dark Matter (dark)
 *   3. no key             Esri World Light / Dark Gray Canvas (keyless)
 *
 * CARTO was keyless until 23 September 2026; since then tiles requested
 * without `?key=` come back blurred with an "API key required" watermark, so it
 * is only used when a key is configured. `{r}` asks for @2x tiles on
 * high-density screens (MapTiler, CARTO); Esri has no @2x raster tiles.
 */
const ENV = import.meta.env ?? {}
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const MAX_ZOOM = 19

export function tileConfig(theme, env = ENV) {
  const dark = theme === 'dark'
  if (env.VITE_MAPTILER_KEY) {
    const style = dark ? env.VITE_MAPTILER_STYLE_DARK || 'streets-v2-dark' : env.VITE_MAPTILER_STYLE_LIGHT || 'streets-v2'
    return {
      provider: 'maptiler',
      url: `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(env.VITE_MAPTILER_KEY)}`,
      attribution: `&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ${OSM}`,
      maxNativeZoom: 19,
    }
  }
  if (env.VITE_CARTO_KEY) {
    return {
      provider: 'carto',
      url: `https://basemaps.cartocdn.com/rastertiles/${dark ? 'dark_all' : 'voyager'}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(env.VITE_CARTO_KEY)}`,
      attribution: `${OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
      maxNativeZoom: 19,
    }
  }
  return {
    provider: 'esri',
    url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? 'Dark' : 'Light'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
    // Esri's canvas basemaps stop at level 16; Leaflet upscales beyond that.
    maxNativeZoom: 16,
  }
}

/**
 * The `key` remounts the layer on every theme change: updating `url` in place
 * can leave tiles from the previous theme mixed in after repeated toggles.
 */
export function BaseTiles() {
  const { theme } = useTheme()
  const config = tileConfig(theme)
  return (
    <TileLayer
      key={`${config.provider}-${theme}`}
      url={config.url}
      attribution={config.attribution}
      maxZoom={MAX_ZOOM}
      maxNativeZoom={config.maxNativeZoom}
    />
  )
}

export default BaseTiles

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_IMAGERY_ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS user community'

/** World Map basemaps (keyless Esri): satellite imagery or a dark canvas. */
export const WORLD_BASEMAPS = [
  { id: 'satellite', label: 'Satellite' },
  { id: 'dark', label: 'Dark map' },
]

/**
 * Tiles for one World Map basemap: the image layer, plus a transparent
 * reference layer of borders and place names that fills in continents, then
 * countries, states and cities as you zoom in.
 */
export function worldBasemap(id) {
  if (id === 'dark') {
    return {
      base: {
        url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors',
        maxNativeZoom: 16,
      },
      labels: { url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
    }
  }
  return {
    base: {
      url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
      attribution: ESRI_IMAGERY_ATTRIBUTION,
      maxNativeZoom: 18,
    },
    labels: {
      url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
      maxNativeZoom: 18,
    },
  }
}
