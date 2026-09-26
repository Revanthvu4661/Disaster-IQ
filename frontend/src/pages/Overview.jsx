import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, History } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { downSources, isIncomplete, useLiveSummary } from '../hooks/useLive'
import { DISASTER_TYPES, disasterVar, getDisasterType } from '../config/disasterTypes'
import { SOURCES } from '../config/sources'
import ChartCard from '../components/ChartCard'
import SourceBadge from '../components/SourceBadge'
import SortableTable from '../components/SortableTable'
import Deferred from '../components/Deferred'
import { SectionHeading } from '../components/DisasterHeader'
import { InfoCard } from '../components/history/Block'
import { YearBars } from '../components/charts/LazyCharts'
import { SeverityTable } from './disaster/PlaceBlocks'
import { ErrorState, Skeleton, SkeletonCard } from '../components/ui'
import {
  formatCompact1,
  formatDecade,
  formatNumber,
  formatRelative,
  formatINR,
  plural,
} from '../lib/format'
import { maxBy, movingAverage, trendStats, trendWords } from '../lib/history'
import { CurrencyNote, Inr } from '../components/Inr'
import { sourceStatusText } from '../components/live/SourceStrip'
import { CardMotif, sourceHazard, sourceServes } from '../components/hazard/OverviewParts'
import '../styles/hazard-themes.css'

const TYPES_BY_ID = Object.fromEntries(DISASTER_TYPES.map((type) => [type.id, type]))
const nounOf = (row) => TYPES_BY_ID[row.id].noun[1]
const capital = (text) => text[0].toUpperCase() + text.slice(1)

/** Live count phrase for one layer: "7 cyclones", "3 floods". */
function livePhrase(type, layer) {
  const [singular, pluralNoun] = type.noun
  if (!layer) return null
  if (layer.status === 'unavailable') return `${type.label} layer unavailable`
  if (isIncomplete(layer) && layer.count === 0) {
    return `${type.label}: ${downSources(layer).join(', ')} down`
  }
  return plural(layer.count, singular, pluralNoun)
}

function DisasterCard({ type, row, layer, liveLoading }) {
  const Icon = type.icon
  return (
    <Link
      to={type.path}
      className="disaster-card"
      data-hazard={type.id}
      style={{ '--dt': disasterVar(type.id) }}
      aria-label={`${type.label}: open page`}
    >
      <CardMotif hazard={type.id} />
      <div className="disaster-card-top">
        <span className="disaster-card-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
      </div>
      <h3 className="disaster-card-title">{type.label}</h3>
      <p className="disaster-card-value">{formatCompact1(row.deaths)}</p>
      <p className="disaster-card-unit">recorded deaths · {formatNumber(row.events)} disasters</p>
      <p className="disaster-card-need">
        <span className="muted">Most severe</span>{' '}
        <strong>
          {row.worst_record.country} {row.worst_record.year}
        </strong>
      </p>
      <div className="disaster-card-live">
        <span className="live-dot" aria-hidden="true" />
        {liveLoading ? (
          <Skeleton height={12} width={80} />
        ) : !layer || (isIncomplete(layer) && layer.count === 0) ? (
          <span className="muted">live: —</span>
        ) : (
          <span>
            {formatNumber(layer.count)}
            {isIncomplete(layer) ? '+' : ''} live now
          </span>
        )}
      </div>
      <span className="disaster-card-go">
        Open
        <ArrowRight size={14} aria-hidden="true" />
      </span>
    </Link>
  )
}

/**
 * The live phrase with its number set apart for display: "13 earthquakes"
 * reads the same, only the figure is larger. A down layer keeps its sentence.
 */
function LiveCount({ type, layer }) {
  const phrase = livePhrase(type, layer)
  const normal = layer && layer.status !== 'unavailable' && !(isIncomplete(layer) && layer.count === 0)
  if (!normal) return <strong>{phrase}</strong>
  const [singular, pluralNoun] = type.noun
  return (
    <strong className="live-count">
      <span className="live-count-n">{formatNumber(layer.count)}</span>{' '}
      <span className="live-count-noun">{layer.count === 1 ? singular : pluralNoun}</span>
    </strong>
  )
}

/**
 * Feed status for the Overview: one segment per live source, tinted toward
 * the hazard it is most associated with. The words are the World Map's
 * ("96 records", "temporarily unavailable"); what each feed serves comes from
 * the live layers.
 */
