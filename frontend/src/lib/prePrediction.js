/**
 * Pre-Prediction: a short-range risk outlook per hazard for one Indian state.
 *
 *   score = (historical frequency × 0.35 + seasonal factor × 0.25
 *            + live weather anomaly × 0.30 + geographic vulnerability × 0.10) × 100
 *
 * Every factor is 0–1. Historical frequency, the monthly shares behind the
 * seasonal factor, and geographic vulnerability come from the API
 * (/api/pre-prediction/baseline, backend/services/pre_prediction.py). The
 * live anomaly comes from Open-Meteo (weather, sea surface) and USGS (recent
 * earthquakes), fetched here by the page itself.
 *
 * This is a heuristic outlook with fixed weights, not a trained or validated
 * model, and never a warning.
 */
import { distanceKm } from './cycloneZones'
import { INDIA_DISTRICTS } from '../data/indiaDistricts'
import { ALL_DISTRICTS, LOCATION_NAMES } from '../data/districtsByState'

export const HAZARDS = ['flood', 'cyclone', 'earthquake']
export const WEIGHTS = { frequency: 0.35, seasonal: 0.25, anomaly: 0.3, geography: 0.1 }
export const WINDOWS = [7, 30, 90]
/** Open-Meteo forecasts 16 days; after that the outlook uses history and season only. */
export const FORECAST_DAYS = 16
/** Earthquakes have no season: a flat middle value instead of a monthly share. */
export const FLAT_SEASONAL = 0.5
export const SEISMIC_RADIUS_KM = 500

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value))
const isNum = (value) => typeof value === 'number' && Number.isFinite(value)

/** 0–30 low, 31–60 medium, 61–80 high, 81–100 critical. */
export function riskLevel(score) {
  if (score > 80) return 'critical'
  if (score > 60) return 'high'
  if (score > 30) return 'medium'
  return 'low'
}

export function riskScore({ frequency, seasonal, anomaly, geography }) {
  const raw =
    frequency * WEIGHTS.frequency + seasonal * WEIGHTS.seasonal + anomaly * WEIGHTS.anomaly + geography * WEIGHTS.geography
  return Math.round(clamp(raw) * 100)
}

/** A month's share of the state's historical events, relative to its busiest month (0–1). */
export function seasonalFactor(monthlyShare, month) {
  if (!monthlyShare) return FLAT_SEASONAL
  const peak = Math.max(...monthlyShare)
  return peak > 0 ? monthlyShare[month - 1] / peak : 0
}

/** India Meteorological Department seasons. */
export function seasonFor(month) {
  if (month <= 2) return 'Winter'
  if (month <= 5) return 'Pre-monsoon (summer)'
  if (month <= 9) return 'Southwest monsoon'
  return 'Post-monsoon (northeast monsoon)'
}

/** Live anomaly per hazard for one day (0–1). Missing readings count as no anomaly. */
export function anomalies({ precip, soil, wind, sst, coastal, maxMagnitude }) {
  const flood = Math.max(isNum(precip) ? precip / 100 : 0, isNum(soil) ? soil / 0.75 : 0)
  const windPart = isNum(wind) ? wind / 60 : 0
  const fuel = coastal && isNum(sst) ? clamp((sst - 26) / 2) : null
  const cyclone = fuel === null ? windPart : 0.7 * windPart + 0.3 * fuel
  const earthquake = isNum(maxMagnitude) ? (maxMagnitude - 3) / 2 : 0
  return { flood: clamp(flood), cyclone: clamp(cyclone), earthquake: clamp(earthquake) }
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Daily scores over the window: `[{ day, date, flood, cyclone, earthquake, factors }]`.
 * Days 1–16 use that day's forecast; later days have no anomaly (history and season only).
 */
export function dailyScores(baseline, live, start, days) {
  const byDate = new Map((live.daily ?? []).map((day) => [day.date, day]))
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index)
    const month = Number(date.slice(5, 7))
    const weather = index < FORECAST_DAYS ? byDate.get(date) : null
    const anomaly = weather
      ? anomalies({
          precip: weather.precip,
          soil: weather.soil ?? live.soil,
          wind: weather.windMax,
          sst: live.sst,
          coastal: baseline.coastal,
          maxMagnitude: live.maxMagnitude,
        })
      : { flood: 0, cyclone: 0, earthquake: 0 }
    const row = { day: index + 1, date, factors: {} }
    HAZARDS.forEach((hazard) => {
      const h = baseline.hazards[hazard]
      const factors = {
        frequency: h.frequency,
        seasonal: seasonalFactor(h.monthly_share, month),
        anomaly: anomaly[hazard],
        geography: h.geography,
      }
      row.factors[hazard] = factors
      row[hazard] = riskScore(factors)
    })
    return row
  })
}

