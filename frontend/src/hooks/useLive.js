import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useApi } from './useApi'

/**
 * Live events (optionally for one disaster type) plus a toast whenever a feed
 * is down, so an outage is announced instead of reading as "no disasters".
 * Each distinct outage is announced once per page visit.
 */
export function useLiveEvents(type, { refreshNonce = 0 } = {}) {
  const toast = useToast()
  const result = useApi(
    () => api.liveEvents({ type, refresh: refreshNonce > 0 }),
    [type, refreshNonce],
  )
  const announced = useRef(new Set())

  useEffect(() => {
    if (!result.data) return
    const down = result.data.sources.filter(
      (source) => source.status === 'unavailable' || source.status === 'stale',
    )
    const relevant = type
      ? down.filter((source) =>
          result.data.layers[type]?.sources.some((layerSource) => layerSource.id === source.id),
        )
      : down
    relevant.forEach((source) => {
      const key = `${source.id}:${source.status}`
      if (announced.current.has(key)) return
      announced.current.add(key)
      toast.error(
        source.status === 'stale'
          ? `${source.name} did not answer; showing its last good data from ${source.age_seconds ? Math.round(source.age_seconds / 60) : 0} min ago.`
          : `${source.name} is temporarily unavailable. Its layers are marked on the page.`,
      )
    })
  }, [result.data, toast, type])

  return result
}

/** Names of the feeds that failed for a layer, e.g. ["GDACS"]. */
export const downSources = (layer) =>
  (layer?.sources ?? []).filter((source) => source.status === 'unavailable').map((source) => source.name)

/**
 * True when a layer's count cannot be read as "that many events" because a
 * feed serving it is down. A zero from an incomplete layer is never shown as zero.
 */
export const isIncomplete = (layer) => downSources(layer).length > 0

export function useLiveSummary() {
  return useApi(() => api.liveSummary(), [])
}
