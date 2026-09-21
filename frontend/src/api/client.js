const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  summaryStats:           () => request('/analytics/summary-stats'),
  categoryDistribution:   () => request('/analytics/category-distribution'),
  topCategories:          (limit = 20) => request(`/analytics/top-categories?limit=${limit}`),
  volumeByEvent:          () => request('/analytics/volume-by-event'),
  categoryCooccurrence:   (limit = 8) => request(`/analytics/category-cooccurrence?limit=${limit}`),
  predict:                (message) => request('/predict', {
    method: 'POST',
    body: JSON.stringify({ message }),
  }),
}
