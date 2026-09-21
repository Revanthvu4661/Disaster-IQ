import { useCallback, useEffect, useState } from 'react'

/**
 * Runs an async loader and exposes `{ data, error, loading, reload }`.
 *
 * `deps` behaves like a `useEffect` dependency list. Loading is derived rather
 * than stored: the state carries the key of the request it belongs to, so a
 * superseded response can never be shown and no state is set during render or
 * synchronously inside the effect. `reload()` bumps a nonce to re-run.
 */
export function useApi(loader, deps = [], { enabled = true } = {}) {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState({ data: null, error: null, key: null })
  const key = JSON.stringify([deps, nonce, enabled])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    loader()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, key })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ data: null, error: error?.message ?? 'Something went wrong', key })
        }
      })
    return () => {
      cancelled = true
    }
    // `loader` closes over `deps`; depending on it would re-run every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  const settled = state.key === key

  return {
    data: settled ? state.data : null,
    error: settled ? state.error : null,
    loading: enabled && !settled,
    reload,
  }
}

/** Loads several endpoints together and returns them as a keyed object. */
export function useApiAll(loaders, deps = []) {
  const keys = Object.keys(loaders)
  return useApi(
    async () => {
      const results = await Promise.all(keys.map((key) => loaders[key]()))
      return Object.fromEntries(keys.map((key, index) => [key, results[index]]))
    },
    deps,
  )
}
