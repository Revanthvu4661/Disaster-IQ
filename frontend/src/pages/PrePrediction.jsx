import { useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  Search,
  Sparkles,
  Telescope,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { DisasterHeader } from '../components/DisasterHeader'
import SourceBadge from '../components/SourceBadge'
import ChartCard from '../components/ChartCard'
import { Block, InfoCard } from '../components/history/Block'
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from '../components/ui'
import { MultiLines } from '../components/charts/LazyCharts'
import { disasterVar, getDisasterType } from '../config/disasterTypes'
import { formatDay, levelLabel } from '../lib/risk'
import { formatNumber, formatRelative } from '../lib/format'
import {
  FORECAST_DAYS,
  HAZARDS,
  WINDOWS,
  dailyScores,
  fetchForecast,
  fetchSeaSurface,
  fetchSeismic,
  fetchTemperatureNormal,
  indicatorRows,
  peakScores,
  seasonFor,
  seismicSummary,
  withCache,
} from '../lib/prePrediction'
import '../styles/hazard-themes.css'
import '../styles/pre-prediction.css'

const TYPE_OPTIONS = [
  ['all', 'All'],
  ['flood', 'Flood'],
  ['cyclone', 'Cyclone'],
  ['earthquake', 'Earthquake'],
]
const FACTOR_LABEL = { frequency: 'History', seasonal: 'Season', anomaly: 'Live weather', geography: 'Geography' }
const STATUS_LABEL = { critical: 'Critical', alert: 'Alert', normal: 'Normal', unavailable: 'No reading', na: 'Not applicable' }

/** Today in the browser's own calendar (India for this page's users). */
const localToday = () => new Date().toLocaleDateString('en-CA')
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** A warning badge when a feed answered from the browser cache or not at all. */
function FeedStatus({ name, result }) {
  if (!result || result.status === 'live' || result.status === 'na') return null
  const cached = result.status === 'cached'
  return (
    <span className={`pp-feed pp-feed-${cached ? 'cached' : 'failed'}`}>
      <AlertTriangle size={12} aria-hidden="true" />
      {cached ? `${name}: cached ${formatRelative(result.savedAt)}` : `${name}: unavailable, fallback used`}
    </span>
  )
}

function InputPanel({ regions, form, setForm, onSubmit, busy }) {
  return (
    <Block id="pp-input" index={1} title="Choose a region and window" lead="The outlook combines each state's own history with the live weather at its centre.">
      <form
        className="card pp-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <label className="pp-field">
          <span className="field-label">Region (Indian state or UT)</span>
          <select className="select" value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })}>
            {regions.map((item) => (
              <option key={item.region} value={item.region}>
                {item.region}
              </option>
            ))}
          </select>
        </label>
        <label className="pp-field">
          <span className="field-label">Disaster type</span>
          <select className="select" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            {TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="pp-field">
          <span className="field-label">Forecast window</span>
          <select className="select" value={form.days} onChange={(event) => setForm({ ...form, days: Number(event.target.value) })}>
            {WINDOWS.map((value) => (
              <option key={value} value={value}>
                {value} days
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary pp-submit" disabled={busy || !form.region}>
          <Search size={16} aria-hidden="true" />
          {busy ? 'Generating…' : 'Generate Prediction'}
        </button>
      </form>
    </Block>
  )
}

function RiskCard({ hazard, peak, days }) {
  const type = getDisasterType(hazard)
  const Icon = type.icon
  return (
    <article className={`card pp-risk risk-${peak.level}`} data-hazard={hazard} style={{ '--level': `var(--severity-${peak.level})` }}>
      <div className="pp-risk-top">
        <span className="pp-risk-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <h3 className="pp-risk-label">{type.shortLabel} risk</h3>
        <span className="pp-level">{levelLabel(peak.level)}</span>
      </div>
      <p className="pp-risk-score">
        {peak.score}
        <span className="pp-risk-unit">/100</span>
      </p>
      <div className="pp-bar" role="presentation">
        <span style={{ width: `${peak.score}%` }} />
      </div>
      <p className="pp-risk-when">
        Highest on {formatDay(peak.date)} (day {peak.day} of {days})
      </p>
      <dl className="pp-factors">
        {Object.entries(FACTOR_LABEL).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{peak.factors[key].toFixed(2)}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

function RiskCards({ hazards, peaks, days, feeds }) {
  return (
    <Block
      id="pp-cards"
      index={2}
      title="Risk score by hazard"
      lead="The highest daily score in the window. 0–30 low, 31–60 medium, 61–80 high, 81–100 critical."
    >
      <div className="pp-feeds">
        <FeedStatus name="Weather forecast" result={feeds.forecast} />
        <FeedStatus name="Sea surface" result={feeds.sst} />
        <FeedStatus name="Earthquakes" result={feeds.seismic} />
      </div>
      <div className="pp-risk-grid">
        {hazards.map((hazard) => (
          <RiskCard key={hazard} hazard={hazard} peak={peaks[hazard]} days={days} />
        ))}
      </div>
      <details className="definitions">
        <summary>How the score is calculated</summary>
        <p className="text-sm secondary">
          score = (history × 0.35 + season × 0.25 + live weather × 0.30 + geography × 0.10) × 100, each factor 0–1.
        </p>
        <dl>
          <div>
            <dt>History</dt>
            <dd>How often the state has had this hazard, relative to the most-exposed state: flood years in the India Flood Inventory, tropical storms within 100 km (IBTrACS), M6+ earthquakes within 300 km (USGS).</dd>
          </div>
          <div>
            <dt>Season</dt>
            <dd>That day&rsquo;s month&rsquo;s share of the state&rsquo;s past floods or cyclones, relative to its busiest month. Earthquakes have no season, so this is a flat 0.5.</dd>
          </div>
          <div>
            <dt>Live weather</dt>
            <dd>
              Days 1–{FORECAST_DAYS} only, from the Open-Meteo forecast: flood = the higher of rain ÷ 100 mm and soil moisture ÷ 0.75;
              cyclone = wind ÷ 60 km/h (on a coast, 70% wind and 30% sea warmth above 26 °C); earthquake = largest M2.5+ within 500 km in the
              last 30 days, M3 → 0 to M5 → 1. Beyond day {FORECAST_DAYS}, or when a feed fails, it is 0.
            </dd>
          </div>
          <div>
            <dt>Geography</dt>
            <dd>Flood: share of district land below 10 m (50% or more = 1). Cyclone: 1 on a coast, 0.3 inland. Earthquake: largest magnitude recorded nearby, M6 → 0 to M8.5 → 1.</dd>
          </div>
        </dl>
        <p className="text-sm secondary">
          The weights are fixed judgements, not fitted or validated. For calibrated risk levels see Disaster Risk Prediction.
        </p>
      </details>
    </Block>
  )
}

function TrendBlock({ hazards, rows, days }) {
  const data = rows.map((row) => ({ ...row, label: shortDate(row.date) }))
  const series = hazards.map((hazard) => ({ key: hazard, label: getDisasterType(hazard).shortLabel, color: disasterVar(hazard) }))
  const marker = days > FORECAST_DAYS ? { x: data[FORECAST_DAYS - 1].label, label: 'Forecast ends' } : null
  return (
    <Block id="pp-trend" index={3} title="Risk trend over the window" lead="Daily score for each hazard.">
      <ChartCard
        title={`Daily risk score, next ${days} days`}
        insight={
          days > FORECAST_DAYS
            ? `Days 1–${FORECAST_DAYS} use the weather forecast; after that only history and season move the lines.`
            : 'Every day uses the weather forecast for that day.'
        }
        badge={<SourceBadge kind="formula" source={['open_meteo', 'usgs_realtime']} />}
        headingLevel={3}
        tableColumns={[{ key: 'date', label: 'Date' }, ...series.map((item) => ({ key: item.key, label: item.label }))]}
        tableRows={data}
        csvRows={data.map((row) => ({ date: row.date, ...Object.fromEntries(hazards.map((hazard) => [hazard, row[hazard]])) }))}
        csvName="pre-prediction-trend.csv"
      >
        <div className="pp-legend" aria-hidden="true">
          {series.map((item) => (
            <span key={item.key}>
              <i style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
        <MultiLines data={data} xKey="label" series={series} bands={[30, 60, 80]} marker={marker} height={280} />
      </ChartCard>
    </Block>
  )
}

function NarrativeBlock({ narrative, onRetry }) {
  const { status, result, error } = narrative
  const data = result?.data
  return (
    <Block id="pp-ai" index={4} title="AI analyst narrative" lead="Written by Google Gemini from the readings on this page.">
      <section className="card pp-ai">
        <div className="card-header">
          <div className="card-heading">
            <span className="pp-ai-badge">
              <Sparkles size={13} aria-hidden="true" /> AI generated
            </span>
            {data?.overall_risk && <h3 className="card-title">Overall risk: {data.overall_risk}</h3>}
          </div>
          <div className="card-badge">
            <SourceBadge source="gemini" />
          </div>
        </div>
        {status === 'loading' && (
          <div className="stack" style={{ gap: 8 }} role="status" aria-label="Writing the narrative">
            <Skeleton height={14} />
            <Skeleton height={14} />
            <Skeleton height={14} width="70%" />
          </div>
        )}
        {status === 'off' && (
          <p className="callout">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        {status === 'error' && <ErrorState compact message={`The AI narrative failed: ${error}`} onRetry={onRetry} />}
        {data && (
          <>
            {result.status === 'cached' && (
              <p className="pp-feeds">
                <FeedStatus name="AI narrative" result={result} />
              </p>
            )}
            <p className="pp-ai-text">{data.narrative}</p>
            {data.risk_factors.length > 0 && (
              <ul className="pp-tags" aria-label="Risk factors">
                {data.risk_factors.map((factor) => (
                  <li key={factor}>{factor}</li>
                ))}
              </ul>
            )}
            {data.immediate_actions.length > 0 && (
              <>
                <h4 className="pp-subhead">Immediate actions</h4>
                <ul className="pp-actions">
                  {data.immediate_actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </>
            )}
            <dl className="pp-meta">
              <div>
                <dt>Most likely</dt>
                <dd>{data.most_likely_disaster || '—'}</dd>
              </div>
              <div>
                <dt>Affected population (AI estimate)</dt>
                <dd>{data.estimated_affected_population || '—'}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{data.confidence || '—'}</dd>
              </div>
            </dl>
            <p className="card-footnote">
              AI text can be wrong and is not an official forecast. The affected-population figure is the model&rsquo;s own guess, not
              computed from census data. Follow IMD, NCS and your State Disaster Management Authority.
            </p>
          </>
        )}
      </section>
    </Block>
  )
}

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight }
const TREND_WORD = { up: 'more', down: 'fewer', flat: 'the same' }

function HistoryBlock({ hazards, baseline }) {
  const monthNames = baseline.months.map((m) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' }))
  const max = Math.max(1, ...hazards.map((hazard) => baseline.hazards[hazard].history.total))
  return (
    <Block
      id="pp-history"
      index={5}
      title="Same season, last 10 years"
      lead={`Events in ${baseline.region} in ${monthNames.join('–')}, the months this window covers, over each source's last ten years.`}
    >
      <InfoCard
        title={`${baseline.region} in ${monthNames.join('–')}`}
        insight="The arrow compares the last five years with the five before."
        badge={<SourceBadge source={['ifi', 'ibtracs', 'usgs']} />}
      >
        <ul className="pp-history">
          {hazards.map((hazard) => {
            const type = getDisasterType(hazard)
            const h = baseline.hazards[hazard].history
            const Trend = TREND_ICON[h.trend]
            return (
              <li key={hazard} data-hazard={hazard}>
                <span className="pp-history-label">
                  <type.icon size={16} aria-hidden="true" />
                  {type.shortLabel}
                  <span className="text-xs secondary">
                    {h.years[0]}–{h.years[1]}
                  </span>
                </span>
                <span className="pp-history-bar" aria-hidden="true">
                  <span style={{ width: `${(h.total / max) * 100}%` }} />
                </span>
                <span className="pp-history-count">{formatNumber(h.total)}</span>
                <span className={`pp-trend pp-trend-${h.trend}`}>
                  <Trend size={16} aria-hidden="true" />
                  <span className="visually-hidden">Trend: </span>
                  {h.later_5} vs {h.earlier_5}
                  <span className="visually-hidden"> ({TREND_WORD[h.trend]} in the last five years)</span>
                </span>
                <span className="pp-history-source text-xs secondary">{baseline.hazards[hazard].source}</span>
              </li>
            )
          })}
        </ul>
        <p className="card-footnote">
          Cyclones are counted in the month they formed, which can be a few days before they reach the coast. Earthquakes are M6.0 and
          above only, so most states show none.
        </p>
      </InfoCard>
    </Block>
  )
}

function IndicatorsBlock({ rows, feeds }) {
  return (
    <Block id="pp-indicators" index={6} title="Early warning indicators" lead="Live readings at the state centre (sea surface: the open sea off its coast).">
      <InfoCard
        title="Current readings against their thresholds"
        insight="Critical above the threshold, Alert within 75% of it."
        badge={<SourceBadge kind="live" detail="Open-Meteo, USGS" />}
      >
        <div className="pp-feeds">
          <FeedStatus name="Weather" result={feeds.forecast} />
          <FeedStatus name="Temperature normal" result={feeds.normal} />
          <FeedStatus name="Sea surface" result={feeds.sst} />
          <FeedStatus name="Earthquakes" result={feeds.seismic} />
        </div>
        <div className="table-wrap">
          <table className="data pp-table">
            <caption className="visually-hidden">Early warning indicators</caption>
            <thead>
              <tr>
                <th scope="col">Indicator</th>
                <th scope="col">Current value</th>
                <th scope="col">Threshold</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <span className="mono">{row.display ?? '—'}</span>
                    {row.detail && <span className="pp-detail">{row.detail}</span>}
                  </td>
                  <td className="secondary">{row.thresholdText}</td>
                  <td>
                    <span className={`pp-status pp-status-${row.status}`}>{STATUS_LABEL[row.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </InfoCard>
    </Block>
  )
}

/**
 * Pre-Prediction: a short-range outlook for one Indian state, from its own
 * history (API), the season, and live weather and seismic readings the page
 * fetches itself from Open-Meteo and USGS, plus a Gemini narrative through the
 * API. Every live feed falls back to its last good answer in this browser.
 */
export default function PrePrediction() {
  const regionsApi = useApi(() => api.prePredictionRegions(), [])
  const regions = regionsApi.data?.regions ?? []
  const [form, setForm] = useState({ region: 'Odisha', type: 'all', days: 30 })
  const [run, setRun] = useState(null)
  const [narrative, setNarrative] = useState({ status: 'idle' })
  const runId = useRef(0)

  const askNarrative = async (params, live, id) => {
    setNarrative({ status: 'loading' })
    const query = {
      region: params.region,
      season: seasonFor(Number(params.start.slice(5, 7))),
      days: params.days,
      precip: live.precip24h ?? undefined,
      wind: live.wind ?? undefined,
      soil: live.soil ?? undefined,
      seismic: seismicSummary(live.seismic),
    }
    let failure = null
    const result = await withCache(params.region, `narrative:${params.days}`, () =>
      api.prePredictionNarrative(query).catch((error) => {
        failure = error
        throw error
      }),
    )
    if (id !== runId.current) return
    if (result.data) setNarrative({ status: 'done', result })
    else if (failure?.status === 503) setNarrative({ status: 'off', error: failure.message })
    else setNarrative({ status: 'error', error: result.error })
  }

  const generate = async () => {
    const region = regions.find((item) => item.region === form.region)
    if (!region) return
    const id = ++runId.current
    const params = { ...form, start: localToday() }
    setRun({ params, status: 'loading' })
    setNarrative({ status: 'loading' })

    const [baseline, forecast, normal, sst, seismic] = await Promise.all([
      withCache(region.region, `baseline:${params.days}:${params.start}`, () =>
        api.prePredictionBaseline({ region: region.region, days: params.days, start: params.start }),
      ),
      withCache(region.region, 'forecast', () => fetchForecast(region.lat, region.lon)),
      withCache(region.region, 'normal', () => fetchTemperatureNormal(region.lat, region.lon, params.start)),
      region.coastal ? withCache(region.region, 'sst', () => fetchSeaSurface(region.sea_point)) : Promise.resolve({ status: 'na', data: null }),
      withCache(region.region, 'seismic', () => fetchSeismic(region.lat, region.lon)),
    ])
    if (id !== runId.current) return

    const feeds = { forecast, normal, sst, seismic }
    const today = forecast.data?.daily?.[0]
    const tempAnomaly = today?.tempMean != null && normal.data?.normal != null ? today.tempMean - normal.data.normal : null
    const live = {
      daily: forecast.data?.daily ?? [],
      soil: forecast.data?.soil ?? null,
      sst: sst.data?.sst ?? null,
      maxMagnitude: seismic.data?.maxMagnitude ?? null,
      precip24h: forecast.data?.precip24h ?? null,
      wind: forecast.data?.wind ?? null,
      seismic: seismic.data,
    }
    const indicators = indicatorRows({
      precip24h: live.precip24h,
      wind: live.wind,
      soil: live.soil,
      tempAnomaly,
      seismic: seismic.data,
      sst: live.sst,
      coastal: region.coastal,
    })

    if (!baseline.data) {
      setRun({ params, status: 'error', error: baseline.error, feeds, indicators })
      setNarrative({ status: 'idle' })
      return
    }
    const rows = dailyScores(baseline.data, live, params.start, params.days)
    setRun({ params, status: 'done', baseline: baseline.data, baselineFeed: baseline, feeds, rows, peaks: peakScores(rows), indicators })
    askNarrative(params, live, id)
  }

  const hazards = run && run.params.type !== 'all' ? [run.params.type] : HAZARDS
  const busy = run?.status === 'loading'

  return (
    <div className="stack hazard-page overview-page pp-page" data-hazard="overview">
      <DisasterHeader
        type={{
          id: 'overview',
          icon: Telescope,
          label: 'Pre-Prediction',
          definition:
            'A short-range outlook for floods, cyclones and earthquakes in one Indian state: its own history and season, combined with the live weather forecast and recent earthquakes.',
        }}
        eyebrow="Short-range outlook · Indian states"
        badges={
          <>
            <SourceBadge kind="formula" source={['ifi', 'ibtracs', 'usgs']} detail="history" />
            <SourceBadge kind="live" detail="Open-Meteo, USGS" />
          </>
        }
      />
      <p className="callout callout-coverage">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>
          <strong>Heuristic outlook, not a warning.</strong> Fixed weights on history, season and live weather; not a trained or
          validated model. For official alerts follow IMD, NCS and your State Disaster Management Authority.
        </span>
      </p>

      {regionsApi.error ? (
        <ErrorState message={regionsApi.error} onRetry={regionsApi.reload} />
      ) : regionsApi.loading ? (
        <SkeletonCard height={120} lines={2} />
      ) : (
        <InputPanel regions={regions} form={form} setForm={setForm} onSubmit={generate} busy={busy} />
      )}

      {!run && !regionsApi.loading && !regionsApi.error && (
        <EmptyState message="Choose a region, a disaster type and a window, then press Generate Prediction." icon={Telescope} />
      )}

      {run?.status === 'loading' && (
        <div className="stack" role="status" aria-label="Generating the prediction">
          <div className="pp-risk-grid">
            {hazards.map((hazard) => (
              <SkeletonCard key={hazard} height={170} lines={2} />
            ))}
          </div>
          <SkeletonCard height={300} />
          <SkeletonCard height={200} />
          <SkeletonCard height={180} />
          <SkeletonCard height={260} />
        </div>
      )}

      {run?.status === 'error' && (
        <>
          <ErrorState message={`The historical inputs could not be loaded: ${run.error}`} onRetry={generate} />
          <IndicatorsBlock rows={run.indicators} feeds={run.feeds} />
        </>
      )}

      {run?.status === 'done' && (
        <>
          <p className="text-sm secondary pp-showing">
            Showing <strong>{run.params.region}</strong>, {run.params.type === 'all' ? 'all hazards' : getDisasterType(run.params.type).shortLabel.toLowerCase()},{' '}
            {run.params.days} days from {formatDay(run.params.start)} ({seasonFor(Number(run.params.start.slice(5, 7)))}).
            {run.baselineFeed.status === 'cached' && ' Historical inputs from this browser’s cache.'}
          </p>
          <RiskCards hazards={hazards} peaks={run.peaks} days={run.params.days} feeds={run.feeds} />
          <TrendBlock hazards={hazards} rows={run.rows} days={run.params.days} />
          <NarrativeBlock narrative={narrative} onRetry={() => askNarrative(run.params, { ...run.feeds.forecast.data, seismic: run.feeds.seismic.data }, runId.current)} />
          <HistoryBlock hazards={hazards} baseline={run.baseline} />
          <IndicatorsBlock rows={run.indicators} feeds={run.feeds} />
        </>
      )}
    </div>
  )
}
