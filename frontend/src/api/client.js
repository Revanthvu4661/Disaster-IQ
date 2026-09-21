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

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(API_BASE + path, {
      headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch {
    throw new ApiError('Cannot reach the API. Is the backend running?', 0)
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

  // analytics
  summaryStats: () => request('/analytics/summary-stats'),
  categoryDistribution: () => request('/analytics/category-distribution'),
  topCategories: (limit = 15, needsOnly = false) =>
    request(`/analytics/top-categories${query({ limit, needs_only: needsOnly || undefined })}`),
  volumeByEvent: () => request('/analytics/volume-by-event'),
  volumeByGenre: () => request('/analytics/volume-by-genre'),
  eventCategoryMix: () => request('/analytics/event-category-mix'),
  genreEventMatrix: () => request('/analytics/genre-event-matrix'),
  cooccurrence: () => request('/analytics/category-cooccurrence'),
  needsBundles: (limit = 12) => request(`/analytics/needs-bundles${query({ limit })}`),
  messageLength: () => request('/analytics/message-length'),
  topTerms: (category, limit = 15) =>
    request(`/analytics/top-terms/${encodeURIComponent(category)}${query({ limit })}`),
  urgentTerms: (limit = 40) => request(`/analytics/urgent-terms${query({ limit })}`),
  dataQuality: () => request('/analytics/data-quality'),
  search: (q, { limit = 25, category, event } = {}) =>
    request(`/analytics/search${query({ q, limit, category, event })}`),

  // prediction
  predict: (message, options = {}) =>
    request('/predict', { method: 'POST', body: JSON.stringify({ message, ...options }) }),
  predictBatch: (messages, options = {}) =>
    request('/predict/batch', {
      method: 'POST',
      body: JSON.stringify({ messages, ...options }),
    }),
  predictBatchCsv: (file) => {
    const form = new FormData()
    form.append('file', file)
    return request('/predict/batch-csv', { method: 'POST', body: form })
  },

  // recommendations
  recommend: (payload) =>
    request('/recommend', { method: 'POST', body: JSON.stringify(payload) }),
  rules: () => request('/recommend/rules'),

  // model
  modelInfo: () => request('/model/info'),
  modelPerformance: () => request('/model/performance'),
  modelCurves: (category) => request(`/model/curves/${encodeURIComponent(category)}`),
  globalTerms: (category, limit = 15) =>
    request(`/model/global-terms/${encodeURIComponent(category)}${query({ limit })}`),
  modelCategories: () => request('/model/categories'),

  // hazards
  hazards: ({ indiaOnly = false, source, refresh = false } = {}) =>
    request(
      `/hazards${query({
        india_only: indiaOnly || undefined,
        source,
        refresh: refresh || undefined,
      })}`,
    ),
}