/** Per hazard, the day with the highest score in the window, and that day's factors. */
export function peakScores(rows) {
  return Object.fromEntries(
    HAZARDS.map((hazard) => {
      const peak = rows.reduce((best, row) => (row[hazard] > best[hazard] ? row : best), rows[0])
      return [hazard, { score: peak[hazard], level: riskLevel(peak[hazard]), date: peak.date, day: peak.day, factors: peak.factors[hazard] }]
    }),
  )
}

/* ── early-warning indicators ──────────────────────────────────────────── */

/** Above the threshold is critical, within 75% of it an alert. */
export function indicatorStatus(value, threshold) {
  if (!isNum(value)) return 'unavailable'
  if (value > threshold) return 'critical'
  if (value >= threshold * 0.75) return 'alert'
  return 'normal'
}

export function indicatorRows({ precip24h, wind, soil, tempAnomaly, seismic, sst, coastal }) {
  const fixed = (value, digits, unit) => (isNum(value) ? `${value.toFixed(digits)}${unit}` : null)
  return [
    { id: 'precip', label: 'Precipitation, last 24 h', value: precip24h, display: fixed(precip24h, 1, ' mm'),
      threshold: 100, thresholdText: '> 100 mm: flood risk' },
    { id: 'wind', label: 'Wind speed (now)', value: wind, display: fixed(wind, 0, ' km/h'),
      threshold: 60, thresholdText: '> 60 km/h: cyclone watch' },
    { id: 'soil', label: 'Soil moisture, top 1 cm', value: soil, display: fixed(soil, 3, ' m³/m³'),
      threshold: 0.75, thresholdText: '> 0.75: flood risk' },
    { id: 'temp', label: 'Temperature anomaly (today)', value: tempAnomaly,
      display: isNum(tempAnomaly) ? `${tempAnomaly >= 0 ? '+' : ''}${tempAnomaly.toFixed(1)} °C` : null,
      threshold: 2, thresholdText: '> +2 °C: elevated risk' },
    { id: 'seismic', label: `Largest earthquake, 30 days, ${SEISMIC_RADIUS_KM} km`, value: seismic?.maxMagnitude ?? (seismic ? 0 : null),
      display: seismic ? (seismic.maxMagnitude ? `M${seismic.maxMagnitude.toFixed(1)}` : 'None M2.5+') : null,
      detail: seismic?.place ? `${seismic.place}, ${seismic.distanceKm} km away` : null,
      threshold: 5, thresholdText: '> M5.0: earthquake alert' },
    { id: 'sst', label: 'Sea surface temperature', value: coastal ? sst : null,
      display: coastal ? fixed(sst, 1, ' °C') : 'Not applicable (no coast)', notApplicable: !coastal,
      threshold: 28, thresholdText: '> 28 °C: cyclone fuel' },
  ].map((row) => ({ ...row, status: row.notApplicable ? 'na' : indicatorStatus(row.value, row.threshold) }))
}

/* ── external APIs (no key) ────────────────────────────────────────────── */

const TIMEOUT_MS = 15_000

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

