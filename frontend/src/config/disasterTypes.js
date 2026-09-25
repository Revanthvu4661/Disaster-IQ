/**
 * The three disaster types, in display order: the UI source of truth.
 *
 * Every page, chart, badge and map marker reads this module. Colours are
 * written to CSS custom properties (`--dt-<id>`, `--dt-<id>-soft`) by
 * `applyDisasterTokens`, so stylesheets reference the variables and never
 * repeat a hex value. Each colour pair clears WCAG AA (4.5:1) as text on the
 * card surfaces of its theme.
 *
 * `noun` is [singular, plural] for counts ("3 floods").
 * `historical` names the sources behind the type's historical page:
 * EM-DAT impact records for all three, plus a point-level source where one
 * exists (USGS for earthquakes, NOAA IBTrACS for cyclones).
 *
 * The data mapping (OWID column, feed codes) lives in
 * `backend/disaster_types.py`; `backend/tests/test_disasters.py` checks that
 * both files list the same ids in the same order.
 */

import { CloudRain, Activity, Tornado } from 'lucide-react'

export const DISASTER_TYPES = [
  {
    id: 'earthquake',
    noun: ['earthquake', 'earthquakes'],
    label: 'Earthquake',
    shortLabel: 'Earthquake',
    path: '/earthquake',
    icon: Activity,
    color: { light: '#9A3412', dark: '#EE9A62' },
    definition: 'Sudden ground shaking caused by movement along a fault.',
    historical: { impact: 'emdat', points: 'usgs' },
    liveSources: ['USGS', 'GDACS'],
  },
  {
    id: 'flood',
    noun: ['flood', 'floods'],
    label: 'Flood',
    shortLabel: 'Flood',
    path: '/flood',
    icon: CloudRain,
    color: { light: '#1D4ED8', dark: '#60A5FA' },
    definition: 'Water overflowing onto land that is normally dry.',
    historical: { impact: 'emdat', points: null },
    liveSources: ['GDACS', 'NASA EONET'],
  },
  {
    id: 'cyclone',
    noun: ['cyclone', 'cyclones'],
    label: 'Cyclone/Hurricane',
    shortLabel: 'Cyclone',
    path: '/cyclone',
    icon: Tornado,
    color: { light: '#6D28D9', dark: '#A78BFA' },
    definition: 'A powerful rotating storm with strong winds and heavy rain.',
    historical: { impact: 'emdat', points: 'ibtracs' },
    liveSources: ['GDACS', 'NASA EONET'],
  },
]

export const DISASTER_IDS = DISASTER_TYPES.map((type) => type.id)

const BY_ID = Object.fromEntries(DISASTER_TYPES.map((type) => [type.id, type]))

/** Look up a type by id; returns `undefined` for unknown ids. */
export const getDisasterType = (id) => BY_ID[id]

/** CSS variable for a type's colour, for styles, SVG `style` and Recharts fills. */
export const disasterVar = (id, variant = '') => `var(--dt-${id}${variant ? `-${variant}` : ''})`

/** Raw hex for the current theme, for places CSS variables cannot reach (Leaflet). */
export const disasterHex = (id, theme = 'dark') => BY_ID[id]?.color[theme] ?? '#64748b'

/** Writes `--dt-*` custom properties for the active theme onto `<html>`. */
export function applyDisasterTokens(theme, root = document.documentElement) {
  DISASTER_TYPES.forEach((type) => {
    const hex = type.color[theme] ?? type.color.dark
    root.style.setProperty(`--dt-${type.id}`, hex)
    root.style.setProperty(`--dt-${type.id}-soft`, `color-mix(in srgb, ${hex} 14%, transparent)`)
    root.style.setProperty(`--dt-${type.id}-line`, `color-mix(in srgb, ${hex} 40%, transparent)`)
  })
}
