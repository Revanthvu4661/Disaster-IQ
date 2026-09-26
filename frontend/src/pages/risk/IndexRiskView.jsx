import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Info, XCircle } from 'lucide-react'
import { api } from '../../api/client'
import { useApi } from '../../hooks/useApi'
import { useSectionInView } from '../../hooks/useSectionInView'
import SourceBadge from '../../components/SourceBadge'
import SortableTable from '../../components/SortableTable'
import ChartCard from '../../components/ChartCard'
import Deferred from '../../components/Deferred'
import { Block, InfoCard } from '../../components/history/Block'
import { UnavailableList } from '../../components/history/Unavailable'
import { ErrorState, SkeletonCard } from '../../components/ui'
import RiskMap from '../../components/flood/RiskMap'
import { RiskPill } from '../../components/flood/parts'
import { RISK_LEVELS, formatProbability, levelLabel, levelVar } from '../../lib/risk'
import { formatLakh, formatNumber } from '../../lib/format'

const SECTIONS = [
  ['risk-map', 'Risk by state'],
  ['check', 'Check a state'],
  ['method', 'Method and limits'],
]
const SECTION_IDS = SECTIONS.map(([id]) => id)

const WORDS = {
  earthquake: {
    noun: 'earthquake',
    metric: 'M6+ within 300 km',
    eventLabel: 'Earthquakes',
    eventColumns: [
      { key: 'time', label: 'Date' },
      { key: 'magnitude', label: 'Magnitude', numeric: true, render: (r) => `M${r.magnitude.toFixed(1)}` },
      { key: 'place', label: 'Location' },
      { key: 'dist_km', label: 'From boundary', numeric: true, render: (r) => (r.dist_km === 0 ? 'inside' : `${r.dist_km} km`) },
    ],
    source: ['usgs'],
  },
  cyclone: {
    noun: 'cyclone',
    metric: 'storms within 100 km',
    eventLabel: 'Strongest storms',
    eventColumns: [
      { key: 'season', label: 'Season', numeric: true },
      { key: 'name', label: 'Storm' },
      { key: 'max_wind_kt', label: 'Peak wind while near', numeric: true, render: (r) => `${r.max_wind_kt.toFixed(0)} kt` },
      { key: 'min_dist_km', label: 'Closest approach', numeric: true, render: (r) => (r.min_dist_km === 0 ? 'crossed the state' : `${r.min_dist_km} km`) },
    ],
    source: ['ibtracs'],
  },
}

/** 0.15 -> "15%" without floating-point noise. */
const pct = (value) => `${Math.round(value * 1000) / 10}%`

/** "Hurricane-strength…" -> "hurricane-strength…"; keeps "M6.0+ earthquake…" as is. */
const lowerFirst = (text) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text)

const stateWord = (n) => `${n} ${n === 1 ? 'state' : 'states'}`

function headline(hazard, data) {
  const top = data.regions[0]
  const critical = data.counts.critical
  const words = WORDS[hazard]
  const lead = critical
    ? `${stateWord(critical)} at critical ${words.noun} risk`
    : `${stateWord(data.counts.high)} at high ${words.noun} risk`
  return `${lead}; ${top.region} is highest (${formatProbability(top.probability)} a year: ${lowerFirst(top.driver)})`
}

function Counts({ regions }) {
  return (
    <ul className="risk-counts" aria-label="States per risk level">
      {RISK_LEVELS.map((band) => (
        <li key={band.level} style={{ '--level': levelVar(band.level), '--level-soft': levelVar(band.level, true) }}>
          <span className="risk-counts-value">{regions.filter((r) => r.level === band.level).length}</span>
          <span className="risk-counts-label">{band.label}</span>
        </li>
      ))}
    </ul>
  )
}

function keyFacts(hazard, row) {
  if (hazard === 'earthquake') {
    return row.events_m6 === 0
      ? 'none'
      : `${row.events_m6} M6+, ${row.events_m7} M7+; max M${row.max_magnitude.toFixed(1)} (${row.max_year})`
  }
  return row.storms_ts === 0
    ? 'none'
    : `${row.storms_ts} storms, ${row.storms_hurricane} hurricane-strength; max ${row.max_wind_kt.toFixed(0)} kt (${row.max_season})`
}

