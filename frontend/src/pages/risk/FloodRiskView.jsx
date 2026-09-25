import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Gauge, Info, RotateCcw } from 'lucide-react'
import { api } from '../../api/client'
import { useApi } from '../../hooks/useApi'
import SourceBadge from '../../components/SourceBadge'
import SortableTable from '../../components/SortableTable'
import ChartCard from '../../components/ChartCard'
import Deferred from '../../components/Deferred'
import { Block, InfoCard } from '../../components/history/Block'
import { UnavailableList } from '../../components/history/Unavailable'
import { ErrorState, SkeletonCard } from '../../components/ui'
import RiskMap from '../../components/flood/RiskMap'
import { FactorBars, RiskPill, ScenarioSwitch, formatFeature } from '../../components/flood/parts'
import { RISK_LEVELS, formatDay, formatProbability, levelLabel, levelVar } from '../../lib/risk'
import { formatNumber, formatPercent } from '../../lib/format'

const SECTIONS = [
  ['risk-map', 'Risk by district'],
  ['check', 'Check a region'],
  ['transparency', 'Model transparency'],
]

const FEATURE_SOURCE = { nasa_power: 'NASA POWER', elevation: 'Copernicus DEM', ifi: 'India Flood Inventory' }

/** One sentence for the map card, from the counts per level. */
function mapHeadline(view, scenario) {
  const counts = Object.fromEntries(RISK_LEVELS.map((band) => [band.level, 0]))
  view.districts.forEach((d) => {
    counts[d.level] += 1
  })
  const raised = counts.critical + counts.high
  if (view.kind === 'backtest') {
    const observed = view.districts.filter((d) => d.observed).length
    const mediumUp = raised + counts.medium
    return `${scenario?.label}: the model rated ${raised} of 14 districts high or critical and ${mediumUp} medium or above; the India Flood Inventory recorded floods in ${observed}`
  }
  if (raised === 0) {
    const low = Math.min(...view.districts.map((d) => d.rain_pct_normal))
    const high = Math.max(...view.districts.map((d) => d.rain_pct_normal))
    return `No district is at high risk: the last 30 days brought ${Math.round(low)}–${Math.round(high)}% of normal rain`
  }
  return `${raised} of 14 districts are at high or critical flood risk; ${view.districts[0].district} is highest at ${formatProbability(view.districts[0].probability)}`
}

