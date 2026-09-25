/**
 * Small pieces for the Overview's blended "command center" theme.
 */
import { DISASTER_TYPES } from '../../config/disasterTypes'
import { GLYPHS } from '../map/eventIcons'

/**
 * The hazard each live feed's status segment is tinted toward. The tint is
 * decoration only: every segment names its feed and what it serves in text.
 */
const SOURCE_HAZARD = { usgs: 'earthquake', gdacs: 'flood', eonet: 'cyclone' }
export const sourceHazard = (id) => SOURCE_HAZARD[id]

/**
 * What a live feed serves, read from the live layers: "earthquakes",
 * "earthquakes · floods · cyclones". Empty when the layers are unknown.
 */
export function sourceServes(id, layers) {
  if (!layers) return ''
  return DISASTER_TYPES.filter((type) => layers[type.id]?.sources?.some((source) => source.id === id))
    .map((type) => type.noun[1])
    .join(' · ')
}

/**
 * Faint corner drawing on a disaster card: a jagged fault line, drifting
 * waves, or the World Map's storm spiral turning slowly. Decorative only.
 */
export function CardMotif({ hazard }) {
  if (hazard === 'earthquake') {
    return (
      <svg className="card-motif card-motif-quake" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <path d="M4 30 L30 38 L40 24 L62 46 L70 34 L96 58 L106 50 L118 70" />
        <path d="M62 46 L58 70 L72 88 L66 116" />
      </svg>
    )
  }
  if (hazard === 'flood') {
    return (
      <svg className="card-motif card-motif-flood" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <g className="card-motif-waves">
          <path d="M-40 40 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" />
          <path d="M-40 62 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" />
          <path d="M-40 84 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" />
        </g>
      </svg>
    )
  }
  if (hazard === 'cyclone') {
    // Same spiral as the World Map marker and the Cyclone page: one symbol for "cyclone".
    return <span className="card-motif card-motif-cyclone" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS.cyclone }} />
  }
  return null
}