function MapBlock({ hazard, data, selected, onSelect }) {
  const words = WORDS[hazard]
  const columns = [
    { key: 'region', label: 'State or UT' },
    {
      key: 'probability',
      label: 'Risk',
      numeric: true,
      render: (row) => <RiskPill level={row.level} probability={row.probability} />,
    },
    { key: 'population', label: 'Population (2011)', numeric: true, render: (row) => formatLakh(row.population) },
    { key: 'events', label: `Since ${data.methodology.period[0]}`, sortValue: (row) => row.tests[0].events, render: (row) => keyFacts(hazard, row) },
    {
      key: 'why',
      label: 'Explain',
      sortValue: (row) => row.region,
      render: (row) => (
        <button type="button" className="row-button" onClick={() => onSelect(row.region, true)}>
          Why?
        </button>
      ),
    },
  ]
  return (
    <Block
      id="risk-map"
      index={1}
      title={`${hazard === 'earthquake' ? 'Earthquake' : 'Cyclone'} risk by state`}
      lead={`A statistical hazard index, not a trained model: how often the ${
        hazard === 'earthquake' ? 'USGS catalogue' : 'NOAA IBTrACS tracks'
      } record damaging ${words.noun}s near each state, turned into an annual probability and a risk level. The method and cut-offs are below.`}
    >
      <ChartCard
        headingLevel={3}
        title={headline(hazard, data)}
        insight={`Long-run frequency over ${data.methodology.years} ${hazard === 'earthquake' ? 'years' : 'seasons'} (${data.methodology.period[0]}–${data.methodology.period[1]}); it does not change week to week. Click a state for its explanation.`}
        badge={<SourceBadge kind="index" source={words.source} />}
        footnote={`Population is Census 2011. Probabilities assume events arrive independently at their historical rate; ${data.methodology.record}.`}
        csvRows={data.regions.map((r) => ({
          state: r.region,
          level: r.level,
          annual_probability: r.probability,
          driver: r.driver,
          population_2011: r.population,
          summary: r.summary,
        }))}
        csvName={`${hazard}-risk-by-state.csv`}
      >
        <Counts regions={data.regions} />
        <Deferred height={460}>
          <RiskMap
            area="india"
            rows={data.regions}
            selected={selected}
            onSelect={(name) => onSelect(name, false)}
            height="var(--history-map-height)"
            label={`Map of ${words.noun} risk by state in India`}
            probabilityWord=" a year"
          />
        </Deferred>
      </ChartCard>
      <InfoCard
        title="Every state, highest risk first"
        insight="Sort by any column. “Why?” opens the state in the check below."
        badge={<SourceBadge kind="index" source={words.source} />}
      >
        <SortableTable
          caption={`${words.noun} risk by state`}
          columns={columns}
          rows={data.regions}
          rowKey={(row) => row.region}
          initialSort={{ key: 'probability', dir: 'desc' }}
          rowStyle={(row) => (row.region === selected ? { background: 'var(--surface-hover)' } : undefined)}
        />
      </InfoCard>
    </Block>
  )
}

