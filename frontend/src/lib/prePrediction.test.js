import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FORECAST_DAYS,
  anomalies,
  dailyScores,
  indicatorRows,
  indicatorStatus,
  peakScores,
  riskLevel,
  riskScore,
  seasonFor,
  seasonalFactor,
  seismicSummary,
  withCache,
} from './prePrediction'

const flat = Array(12).fill(1 / 12)
const BASELINE = {
  coastal: true,
  hazards: {
    flood: { frequency: 0.8, geography: 0.4, monthly_share: [0, 0, 0, 0, 0, 0.2, 0.4, 0.2, 0.1, 0.1, 0, 0] },
    cyclone: { frequency: 0.6, geography: 1, monthly_share: flat },
    earthquake: { frequency: 0.1, geography: 0, monthly_share: null },
  },
}

describe('prePrediction scoring', () => {
  it('applies the weights and scales to 0–100', () => {
    expect(riskScore({ frequency: 1, seasonal: 1, anomaly: 1, geography: 1 })).toBe(100)
    expect(riskScore({ frequency: 0, seasonal: 0, anomaly: 0, geography: 0 })).toBe(0)
    // 0.5×0.35 + 1×0.25 + 0×0.30 + 1×0.10 = 0.525
    expect(riskScore({ frequency: 0.5, seasonal: 1, anomaly: 0, geography: 1 })).toBe(53)
  })

  it('bands the score into the four levels', () => {
    expect([0, 30, 31, 60, 61, 80, 81, 100].map(riskLevel)).toEqual([
      'low', 'low', 'medium', 'medium', 'high', 'high', 'critical', 'critical',
    ])
  })

  it('scales a month by the busiest month, and treats earthquakes as flat', () => {
    expect(seasonalFactor(BASELINE.hazards.flood.monthly_share, 7)).toBe(1)
    expect(seasonalFactor(BASELINE.hazards.flood.monthly_share, 6)).toBe(0.5)
    expect(seasonalFactor(BASELINE.hazards.flood.monthly_share, 1)).toBe(0)
    expect(seasonalFactor(null, 3)).toBe(0.5)
    expect(seasonalFactor(Array(12).fill(0), 3)).toBe(0)
  })

  it('names the IMD season', () => {
    expect(seasonFor(1)).toBe('Winter')
    expect(seasonFor(4)).toBe('Pre-monsoon (summer)')
    expect(seasonFor(8)).toBe('Southwest monsoon')
    expect(seasonFor(11)).toMatch(/Post-monsoon/)
  })

  it('turns readings into 0–1 anomalies, ignoring missing ones', () => {
    expect(anomalies({ precip: 50, soil: 0.3, wind: 30, sst: 29, coastal: true, maxMagnitude: 4 })).toEqual({
      flood: 0.5,
      cyclone: 0.7 * 0.5 + 0.3 * 1,
      earthquake: 0.5,
    })
    expect(anomalies({ precip: 250, wind: 90, coastal: false, maxMagnitude: 7 })).toEqual({ flood: 1, cyclone: 1, earthquake: 1 })
    expect(anomalies({})).toEqual({ flood: 0, cyclone: 0, earthquake: 0 })
  })

  it('uses the forecast for the first 16 days only, and finds each peak', () => {
    const start = '2026-07-01'
    const daily = Array.from({ length: FORECAST_DAYS }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      precip: i === 3 ? 120 : 0,
      windMax: 10,
      soil: 0.2,
    }))
    const rows = dailyScores(BASELINE, { daily, sst: 27, maxMagnitude: null }, start, 30)
    expect(rows).toHaveLength(30)
    expect(rows[3].factors.flood.anomaly).toBe(1)
    expect(rows[20].factors.flood.anomaly).toBe(0) // beyond the forecast
    expect(rows[0].factors.earthquake.seasonal).toBe(0.5)
    const peaks = peakScores(rows)
    expect(peaks.flood.day).toBe(4)
    expect(peaks.flood.score).toBe(riskScore(rows[3].factors.flood))
    expect(peaks.flood.level).toBe(riskLevel(peaks.flood.score))
  })
})