function RiskCounts({ districts }) {
  return (
    <ul className="risk-counts" aria-label="Districts per risk level">
      {RISK_LEVELS.map((band) => {
        const count = districts.filter((d) => d.level === band.level).length
        return (
          <li key={band.level} style={{ '--level': levelVar(band.level), '--level-soft': levelVar(band.level, true) }}>
            <span className="risk-counts-value">{count}</span>
            <span className="risk-counts-label">{band.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

function RiskMapBlock({ data, scenario, setScenario, view, viewLoading, viewError, selected, onSelect }) {
  const meta = data.scenarios.find((item) => item.id === scenario)
  const backtest = view?.kind === 'backtest'
  const columns = [
    { key: 'district', label: 'District' },
    {
      key: 'probability',
      label: 'Risk',
      numeric: true,
      render: (row) => <RiskPill level={row.level} probability={row.probability} />,
    },
    { key: 'rain_pct_normal', label: 'Rain vs normal', numeric: true, render: (row) => `${Math.round(row.rain_pct_normal)}%` },
    { key: 'max_3day_rain_mm', label: 'Heaviest 3 days', numeric: true, render: (row) => `${Math.round(row.max_3day_rain_mm)} mm` },
    { key: 'soil_wetness_before', label: 'Soil wetness', numeric: true, render: (row) => row.soil_wetness_before.toFixed(2) },
    ...(backtest
      ? [{ key: 'observed', label: 'IFI recorded', numeric: true, render: (row) => (row.observed ? 'Flood' : 'None') }]
      : []),
    {
      key: 'check',
      label: 'Explain',
      sortValue: (row) => row.district,
      render: (row) => (
        <button type="button" className="row-button" onClick={() => onSelect(row.district, true)}>
          Why?
        </button>
      ),
    },
  ]

  return (
    <Block
      id="risk-map"
      index={1}
      title="Flood risk by district"
      lead="A logistic regression scores each district on the latest 30 days of NASA POWER rainfall and soil moisture, its elevation and its flood history. Switch to a past month to replay it through the model fitted on 1981–2012 only, and compare with what was recorded."
    >
      {viewError ? (
        <ErrorState message={viewError} />
      ) : !view || viewLoading ? (
        <SkeletonCard height={420} />
      ) : (
        <ChartCard
          headingLevel={3}
          title={mapHeadline(view, meta)}
          insight={
            backtest
              ? meta?.note
              : `Window ${formatDay(view.window_start)} to ${formatDay(view.as_of)}, compared with the same dates in 1991–2020. Click a district for its explanation.`
          }
          badge={<SourceBadge kind="model" source={['nasa_power', 'ifi']} />}
          controls={<ScenarioSwitch scenarios={data.scenarios} value={scenario} onChange={setScenario} />}
          footnote={
            backtest
              ? 'Back-test: scored by the model fitted on 1981–2012, which never saw this month. “IFI recorded” is what the India Flood Inventory lists for the district.'
              : `NASA POWER data up to ${formatDay(data.sources.power_last_day)} (about 4 days behind real time). Levels: low < 25%, medium 25–50%, high 50–75%, critical ≥ 75%.`
          }
          csvRows={view.districts.map((d) => ({
            district: d.district,
            level: d.level,
            probability: d.probability,
            rain_pct_normal: d.rain_pct_normal,
            max_3day_rain_mm: d.max_3day_rain_mm,
            soil_wetness_before: d.soil_wetness_before,
            elevation_m: d.elevation_m,
            prior_flood_rate: d.prior_flood_rate,
            ...(backtest ? { ifi_recorded_flood: d.observed } : {}),
          }))}
          csvName={`flood-risk-${scenario}.csv`}
        >
          <RiskCounts districts={view.districts} />
          <Deferred height={460}>
            <RiskMap
              area="kerala"
              rows={view.districts}
              selected={selected}
              onSelect={(name) => onSelect(name, false)}
              height="var(--history-map-height)"
              label="Map of predicted flood risk by district in Kerala"
            />
          </Deferred>
        </ChartCard>
      )}

      {view && !viewLoading && !viewError && (
        <InfoCard
          title="Every district, highest risk first"
          insight="Sort by any column. “Why?” opens the district in the check below with each input’s contribution."
          badge={<SourceBadge kind="model" source={['nasa_power', 'ifi', 'elevation']} />}
        >
          <SortableTable
            caption="Predicted flood risk by district"
            columns={columns}
            rows={view.districts}
            rowKey={(row) => row.district}
            initialSort={{ key: 'probability', dir: 'desc' }}
            rowStyle={(row) => (row.district === selected ? { background: 'var(--surface-hover)' } : undefined)}
          />
        </InfoCard>
      )}
    </Block>
  )
}

const emptyForm = (features) => Object.fromEntries(features.map((f) => [f.key, '']))
const formFor = (features, row) =>
  row ? Object.fromEntries(features.map((f) => [f.key, String(row[f.key])])) : emptyForm(features)

/**
 * The parent remounts this block (via `key`) whenever a district is picked on
 * the map, in the table or in the select, so its state starts from that
 * district's latest 30 days without syncing effects.
 */
function CheckBlock({ data, initialDistrict, onSelect }) {
  const features = data.model.features
  const current = data.current.districts
  const [district, setDistrict] = useState(initialDistrict)
  const [form, setForm] = useState(() => formFor(features, current.find((d) => d.district === initialDistrict)))
  const [request, setRequest] = useState(initialDistrict ? { district: initialDistrict } : null)

  const result = useApi(() => api.floodScore(request ?? {}), [JSON.stringify(request)], { enabled: Boolean(request) })

  const pickDistrict = (name) => {
    if (name === '') {
      setDistrict('')
      setForm(emptyForm(features))
      setRequest(null)
      return
    }
    if (name === initialDistrict) {
      // Same key, so no remount: reload this district here.
      setDistrict(name)
      setForm(formFor(features, current.find((d) => d.district === name)))
      setRequest({ district: name })
      return
    }
    onSelect(name, false)
  }

  const submit = (event) => {
    event.preventDefault()
    const params = district ? { district } : {}
    const base = current.find((d) => d.district === district)
    features.forEach((f) => {
      const raw = form[f.key]
      if (raw === '') return
      const value = Number(raw)
      // Only send what the user changed; the district's own data fills the rest.
      if (!base || Math.abs(value - base[f.key]) > 1e-9) params[f.key] = value
    })
    setRequest(params)
  }

  const reset = () => {
    setForm(formFor(features, current.find((d) => d.district === district)))
    setRequest(district ? { district } : null)
  }

  const custom = district === ''
  const missing = custom && features.some((f) => form[f.key] === '')
  const score = result.data

  return (
    <Block
      id="check"
      index={2}
      title="Check a specific region"
      lead="Pick a district to see its latest 30 days, or change any input, for example the rainfall of a storm you are expecting, and score it again. Choose “Custom” to enter every value yourself."
    >
      <InfoCard
        title="Inputs"
        insight={
          custom
            ? 'Custom conditions: enter all five values.'
            : `Filled with ${district}’s latest 30 days. Change a value and press “Score” to see how the risk moves.`
        }
        badge={<SourceBadge source={['nasa_power', 'elevation', 'ifi']} />}
      >
        <form className="check-form" onSubmit={submit}>
          <label className="check-field">
            <span className="field-label">District</span>
            <select className="select" value={district} onChange={(event) => pickDistrict(event.target.value)}>
              {current
                .map((d) => d.district)
                .sort()
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              <option value="">Custom (no district)</option>
            </select>
          </label>
          {features.map((f) => (
            <label key={f.key} className="check-field">
              <span className="field-label">
                {f.label} <span className="check-unit">({f.unit})</span>
              </span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step="any"
                value={form[f.key]}
                onChange={(event) => setForm((prev) => ({ ...prev, [f.key]: event.target.value }))}
                required={custom}
              />
            </label>
          ))}
          <div className="check-actions">
            <button type="submit" className="btn btn-primary" disabled={missing}>
              <Gauge size={15} aria-hidden="true" />
              Score
            </button>
            {!custom && (
              <button type="button" className="btn" onClick={reset}>
                <RotateCcw size={14} aria-hidden="true" />
                Reset to latest 30 days
              </button>
            )}
          </div>
        </form>
      </InfoCard>

      {result.error ? (
        <ErrorState message={result.error} />
      ) : !request ? (
        <p className="callout">
          <Info size={16} aria-hidden="true" />
          <span>Enter all five values and press “Score”.</span>
        </p>
      ) : result.loading || !score ? (
        <SkeletonCard height={220} />
      ) : (
        <InfoCard
          title={`${score.district ?? 'Custom conditions'}: ${levelLabel(score.level).toLowerCase()} flood risk, ${formatProbability(score.probability)}`}
          insight={score.summary}
          badge={<SourceBadge kind="model" source={['nasa_power', 'ifi']} />}
        >
          <div className="score-head" style={{ '--level': levelVar(score.level) }}>
            <span className="score-prob">{formatProbability(score.probability)}</span>
            <div>
              <RiskPill level={score.level} compact />
              <p className="text-xs secondary" style={{ marginTop: 6 }}>
                Chance that a flood is recorded in a 30-day window like this one.
                {score.overridden.length > 0 && ` Changed by you: ${score.overridden.map((key) => features.find((f) => f.key === key)?.label.toLowerCase()).join(', ')}.`}
              </p>
            </div>
          </div>
          <p className="field-label" style={{ marginTop: 'var(--space-4)' }}>
            What drives it (log-odds against an average district-month)
          </p>
          <FactorBars factors={score.factors} format={(f) => formatFeature(f.key, f.value)} />
          <p className="card-footnote" style={{ marginTop: 'var(--space-3)' }}>
            Each bar is the feature’s coefficient × its standardised value. They add up, with the baseline of{' '}
            {score.baseline_log_odds.toFixed(2)}, to the log-odds {score.log_odds.toFixed(2)}, which is{' '}
            {formatProbability(score.probability)}.
          </p>
          {score.district && (
            <p style={{ marginTop: 'var(--space-3)' }}>
              <Link to="/preparedness?type=flood" className="inline-link">
                See preparedness and response for Kerala <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </p>
          )}
        </InfoCard>
      )}
    </Block>
  )
}

const METRIC_ROWS = [
  ['logistic', 'Logistic regression (served)', 'at 50%'],
  ['logistic_action', 'Logistic regression', 'medium or above (25%)'],
  ['random_forest', 'Random forest (benchmark)', 'at 50%'],
  ['random_forest_action', 'Random forest (benchmark)', 'medium or above (25%)'],
  ['climatology', 'Baseline: district-month flood rate 1981–2012', 'at 50%'],
  ['history_only', 'Baseline: flood history only', 'at 50%'],
  ['always_no_flood', 'Baseline: always “no flood”', '—'],
]

function TransparencyBlock({ data, onShowScenario }) {
  const { model, evaluation: ev, label, kerala_check: kc } = data
  const lr = ev.logistic
  const action = ev.logistic_action
  const metricColumns = [
    { key: 'name', label: 'Model' },
    { key: 'cut', label: 'Counts as flood' },
    { key: 'roc_auc', label: 'ROC AUC', numeric: true, render: (r) => r.roc_auc?.toFixed(3) ?? '—' },
    { key: 'average_precision', label: 'Avg precision', numeric: true, render: (r) => r.average_precision?.toFixed(3) ?? '—' },
    { key: 'accuracy', label: 'Accuracy', numeric: true, render: (r) => r.accuracy.toFixed(3) },
    { key: 'precision', label: 'Precision', numeric: true, render: (r) => r.precision.toFixed(3) },
    { key: 'recall', label: 'Recall', numeric: true, render: (r) => r.recall.toFixed(3) },
    { key: 'f1', label: 'F1', numeric: true, render: (r) => r.f1.toFixed(3) },
  ]
  const metricRows = METRIC_ROWS.map(([key, name, cut]) => ({ id: key, name, cut, ...ev[key] }))
  const featureColumns = [
    { key: 'label', label: 'Input' },
    { key: 'source', label: 'Source', render: (r) => FEATURE_SOURCE[r.source] ?? r.source },
    { key: 'coefficient', label: 'Coefficient', numeric: true, render: (r) => (r.coefficient > 0 ? '+' : '') + r.coefficient.toFixed(3) },
    { key: 'odds_ratio_per_sd', label: 'Odds × per SD', numeric: true, render: (r) => r.odds_ratio_per_sd.toFixed(2) },
    { key: 'mean', label: 'Training mean', numeric: true, render: (r) => formatFeature(r.key, r.mean) },
  ]

  return (
    <Block
      id="transparency"
      index={3}
      title="Model transparency"
      lead="What trained the model, how well it does on years it never saw, where it fails, and what it does not account for."
    >
      <InfoCard
        title={`Trained on ${formatNumber(model.training_rows)} district-months, ${model.training_years[0]}–${model.training_years[1]}`}
        insight={`${model.type}. One row per district and monsoon month (June–September), ${model.districts} districts.`}
        badge={<SourceBadge source={['ifi', 'nasa_power', 'elevation', 'census2011']} />}
      >
        <dl className="answers">
          <div>
            <dt>What it predicts</dt>
            <dd>
              {label.definition} This happened in {formatPercent(label.positive_rate, 0)} of training rows.
            </dd>
          </div>
          <div>
            <dt>Why not the Kerala flood dataset’s flag</dt>
            <dd>
              That dataset has one row per year for the whole state ({kc.first_year}–{kc.last_year}), not districts, and its
              flood flag is almost exactly a cut-off on annual rainfall: every “no” year had at most{' '}
              {formatNumber(kc.label_cutoff.max_no_year_mm)} mm and every “yes” year at least{' '}
              {formatNumber(kc.label_cutoff.min_yes_year_mm)} mm. A model trained on it would only relearn that line. It is
              used below as an independent check instead.
            </dd>
          </div>
          <div>
            <dt>Data fix applied</dt>
            <dd>
              IFI writes some dates month-first: the August 2018 event is stored as 08-01-2018 to 30-08-2018 (30 days). The
              pipeline reads each ambiguous date the way that keeps IFI’s event numbering in date order and matches the
              recorded duration.
            </dd>
          </div>
        </dl>
        <p className="field-label" style={{ marginTop: 'var(--space-4)' }}>Inputs and learned weights</p>
        <SortableTable caption="Model inputs and coefficients" columns={featureColumns} rows={model.features} rowKey={(r) => r.key} />
        <p className="card-footnote" style={{ marginTop: 'var(--space-3)' }}>
          Coefficients are per standard deviation, so they compare directly. Two go against intuition and are shown as
          learned: wetter soil before a window slightly <em>lowers</em> the modelled risk (likely because soil is wettest late
          in the monsoon, when fewer floods are recorded), and higher districts score <em>higher</em>, because the highland
          districts (Idukki, Wayanad) record the most flash floods.
        </p>
      </InfoCard>

      <InfoCard
        title={`On ${ev.split.test[0]}–${ev.split.test[1]}, which it never saw, it ranks flood months above quiet ones ${Math.round(lr.roc_auc * 100)}% of the time`}
        insight={`Fitted on ${ev.split.train[0]}–${ev.split.train[1]} (${formatNumber(ev.train_rows)} rows), scored on ${formatNumber(ev.test_rows)} later rows. At “medium or above” it catches ${formatPercent(action.recall, 0)} of recorded floods with ${formatPercent(action.precision, 0)} precision.`}
        badge={<SourceBadge kind="model" source="ifi" />}
      >
        <SortableTable caption="Model and baseline metrics on the test years" columns={metricColumns} rows={metricRows} rowKey={(r) => r.id} />
        <p className="card-footnote" style={{ marginTop: 'var(--space-3)' }}>
          Floods were recorded in {formatPercent(ev.test_positive_rate, 0)} of test rows but only{' '}
          {formatPercent(ev.train_positive_rate, 0)} of training rows (IFI records more events in recent years), so at the
          50% cut-off the model is cautious: precision {lr.precision.toFixed(2)}, recall {lr.recall.toFixed(2)}. The 25%
          (“medium”) cut-off is the one to act on. The random forest was not better, so the simpler model is served.
        </p>
      </InfoCard>

      <InfoCard
        title="Sanity checks on known floods"
        insight="Each month below is in the test years, scored by the model that never saw it."
        badge={<SourceBadge kind="model" source="ifi" />}
      >
        <dl className="answers">
          {ev.backtest.map((event) => {
            const mediumUp = event.districts.filter((d) => d.level !== 'low').length
            const verdict =
              event.expect === 'quiet'
                ? event.flagged_high === 0
                  ? `Correctly quiet: no district rated high; mean risk ${formatProbability(event.mean_probability)}.`
                  : `False alarm in ${event.flagged_high} districts.`
                : `${event.flagged_high} of 14 rated high or critical, ${mediumUp} medium or above; IFI recorded floods in ${event.observed_floods}.`
            return (
              <div key={`${event.year}-${event.month}`}>
                <dt>
                  {event.name}{' '}
                  <button
                    type="button"
                    className="row-button"
                    onClick={() => onShowScenario(`${event.year}-${String(event.month).padStart(2, '0')}`)}
                  >
                    Show on map
                  </button>
                </dt>
                <dd>
                  {verdict} {event.note}
                  {event.year === 2018 && event.month === 8 &&
                    ' The model under-rates this month: NASA POWER’s coarse grid smooths the extreme local rainfall, and dam releases, which drove much of the flooding, are not an input.'}
                </dd>
              </div>
            )
          })}
        </dl>
      </InfoCard>

      <InfoCard
        title={`Check against the Kerala flood dataset: its flood years score higher (AUC ${kc.auc_vs_kerala_flag?.toFixed(2)})`}
        insight={`Over ${kc.years[0]}–${kc.years[1]}, the model’s statewide average risk ranks the dataset’s ${kc.overlap_years} years by its flood flag with AUC ${kc.auc_vs_kerala_flag?.toFixed(3)}, without ever being trained on that flag.`}
        badge={<SourceBadge source={['kerala_imd', 'nasa_power']} />}
      >
        <dl className="answers">
          <div>
            <dt>Does NASA POWER rainfall match IMD’s gauges?</dt>
            <dd>
              Annual Kerala rainfall correlates at r = {kc.power_vs_imd_r.toFixed(2)} ({kc.years[0]}–{kc.years[1]}). POWER is
              lower on average ({formatNumber(kc.power_mean_mm)} mm against IMD’s {formatNumber(kc.imd_mean_mm)} mm), which is
              why rainfall enters the model as a percentage of each district’s own POWER normal, not in millimetres.
            </dd>
          </div>
        </dl>
      </InfoCard>

      <InfoCard title="What the model does not account for" badge={<SourceBadge kind="model" />}>
        <UnavailableList items={data.not_included} title="Not included" />
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/preparedness?type=flood" className="inline-link">
            Next: turn this risk into preparedness and response actions <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </p>
      </InfoCard>
    </Block>
  )
}

/**
 * Level 2: flood risk per district of Kerala, with a region check and a model
 * card. The page reads /api/flood-risk once; switching to a back-test month
 * reads /api/flood-risk/scenario/{id}.
 */
export default function FloodRiskView() {
  const { data, error, loading, reload } = useApi(() => api.floodRisk(), [])
  const [scenario, setScenario] = useState('current')
  const [selected, setSelected] = useState(null)
  const scenarioApi = useApi(() => api.floodScenario(scenario), [scenario], { enabled: scenario !== 'current' })

  const view = !data ? null : scenario === 'current' ? { kind: 'current', ...data.current } : scenarioApi.data

  const onSelect = (name, scroll) => {
    setSelected(name)
    if (scroll) document.getElementById('check')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const showScenario = (id) => {
    setScenario(id)
    document.getElementById('risk-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading || error) {
    return (
      <>{error ? <ErrorState message={error} onRetry={reload} /> : <SkeletonCard height={420} />}</>
    )
  }

  return (
    <>
      <p className="callout">
        <Info size={16} aria-hidden="true" />
        <span>
          <strong>River-gauge data not available for this build;</strong> risk is estimated from rainfall, soil moisture,
          elevation and historical flood frequency. This is a statistical estimate for planning, not an official warning:
          follow IMD and KSDMA alerts.
        </span>
      </p>

      <nav className="block-nav" aria-label="Sections on this page">
        <ol>
          {SECTIONS.map(([id, text], index) => (
            <li key={id}>
              <a href={`#${id}`}>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span> {text}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <RiskMapBlock
        data={data}
        scenario={scenario}
        setScenario={setScenario}
        view={view}
        viewLoading={scenario !== 'current' && scenarioApi.loading}
        viewError={scenario !== 'current' ? scenarioApi.error : null}
        selected={selected}
        onSelect={onSelect}
      />
      <CheckBlock
        key={selected ?? 'default'}
        data={data}
        initialDistrict={selected ?? data.current.districts[0]?.district ?? ''}
        onSelect={onSelect}
      />
      <TransparencyBlock data={data} onShowScenario={showScenario} />
    </>
  )
}