function StatusStrip({ summary }) {
  const { data, loading } = summary
  return (
    <ul className="ov-status" aria-label="Live feed status">
      {loading && !data && <li className="ov-status-seg">Checking live feeds…</li>}
      {data?.sources.map((source) => (
        <li
          key={source.id}
          className={`ov-status-seg is-${source.status}`}
          data-hazard={sourceHazard(source.id)}
        >
          <span className="ov-status-dot" aria-hidden="true" />
          <strong>{source.name}</strong>
          <span className="ov-status-serves">{sourceServes(source.id, data.layers)}</span>
          <span className="ov-status-text">{sourceStatusText(source)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Hero: the page's title as the eyebrow, the three hazard words large, the
 * page's description, and records / span / types from the real coverage
 * (dashes until the data arrives).
 */
function OverviewHero({ coverage }) {
  const tiles = [
    ['Records', coverage ? formatCompact1(coverage.records) : null],
    ['Span', coverage ? `${coverage.first_year}–${coverage.last_year}` : null],
    ['Types', formatNumber(DISASTER_TYPES.length)],
  ]
  return (
    <header className="ov-hero">
      <div className="ov-hero-text">
        <p className="eyebrow">Three disasters, one view</p>
        <h1 className="ov-title">
          <span data-hazard="earthquake">
            Earth<span className="ov-title-accent">quake</span>
          </span>
          <span className="ov-title-sep" aria-hidden="true">
            ·
          </span>
          <span data-hazard="flood" className="ov-title-accent">
            Flood
          </span>
          <span className="ov-title-sep" aria-hidden="true">
            ·
          </span>
          <span data-hazard="cyclone" className="ov-title-accent">
            Cyclone
          </span>
        </h1>
        <p className="ov-lead">
          What earthquakes, floods and cyclones have cost in lives and money since 1900, recorded by EM-DAT, USGS and
          NOAA, next to what the live feeds report right now.
        </p>
      </div>
      <dl className="hz-readouts ov-stats" aria-label="Coverage">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </header>
  )
}

function LiveStrip({ summary }) {
  const { data, loading, error } = summary
  return (
    <section className="card" aria-labelledby="live-strip-title">
      <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
        <div className="card-heading">
          <h2 className="card-title" id="live-strip-title">
            Being monitored right now
          </h2>
          <p className="card-insight">
            {data
              ? data.sources.every((source) => source.status === 'unavailable')
                ? 'The live feeds could not be reached just now. Historical data below is unaffected.'
                : `Current events per type from ${data.sources.filter((source) => source.status !== 'unavailable').map((source) => source.name).join(', ')}. Updated ${formatRelative(data.fetched_at)}. Live monitoring is separate from the historical records below.`
              : 'Current events per type from the live feeds.'}
          </p>
        </div>
        <div className="card-badge">
          <SourceBadge kind="live" />
        </div>
      </div>
      {loading && <Skeleton height={44} />}
      {error && <ErrorState compact message={error} onRetry={summary.reload} />}
      {data && (
        <ul className="live-strip">
          {DISASTER_TYPES.map((type) => {
            const layer = data.layers[type.id]
            const Icon = type.icon
            const down = layer.status === 'unavailable'
            return (
              <li
                key={type.id}
                data-hazard={type.id}
                style={{ '--dt': disasterVar(type.id) }}
                className={down || isIncomplete(layer) ? 'is-down' : ''}
              >
                <Link to="/map" className="live-strip-item">
                  <span className="live-strip-tile" aria-hidden="true">
                    <Icon size={15} />
                  </span>
                  <span>
                    <LiveCount type={type} layer={layer} />
                    {isIncomplete(layer) && layer.count > 0 && <span className="muted"> · incomplete</span>}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ComparisonTable({ rows, note, coverage }) {
  const deadliest = maxBy(rows, 'deaths')
  const costliest = maxBy(rows, 'damages_inr')
  const frequent = maxBy(rows, 'events')
  const columns = [
    {
      key: 'label',
      label: 'Disaster',
      render: (row) => {
        const type = getDisasterType(row.id)
        const Icon = type.icon
        return (
          <Link to={type.path} className="type-cell" data-hazard={row.id} style={{ '--dt': disasterVar(row.id) }}>
            <span className="type-dot" aria-hidden="true" />
            <Icon size={14} aria-hidden="true" />
            {type.label}
          </Link>
        )
      },
    },
    { key: 'events', label: 'Disasters', numeric: true, render: (row) => formatNumber(row.events) },
    { key: 'deaths', label: 'Deaths', numeric: true, render: (row) => formatNumber(row.deaths) },
    { key: 'total_affected', label: 'Affected', numeric: true, render: (row) => formatCompact1(row.total_affected) },
    {
      key: 'damages_inr',
      label: 'Economic loss (₹)',
      numeric: true,
      render: (row) => <Inr value={row.damages_inr} usd={row.damages_nominal_usd} />,
    },
    { key: 'countries', label: 'Countries', numeric: true },
    {
      key: 'avg_deaths_per_event',
      label: 'Deaths / event',
      numeric: true,
      render: (row) => formatNumber(Math.round(row.avg_deaths_per_event)),
    },
    {
      key: 'avg_loss_per_event_inr',
      label: 'Loss / event',
      numeric: true,
      render: (row) => <Inr value={row.avg_loss_per_event_inr} />,
    },
  ]
  return (
    <InfoCard
      headingLevel={2}
      title={`${capital(nounOf(frequent))} are the most frequent (${formatNumber(frequent.events)} recorded disasters), ${nounOf(deadliest)} the deadliest (${formatCompact1(deadliest.deaths)} deaths), ${nounOf(costliest)} the costliest (${formatINR(costliest.damages_inr)})`}
      insight={`${coverage.first_year}–${coverage.last_year}. ${note} Select a column heading to sort.`}
      badge={<SourceBadge source="emdat" />}
    >
      <SortableTable
        columns={columns}
        rows={rows}
        caption="Disaster-type comparison"
        searchable={false}
        initialSort={{ key: 'deaths', dir: 'desc' }}
      />
      <p className="text-xs muted" style={{ marginTop: 'var(--space-2)' }}>
        <CurrencyNote />
      </p>
    </InfoCard>
  )
}

function GlobalTrend({ trend, coverage }) {
  const yearly = useMemo(() => {
    const rows = movingAverage(trend.yearly, 'deaths', 10)
    return movingAverage(rows, 'damages_inr', 10)
  }, [trend.yearly])
  const color = 'var(--accent)'
  const deadliestDecade = maxBy(trend.decades.filter((row) => row.complete), 'deaths')
  const note = `All three types combined. Line: 10-year trailing average. Shaded: before ${coverage.trend_from}, when far fewer disasters were recorded.`
  return (
    <section className="stack" aria-labelledby="trend-title">
      <SectionHeading
        id="trend-title"
        title="Are disasters getting worse?"
        badge={<SourceBadge source="emdat" />}
      />
      <ChartCard
        headingLevel={3}
        title={`Deaths: ${trendWords(trend.deaths_trend)} since ${coverage.trend_from}. The deadliest complete decade was the ${formatDecade(deadliestDecade.decade)} (${formatCompact1(deadliestDecade.deaths)} deaths)`}
        insight={`${trendStats(trend.deaths_trend)}.`}
        badge={<SourceBadge source="emdat" />}
        footnote={note}
        tableColumns={[
          { key: 'decade', label: 'Decade', render: (row) => formatDecade(row.decade) },
          { key: 'deaths', label: 'Deaths', render: (row) => formatNumber(row.deaths) },
          { key: 'damages_inr', label: 'Loss (₹, rate of each year)', render: (row) => <Inr value={row.damages_inr} /> },
          { key: 'n_events', label: 'Disasters', render: (row) => formatNumber(row.n_events) },
        ]}
        tableRows={trend.decades.map((row) => ({ ...row, id: row.decade }))}
        csvRows={trend.yearly}
        csvName="global-trend.csv"
      >
        <Deferred height={220}>
          <YearBars
            data={yearly}
            valueKey="deaths"
            valueLabel="Deaths"
            color={color}
            height={220}
            average={{ key: 'deaths_avg', label: '10-year average' }}
            shadeBefore={coverage.trend_from}
          />
        </Deferred>
      </ChartCard>
      <ChartCard
        headingLevel={3}
        title={`Economic loss: ${trendWords(trend.loss_trend)} since ${coverage.trend_from} in inflation-adjusted terms; recorded disasters: ${trendWords(trend.events_trend)}`}
        insight={`Bars: ₹ at each year's exchange rate, not adjusted for inflation, so later years look larger partly because prices and the rupee changed. The loss verdict is tested on ${trend.loss_trend.basis ?? 'inflation-adjusted US$'}: ${trendStats(trend.loss_trend)}. Disasters: ${trendStats(trend.events_trend)}. Rising losses partly reflect more assets in harm's way; rising disaster counts partly reflect better reporting.`}
        badge={<SourceBadge source="emdat" />}
        footnote={
          <>
            {note} <CurrencyNote />
          </>
        }
      >
        <Deferred height={220}>
          <YearBars
            data={yearly}
            valueKey="damages_inr"
            valueLabel="Economic loss"
            color={color}
            height={220}
            average={{ key: 'damages_inr_avg', label: '10-year average' }}
            shadeBefore={coverage.trend_from}
            format={formatINR}
          />
        </Deferred>
      </ChartCard>
    </section>
  )
}

function SourcesPanel({ coverage }) {
  const rows = [
    ['emdat', `Deaths, affected, injured, homeless, damages, insured and reconstruction costs, event counts · ${coverage.first_year}–${coverage.last_year}, country × year`],
    ['emdat_wdi', 'Damages as a share of GDP · country × year'],
    ['usgs', 'Earthquake locations, magnitudes and months · M6.0+, 1900 onwards'],
    ['ibtracs', 'Cyclone tracks, peak wind and months · 1980 onwards (satellite era)'],
  ]
  return (
    <InfoCard
      headingLevel={2}
      title="Where every number comes from"
      insight="Floods have no free, reachable event-level source with locations, so their flood geography is country-level. Recovery time, response time, evacuations and sector-by-sector losses are not in any of these sources and are not shown."
      badge={
        <Link to="/about" className="text-link">
          Full data notes <ArrowRight size={14} aria-hidden="true" />
        </Link>
      }
    >
      <dl className="source-dl">
        {rows.map(([id, text]) => (
          <div key={id}>
            <dt>{SOURCES[id].short}</dt>
            <dd className="text-sm secondary">{text}</dd>
          </div>
        ))}
      </dl>
    </InfoCard>
  )
}

export default function Overview() {
  const { data, error, loading, reload } = useApi(() => api.disasterOverview(), [])
  const summary = useLiveSummary()

  // Every state shares this wrapper with the strip and hero first, so they stay
  // mounted when the data arrives. `data-hazard="overview"` selects the
  // blended theme in styles/hazard-themes.css.
  const header = (
    <>
      <StatusStrip summary={summary} />
      <OverviewHero coverage={data?.coverage} />
    </>
  )
  const rootProps = { className: 'stack hazard-page overview-page', 'data-hazard': 'overview' }

  if (loading) {
    return (
      <div {...rootProps}>
        {header}
        <div className="grid grid-disasters">
          {DISASTER_TYPES.map((type) => (
            <SkeletonCard key={type.id} height={80} lines={1} />
          ))}
        </div>
        <SkeletonCard height={300} />
      </div>
    )
  }

  if (error) {
    return (
      <div {...rootProps}>
        {header}
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  const rows = Object.fromEntries(data.comparison.map((row) => [row.id, row]))
  const { coverage } = data

  return (
    <div {...rootProps}>
      {header}
      <p className="callout callout-coverage">
        <History size={16} aria-hidden="true" />
        <span>
          <strong>Coverage.</strong> {coverage.note} {coverage.unit_note}
        </span>
      </p>

      <section aria-labelledby="cards-title" className="stack" style={{ gap: 'var(--space-3)' }}>
        <SectionHeading id="cards-title" title="The three disaster types" badge={<SourceBadge source="emdat" />} />
        <div className="grid grid-disasters">
          {DISASTER_TYPES.map((type) => (
            <DisasterCard
              key={type.id}
              type={type}
              row={rows[type.id]}
              layer={summary.data?.layers?.[type.id]}
              liveLoading={summary.loading}
            />
          ))}
        </div>
      </section>

      <LiveStrip summary={summary} />
      <ComparisonTable rows={data.comparison} note={data.comparison_note} coverage={coverage} />
      <GlobalTrend trend={data.global_trend} coverage={coverage} />

      <InfoCard
        headingLevel={2}
        title={`The most severe record across all three types: ${data.top_severity.top[0].country}, ${data.top_severity.top[0].year} (${TYPES_BY_ID[data.top_severity.top[0].type].label.toLowerCase()})`}
        insight={`Top ${data.top_severity.top.length} of ${formatNumber(data.top_severity.population)} country-year records, scored on one scale across all types (0–100).`}
        badge={<SourceBadge source="emdat" note={data.top_severity.method} />}
      >
        <SeverityTable rows={data.top_severity.top} showType types={TYPES_BY_ID} caption="Most severe records, all types" />
      </InfoCard>

      <SourcesPanel coverage={coverage} />
    </div>
  )
}