describe('early-warning indicators', () => {
  it('marks critical above the threshold and alert within 75% of it', () => {
    expect(indicatorStatus(120, 100)).toBe('critical')
    expect(indicatorStatus(80, 100)).toBe('alert')
    expect(indicatorStatus(10, 100)).toBe('normal')
    expect(indicatorStatus(null, 100)).toBe('unavailable')
  })

  it('builds the six rows, with sea surface not applicable inland', () => {
    const rows = indicatorRows({ precip24h: 130, wind: 20, soil: 0.3, tempAnomaly: 2.4, seismic: { maxMagnitude: 5.4, place: 'X', distanceKm: 210 }, sst: 29, coastal: false })
    expect(rows.map((r) => r.id)).toEqual(['precip', 'wind', 'soil', 'temp', 'seismic', 'sst'])
    expect(rows.find((r) => r.id === 'precip').status).toBe('critical')
    expect(rows.find((r) => r.id === 'temp').display).toBe('+2.4 °C')
    expect(rows.find((r) => r.id === 'seismic').status).toBe('critical')
    expect(rows.find((r) => r.id === 'sst').status).toBe('na')
  })

  it('summarises seismic activity for the AI prompt', () => {
    expect(seismicSummary({ maxMagnitude: null })).toMatch(/no M2.5\+ earthquake/)
    expect(seismicSummary({ maxMagnitude: 4.62, distanceKm: 180, count: 3 })).toBe(
      'largest M4.6, 180 km from the state centre (3 events M2.5+ in 30 days)',
    )
  })
})

describe('withCache', () => {
  afterEach(() => window.localStorage.clear())

  it('returns live data and keeps it, then falls back to it when the source fails', async () => {
    const live = await withCache('Goa', 'forecast', async () => ({ wind: 12 }))
    expect(live).toMatchObject({ status: 'live', data: { wind: 12 } })
    const cached = await withCache('Goa', 'forecast', async () => {
      throw new Error('HTTP 500')
    })
    expect(cached).toMatchObject({ status: 'cached', data: { wind: 12 }, error: 'HTTP 500' })
    expect(cached.savedAt).toBeTruthy()
  })

  it('reports a failure when nothing is cached', async () => {
    const failed = await withCache('Delhi', 'seismic', vi.fn().mockRejectedValue(new Error('offline')))
    expect(failed).toMatchObject({ status: 'failed', data: null, error: 'offline' })
  })
})

describe('district location', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists districts for every state and UT, "All Districts" first, without duplicates', async () => {
    const { districtsByState, districtsFor, ALL_DISTRICTS } = await import('../data/districtsByState')
    const { INDIA_STATES } = await import('./actionHub')
    expect(Object.keys(districtsByState).sort()).toEqual([...INDIA_STATES].sort())
    Object.values(districtsByState).forEach((list) => {
      expect(list[0]).toBe(ALL_DISTRICTS)
      expect(new Set(list).size).toBe(list.length)
    })
    expect(districtsFor('Atlantis')).toEqual([ALL_DISTRICTS])
  })

  it('uses the state centre for All Districts and a district centre when known', async () => {
    const { resolveLocation } = await import('./prePrediction')
    const all = await resolveLocation({ state: 'Odisha', district: 'All Districts', lat: 20.5, lon: 84.4 })
    expect(all).toMatchObject({ lat: 20.5, lon: 84.4, source: 'state', note: null })
    const puri = await resolveLocation({ state: 'Odisha', district: 'Puri', lat: 20.5, lon: 84.4 })
    expect(puri.source).toBe('district')
    expect(puri.lat).toBeCloseTo(19.83, 1)
    // A renamed district goes through its census spelling (Kutch → Kachchh).
    expect((await resolveLocation({ state: 'Gujarat', district: 'Kutch', lat: 0, lon: 0 })).source).toBe('district')
  })

  it('geocodes a new district inside its state only, and falls back to the state centre', async () => {
    const { resolveLocation } = await import('./prePrediction')
    const fetchMock = vi.fn(async (url) => {
      const name = new URL(url).searchParams.get('name')
      const results =
        name === 'Vijayawada'
          ? [
              { name: 'Vijayawada', admin1: 'Uttar Pradesh', latitude: 1, longitude: 1 },
              { name: 'Vijayawada', admin1: 'Andhra Pradesh', latitude: 16.5, longitude: 80.6 },
            ]
          : [{ name, admin1: 'Uttar Pradesh', latitude: 27, longitude: 79 }]
      return { ok: true, json: async () => ({ results }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const ntr = await resolveLocation({ state: 'Andhra Pradesh', district: 'NTR', lat: 15.9, lon: 79.6 })
    expect(ntr).toMatchObject({ lat: 16.5, lon: 80.6, source: 'geocoded', label: 'NTR (geocoded via Vijayawada)' })
    const lost = await resolveLocation({ state: 'Andhra Pradesh', district: 'Nowhere', lat: 15.9, lon: 79.6 })
    expect(lost).toMatchObject({ lat: 15.9, lon: 79.6, source: 'state' })
    expect(lost.note).toMatch(/could not be located/)
  })
})
