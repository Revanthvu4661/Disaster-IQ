/**
 * API client.
 *
 * The base URL comes from `VITE_API_URL` when it is set (Docker, deployed
 * builds), and falls back to the relative `/api` path that the Vite dev proxy
 * serves. Every call returns parsed JSON and throws an `ApiError` carrying the
 * status and the server's detail message.
 */

const rawBase = import.meta.env?.VITE_API_URL ?? ''
export const API_BASE = rawBase ? `${rawBase.replace(/\/+$/, '')}/api` : '/api'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** A request that has not answered after this long fails instead of spinning forever. */
const TIMEOUT_MS = 30_000

async function request(path, { timeoutMs = TIMEOUT_MS, ...options } = {}) {
  let response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    response = await fetch(API_BASE + path, {
      headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    })
  } catch (error) {
    throw new ApiError(
      error?.name === 'AbortError'
        ? 'The API took too long to answer. Try again.'
        : 'Cannot reach the API. Is the backend running?',
      0,
    )
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    throw new ApiError(
      typeof detail === 'string' ? detail : `Request failed (HTTP ${response.status})`,
      response.status,
    )
  }
  return response.json()
}

const query = (params) => {
  const search = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value)
  })
  const string = search.toString()
  return string ? `?${string}` : ''
}

export const api = {
  health: () => request('/../health'),

  // historical impact analytics (OWID/EM-DAT, USGS, NOAA IBTrACS)
  disasterOverview: () => request('/disasters/overview'),
  disaster: (id) => request(`/disasters/${encodeURIComponent(id)}`),
  historyMap: ({ decade, types } = {}) =>
    request(`/history/map${query({ decade, types: types?.join(',') })}`),

  // live feeds (USGS, GDACS, NASA EONET), merged and cached server-side
  liveEvents: ({ type, refresh = false } = {}) =>
    request(`/live/events${query({ type, refresh: refresh || undefined })}`),
  liveSummary: () => request('/live/summary'),

  // Level 2: flood risk model for the districts of India
  floodRisk: () => request('/flood-risk'),
  floodScenario: (id) => request(`/flood-risk/scenario/${encodeURIComponent(id)}`),
  floodScore: (params) => request(`/flood-risk/score${query(params)}`),

  // Level 2 for earthquakes and cyclones: statistical hazard index per state
  hazardRisk: (hazard) => request(`/hazard-risk/${encodeURIComponent(hazard)}`),

  // Level 3: preparedness and response recommendations from the Level 2 risk
  recommendations: (hazard, { scenario = 'current', days = 7 } = {}) =>
    request(`/recommendations/${encodeURIComponent(hazard)}${query({ scenario: hazard === 'flood' ? scenario : undefined, days })}`),
}