const mean = (values) => {
  const nums = values.filter(isNum)
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

/** Open-Meteo forecast: current wind and temperature, last-24 h rain, and 16 daily rows. */
export async function fetchForecast(lat, lon, now = new Date()) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    timezone: 'auto',
    past_days: 1,
    forecast_days: FORECAST_DAYS,
    current: 'temperature_2m,wind_speed_10m,precipitation',
    hourly: 'precipitation,soil_moisture_0_to_1cm',
    daily: 'precipitation_sum,wind_speed_10m_max,temperature_2m_mean',
  })
  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`)
  const current = data.current ?? {}
  const hourlyTimes = data.hourly?.time ?? []
  // "Now" in the location's own clock: Open-Meteo gives local times without a zone.
  const nowLocal = current.time ?? new Date(now.getTime() + (data.utc_offset_seconds ?? 0) * 1000).toISOString().slice(0, 16)
  const past = hourlyTimes.map((time, i) => [time, i]).filter(([time]) => time <= nowLocal).slice(-24)
  const precip24h = past.length ? past.reduce((sum, [, i]) => sum + (data.hourly.precipitation[i] ?? 0), 0) : null
  const soilNow = past.length ? data.hourly.soil_moisture_0_to_1cm[past[past.length - 1][1]] ?? null : null
  const soilByDay = new Map()
  hourlyTimes.forEach((time, i) => {
    const day = time.slice(0, 10)
    if (!soilByDay.has(day)) soilByDay.set(day, [])
    soilByDay.get(day).push(data.hourly.soil_moisture_0_to_1cm[i])
  })
  const today = nowLocal.slice(0, 10)
  const daily = (data.daily?.time ?? [])
    .map((date, i) => ({
      date,
      precip: data.daily.precipitation_sum[i],
      windMax: data.daily.wind_speed_10m_max[i],
      tempMean: data.daily.temperature_2m_mean[i],
      soil: mean(soilByDay.get(date) ?? []),
    }))
    .filter((day) => day.date >= today)
  return { today, precip24h, wind: current.wind_speed_10m ?? null, temperature: current.temperature_2m ?? null, soil: soilNow, daily }
}

/** Mean daily temperature for this time of year (±3 days), 2014–2023, from the Open-Meteo archive. */
export async function fetchTemperatureNormal(lat, lon, isoDate) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    start_date: '2014-01-01',
    end_date: '2023-12-31',
    daily: 'temperature_2m_mean',
    timezone: 'auto',
  })
  const data = await fetchJson(`https://archive-api.open-meteo.com/v1/archive?${params}`)
  const target = dayOfYear(isoDate)
  const values = (data.daily?.time ?? [])
    .map((date, i) => [dayOfYear(date), data.daily.temperature_2m_mean[i]])
    .filter(([doy]) => Math.min(Math.abs(doy - target), 365 - Math.abs(doy - target)) <= 3)
    .map(([, value]) => value)
  return { normal: mean(values), years: '2014–2023' }
}

function dayOfYear(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1
}

/** Open-Meteo marine: current sea surface temperature at an open-sea point. */
export async function fetchSeaSurface([lat, lon]) {
  const params = new URLSearchParams({ latitude: lat, longitude: lon, current: 'sea_surface_temperature' })
  const data = await fetchJson(`https://marine-api.open-meteo.com/v1/marine?${params}`)
  return { sst: data.current?.sea_surface_temperature ?? null }
}