function CheckBlock({ hazard, data, selected, onSelect }) {
  const words = WORDS[hazard]
  const row = data.regions.find((r) => r.region === selected) ?? data.regions[0]
  const testColumns = [
    { key: 'label', label: 'Test' },
    { key: 'events', label: `Events since ${data.methodology.period[0]}`, numeric: true },
    { key: 'probability', label: 'Annual probability', numeric: true, render: (t) => formatProbability(t.probability) },
    { key: 'level', label: 'Level', render: (t) => <RiskPill level={t.level} compact /> },
    {
      key: 'cutoffs',
      label: 'Cut-offs (medium / high / critical)',
      sortValue: (t) => t.key,
      render: (t) => {
        const spec = data.methodology.tests.find((s) => s.key === t.key).thresholds
        return `${pct(spec.medium)} / ${pct(spec.high)} / ${pct(spec.critical)}`
      },
    },
  ]
  return (
    <Block
      id="check"
      index={2}
      title="Check a specific state"
      lead="Pick a state or union territory to see which test decided its level and the events behind it."
    >
      <InfoCard
        title={`${row.region}: ${levelLabel(row.level).toLowerCase()} ${words.noun} risk, ${formatProbability(row.probability)} a year`}
        insight={row.summary}
        badge={<SourceBadge kind="index" source={words.source} />}
      >
        <div className="check-form">
          <label className="check-field">
            <span className="field-label">State or union territory</span>
            <select className="select" value={row.region} onChange={(event) => onSelect(event.target.value, false)}>
              {[...data.regions]
                .map((r) => r.region)
                .sort()
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="score-head" style={{ '--level': levelVar(row.level), marginTop: 'var(--space-4)' }}>
          <span className="score-prob">{formatProbability(row.probability)}</span>
          <div>
            <RiskPill level={row.level} compact />
            <p className="text-xs secondary" style={{ marginTop: 6 }}>
              Annual chance of {lowerFirst(row.driver)}. This test set the level.
            </p>
          </div>
        </div>
        <p className="field-label" style={{ marginTop: 'var(--space-4)' }}>The two tests</p>
        <SortableTable caption="Hazard tests for this state" columns={testColumns} rows={row.tests} rowKey={(t) => t.key} />
        {row.top_events.length > 0 ? (
          <>
            <p className="field-label" style={{ marginTop: 'var(--space-4)' }}>{words.eventLabel} on record</p>
            <SortableTable
              caption={`${words.eventLabel} near ${row.region}`}
              columns={words.eventColumns}
              rows={row.top_events}
              rowKey={(e, i) => `${e.time ?? e.season}-${e.name ?? e.place}-${i}`}
            />
          </>
        ) : (
          <p className="text-sm secondary" style={{ marginTop: 'var(--space-3)' }}>
            The catalogue records no {hazard === 'earthquake' ? 'M6+ earthquake within 300 km' : 'tropical storm within 100 km'} of {row.region}.
          </p>
        )}
        <p style={{ marginTop: 'var(--space-3)' }}>
          <Link to={`/preparedness?type=${hazard}`} className="inline-link">
            See preparedness and response for {row.region} <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </p>
      </InfoCard>
    </Block>
  )
}

function MethodBlock({ hazard, data }) {
  const m = data.methodology
  const words = WORDS[hazard]
  const cutoffColumns = [
    { key: 'label', label: 'Test' },
    ...['medium', 'high', 'critical'].map((level) => ({
      key: level,
      label: levelLabel(level),
      numeric: true,
      render: (t) => `≥ ${pct(t.thresholds[level])} a year`,
    })),
  ]
  const checkColumns = [
    { key: 'name', label: 'Known event' },
    { key: 'region', label: 'State' },
    { key: 'year', label: 'Year', numeric: true },
    {
      key: 'found',
      label: 'In the data?',
      render: (c) => (
        <span className="check-result">
          {c.found ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
          {c.found ? 'Yes' : 'No'}
        </span>
      ),
    },
    { key: 'detail', label: 'What the catalogue holds' },
  ]
  return (
    <Block
      id="method"
      index={3}
      title="Method and limits"
      lead="How the index is computed, where every cut-off comes from, and what it does not account for."
    >
      <InfoCard title="This is a statistical index, not a trained model" insight={m.statement} badge={<SourceBadge kind="index" source={words.source} />}>
        <ol className="formula-list">
          {m.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="field-label" style={{ marginTop: 'var(--space-4)' }}>Cut-offs</p>
        <SortableTable caption="Risk level cut-offs" columns={cutoffColumns} rows={m.tests} rowKey={(t) => t.key} />
        <p className="card-footnote" style={{ marginTop: 'var(--space-3)' }}>
          annual probability = 1 − exp(−events ÷ {m.years} {hazard === 'earthquake' ? 'years' : 'seasons'}). The cut-offs are
          return-period judgements (for example “about once in 7 years”), not calibrated to losses. A state’s level is the
          higher of the two tests. {formatNumber(data.regions.length)} regions; population from the Census of India 2011.
        </p>
      </InfoCard>
      <InfoCard
        title={`Sanity check: known ${hazard === 'earthquake' ? 'earthquakes' : 'cyclones'} are in the data`}
        insight="Each event should be found near the state it hit. This checks the catalogue and the distance calculation, not the risk level."
        badge={<SourceBadge source={words.source} />}
      >
        <SortableTable caption="Known events" columns={checkColumns} rows={data.checks} rowKey={(c) => c.name} />
      </InfoCard>
      <InfoCard title="What the index does not account for" badge={<SourceBadge kind="index" />}>
        <UnavailableList items={data.not_included} title="Not included" />
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link to={`/preparedness?type=${hazard}`} className="inline-link">
            Next: preparedness and response for {words.noun} risk <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </p>
      </InfoCard>
    </Block>
  )
}

/**
 * Level 2 for earthquakes and cyclones: a statistical hazard index per Indian
 * state, presented like the flood model (same levels, map and table), with its
 * methodology stated plainly.
 */
export default function IndexRiskView({ hazard }) {
  const { data, error, loading, reload } = useApi(() => api.hazardRisk(hazard), [hazard])
  const [selected, setSelected] = useState(null)
  const inView = useSectionInView(SECTION_IDS, Boolean(data) && !loading)

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <SkeletonCard height={420} />

  const onSelect = (name, scroll) => {
    setSelected(name)
    if (scroll) document.getElementById('check')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <p className="callout callout-warn">
        <Info size={16} aria-hidden="true" />
        <span>
          <strong>{hazard === 'earthquake' ? 'Earthquake' : 'Cyclone'} risk here is a statistical index, not a trained model.</strong>{' '}
          It counts what the historical catalogue records near each state; it cannot say when the next event will happen.
          For warnings, follow {hazard === 'earthquake' ? 'NCS (National Center for Seismology)' : 'IMD'} bulletins.
        </span>
      </p>
      <nav className="block-nav" aria-label="Sections on this page">
        <ol>
          {SECTIONS.map(([id, text], index) => (
            <li key={id}>
              <a href={`#${id}`} aria-current={inView === id ? 'location' : undefined}>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span> {text}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <MapBlock hazard={hazard} data={data} selected={selected} onSelect={onSelect} />
      <CheckBlock hazard={hazard} data={data} selected={selected} onSelect={onSelect} />
      <MethodBlock hazard={hazard} data={data} />
    </>
  )
}
