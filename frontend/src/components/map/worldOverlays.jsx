/**
 * Overlays and controls for the live World Map: tectonic plate boundaries,
 * continent and ocean names, zoom / locate buttons, the legend and the
 * layers menu. The controls sit outside the Leaflet container and drive the
 * map through its instance, so they are ordinary, keyboard-reachable buttons.
 */
import { useEffect, useId, useRef, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, Marker, Pane, useMap, useMapEvents } from 'react-leaflet'
import { Crosshair, Layers, Minus, Plus, X } from 'lucide-react'
import { MAP_TYPES } from '../../lib/liveEvents'
import { TypeIcon } from '../live/parts'
import { WORLD_BASEMAPS } from './BaseTiles'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/* ── plate boundaries ─────────────────────────────────────────────────── */

let platesPromise = null
/** PB2002 plate boundaries (Bird 2003), shipped in public/geo; fetched once per visit. */
function loadPlates() {
  if (!platesPromise) {
    platesPromise = fetch(`${import.meta.env.BASE_URL}geo/plates.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`plates ${response.status}`)
        return response.json()
      })
      .catch((error) => {
        platesPromise = null // allow a retry on the next visit
        throw error
      })
  }
  return platesPromise
}

const GLOW = { color: '#ff3b30', weight: 6, opacity: 0.22, interactive: false, className: 'wm-plate-glow' }
const DASH = { color: '#ff5a4f', weight: 1.4, opacity: 0.95, dashArray: '6 5', interactive: false, className: 'wm-plate-line' }

/** Thin red dashed lines with a faint glow, under the markers. */
export function PlateBoundaries() {
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    loadPlates()
      .then((json) => alive && setData(json))
      .catch(() => {
        /* the layer is decorative context; without the file it is simply absent */
      })
    return () => {
      alive = false
    }
  }, [])
  if (!data) return null
  return (
    <Pane name="wm-plates" style={{ zIndex: 320 }}>
      <GeoJSON data={data} style={() => GLOW} />
      <GeoJSON data={data} style={() => DASH} />
    </Pane>
  )
}

/* ── continent and ocean names ────────────────────────────────────────── */

const CONTINENTS = [
  ['NORTH AMERICA', [47, -102]],
  ['SOUTH AMERICA', [-14, -60]],
  ['EUROPE', [53, 18]],
  ['AFRICA', [6, 20]],
  ['ASIA', [50, 92]],
  ['AUSTRALIA', [-25, 134]],
  ['ANTARCTICA', [-77, 30]],
]
const OCEANS = [
  ['Pacific Ocean', [8, -138]],
  ['Pacific Ocean', [2, 162]],
  ['Atlantic Ocean', [22, -42]],
  ['Indian Ocean', [-22, 78]],
  ['Southern Ocean', [-60, 70]],
]

const labelIcons = new Map()
function labelIcon(text, kind) {
  const key = `${kind}|${text}`
  if (!labelIcons.has(key)) {
    labelIcons.set(
      key,
      L.divIcon({ html: `<span>${text}</span>`, className: `wm-geo-label wm-geo-${kind}`, iconSize: [0, 0] }),
    )
  }
  return labelIcons.get(key)
}

/** Largest zoom at which the continent and ocean names show; they fade out above it. */
export const GEO_LABEL_MAX_ZOOM = 3

/**
 * Continent names (white, letter-spaced) and ocean names (italic serif) at
 * fixed points. They are decorative map text: hidden from assistive tech and
 * never interactive. The pane fades out from zoom 4.
 */
export function GeoLabels() {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  return (
    <Pane name="wm-geolabels" style={{ zIndex: 360 }}>
      <PaneFlags name="wm-geolabels" faded={zoom > GEO_LABEL_MAX_ZOOM} />
      {CONTINENTS.map(([text, position]) => (
        <Marker key={text} position={position} icon={labelIcon(text, 'continent')} interactive={false} keyboard={false} />
      ))}
      {OCEANS.map(([text, position]) => (
        <Marker key={`${text}${position}`} position={position} icon={labelIcon(text, 'ocean')} interactive={false} keyboard={false} />
      ))}
    </Pane>
  )
}

/** Hides the label pane from assistive tech and fades it out above the label zoom. */
function PaneFlags({ name, faded }) {
  const map = useMap()
  useEffect(() => {
    const pane = map.getPane(name)
    if (!pane) return
    pane.setAttribute('aria-hidden', 'true')
    pane.classList.add('wm-geolabels')
    pane.classList.toggle('is-faded', faded)
  }, [map, name, faded])
  return null
}

/* ── zoom and locate ──────────────────────────────────────────────────── */

/**
 * Zoom in / out and "locate me". Location is asked for only when the button
 * is pressed; a refusal or failure leaves the map where it is, silently.
 */
export function ZoomLocateControls({ map, onLocated }) {
  const [locating, setLocating] = useState(false)
  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator
  const locate = () => {
    if (!map || !canLocate) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        const target = [position.coords.latitude, position.coords.longitude]
        onLocated?.(target)
        if (prefersReducedMotion()) map.setView(target, 6)
        else map.flyTo(target, 6, { duration: 0.8 })
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }
  return (
    <div className="wm-ctrl wm-ctrl-zoom" role="group" aria-label="Map zoom">
      <button type="button" className="wm-ctrl-btn" onClick={() => map?.zoomIn()} aria-label="Zoom in" title="Zoom in">
        <Plus size={16} aria-hidden="true" />
      </button>
      <button type="button" className="wm-ctrl-btn" onClick={() => map?.zoomOut()} aria-label="Zoom out" title="Zoom out">
        <Minus size={16} aria-hidden="true" />
      </button>
      {canLocate && (
        <button
          type="button"
          className="wm-ctrl-btn"
          onClick={locate}
          aria-label="Show my location"
          title="Show my location"
          aria-busy={locating}
          disabled={locating}
        >
          <Crosshair size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/* ── legend ───────────────────────────────────────────────────────────── */

/** Legend pill with the same icons as the markers. */
export function MapLegend() {
  return (
    <div className="wm-legend" aria-label="Map legend">
      <ul>
        {MAP_TYPES.map((type) => (
          <li key={type.id}>
            <TypeIcon type={type.id} size={20} decorative />
            {type.legend}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── layers menu ──────────────────────────────────────────────────────── */

/**
 * Bottom-right layers button and its panel: basemap choice and toggles for
 * the three event types, plate boundaries and labels. Escape or a click
 * outside closes it and focus returns to the button.
 */
export function LayersMenu({ settings, onChange, types, onToggleType, typeNotes = {} }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const id = useId()

  useEffect(() => {
    if (!open) return undefined
    panelRef.current?.querySelector('input')?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onPointer = (event) => {
      if (!panelRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <div className="wm-layers">
      {open && (
        <div className="wm-layers-panel" id={`${id}-panel`} ref={panelRef} role="group" aria-label="Map layers">
          <div className="wm-layers-head">
            <strong>Map layers</strong>
            <button
              type="button"
              className="wm-icon-btn"
              aria-label="Close map layers"
              onClick={() => {
                setOpen(false)
                buttonRef.current?.focus()
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <fieldset>
            <legend>Basemap</legend>
            {WORLD_BASEMAPS.map((basemap) => (
              <label key={basemap.id} className="wm-check">
                <input
                  type="radio"
                  name={`${id}-basemap`}
                  value={basemap.id}
                  checked={settings.basemap === basemap.id}
                  onChange={() => onChange({ basemap: basemap.id })}
                />
                {basemap.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Events</legend>
            {MAP_TYPES.map((type) => (
              <label key={type.id} className="wm-check">
                <input type="checkbox" checked={types.has(type.id)} onChange={() => onToggleType(type.id)} />
                <TypeIcon type={type.id} size={18} decorative />
                <span>{type.plural}</span>
                {typeNotes[type.id] && <span className="wm-check-note">{typeNotes[type.id]}</span>}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Context</legend>
            <label className="wm-check">
              <input type="checkbox" checked={settings.plates} onChange={() => onChange({ plates: !settings.plates })} />
              <span className="wm-plate-swatch" aria-hidden="true" />
              Plate boundaries
            </label>
            <label className="wm-check">
              <input type="checkbox" checked={settings.labels} onChange={() => onChange({ labels: !settings.labels })} />
              Labels
              <span className="wm-check-note">place names, borders</span>
            </label>
          </fieldset>
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="wm-ctrl-btn wm-layers-btn"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        aria-label="Map layers"
        title="Map layers"
        onClick={() => setOpen((value) => !value)}
      >
        <Layers size={17} aria-hidden="true" />
      </button>
    </div>
  )
}