/** USGS: M2.5+ earthquakes within 500 km in the last 30 days; the largest one. */
export async function fetchSeismic(lat, lon, now = new Date()) {
  const start = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: start,
    latitude: lat,
    longitude: lon,
    maxradiuskm: SEISMIC_RADIUS_KM,
    minmagnitude: 2.5,
    orderby: 'magnitude',
    limit: 50,
  })
  const data = await fetchJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`)
  const features = data.features ?? []
  const top = features[0]
  if (!top) return { count: 0, maxMagnitude: null, place: null, distanceKm: null, time: null }
  const [qLon, qLat] = top.geometry.coordinates
  return {
    count: features.length,
    maxMagnitude: top.properties.mag,
    place: top.properties.place,
    distanceKm: Math.round(distanceKm(lat, lon, qLat, qLon)),
    time: new Date(top.properties.time).toISOString(),
  }
}

/** One line for the AI prompt: "M4.6, 180 km from the state centre (3 events M2.5+ in 30 days)". */
export function seismicSummary(seismic) {
  if (!seismic) return 'unknown'
  if (!seismic.maxMagnitude) return `no M2.5+ earthquake within ${SEISMIC_RADIUS_KM} km in 30 days`
  return `largest M${seismic.maxMagnitude.toFixed(1)}, ${seismic.distanceKm} km from the state centre (${seismic.count} events M2.5+ in 30 days)`
}

/* ── where the live readings are taken ─────────────────────────────────── */

const normName = (text) =>
  (text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const LOCAL_DISTRICTS = new Map(INDIA_DISTRICTS.map(([district, state, lat, lon]) => [`${normName(state)}|${normName(district)}`, [lat, lon]]))

/** "Kakinada, Andhra Pradesh" for a district, or just the state. */
export const placeLabel = (state, district) => (district && district !== ALL_DISTRICTS ? `${district}, ${state}` : state)

/** Open-Meteo geocoding for one name, keeping only a result inside `state`. */
export async function geocodeInState(name, state) {
  const params = new URLSearchParams({ name, count: 10, language: 'en', countryCode: 'IN', format: 'json' })
  const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
  const want = normName(state)
  const hit = (data.results ?? []).find((place) => {
    const admin = normName(place.admin1)
    return admin === want || admin.includes(want.slice(0, 8)) || want.includes(admin)
  })
  return hit ? { lat: hit.latitude, lon: hit.longitude, name: hit.name } : null
}

/**
 * Where to take the live weather and earthquake readings:
 *   All Districts  the state centre (as before)
 *   a district     its centre from data/indiaDistricts.js, else Open-Meteo
 *                  geocoding of its name (or headquarters town) inside the
 *                  state, else the state centre with a note.
 * District names alone are unreliable for geocoding ("Krishna" finds a
 * village in Uttar Pradesh), so the geocoder only ever accepts a place in the
 * selected state.
 */
export async function resolveLocation({ state, district, lat, lon }) {
  const stateCentre = { lat, lon, label: `${state} (state centre)`, source: 'state', note: null }
  if (!district || district === ALL_DISTRICTS) return stateCentre
  const name = LOCATION_NAMES[state]?.[district] ?? district
  const local = LOCAL_DISTRICTS.get(`${normName(state)}|${normName(name)}`)
  if (local) return { lat: local[0], lon: local[1], label: `${district} (district centre)`, source: 'district', note: null }
  try {
    const place = await geocodeInState(name, state)
    if (place) {
      const via = name === district ? '' : ` via ${name}`
      return { lat: place.lat, lon: place.lon, label: `${district} (geocoded${via})`, source: 'geocoded', note: null }
    }
  } catch {
    // Geocoder down: fall through to the state centre.
  }
  return { ...stateCentre, note: `${district} could not be located, so the state centre is used.` }
}

/* ── last good answer, per region and source ───────────────────────────── */

const cacheKey = (region, source) => `diq:pre-prediction:${region}:${source}`

function readCache(key) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(key, data) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), data }))
  } catch {
    // Private mode or full storage: the page still works, just without a fallback.
  }
}

/**
 * Runs `load`; on success stores the answer, on failure returns the last
 * stored one. `{ data, status: 'live' | 'cached' | 'failed', savedAt, error }`.
 */
export async function withCache(region, source, load) {
  const key = cacheKey(region, source)
  try {
    const data = await load()
    writeCache(key, data)
    return { data, status: 'live', savedAt: null, error: null }
  } catch (error) {
    const hit = readCache(key)
    const message = error?.name === 'AbortError' ? 'timed out' : error?.message || 'failed'
    return hit
      ? { data: hit.data, status: 'cached', savedAt: hit.savedAt, error: message }
      : { data: null, status: 'failed', savedAt: null, error: message }
  }
}
