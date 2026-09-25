import { useEffect, useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'

/** Shared world-map limits: one world copy, no grey bands above the poles. */
export const MAP_LIMITS = {
  minZoom: 2,
  maxBounds: [
    [-85, -180],
    [85, 180],
  ],
  maxBoundsViscosity: 1.0,
}

/**
 * Keeps Leaflet's size in step with its container (window resize, grid
 * reflow, a tab or panel becoming visible); Leaflet only measures on mount.
 */
export function SizeWatcher() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    if (typeof ResizeObserver === 'undefined') return undefined
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }))
    })
    observer.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [map])
  return null
}

/** Reports the visible bounds after pan or zoom settles (debounced), and once on mount. */
export function BoundsWatcher({ onChange, delay = 150 }) {
  const timer = useRef(0)
  const map = useMapEvents({
    moveend: () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => onChange?.(map.getBounds()), delay)
    },
  })
  useEffect(() => {
    onChange?.(map.getBounds())
    return () => window.clearTimeout(timer.current)
  }, [map, onChange])
  return null
}
