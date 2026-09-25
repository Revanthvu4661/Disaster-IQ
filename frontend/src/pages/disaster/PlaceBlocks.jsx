import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import ChartCard from '../../components/ChartCard'
import SourceBadge from '../../components/SourceBadge'
import SortableTable from '../../components/SortableTable'
import BarList from '../../components/charts/BarList'
import { ScatterLog } from '../../components/charts/LazyCharts'
import Deferred from '../../components/Deferred'
import { Block, InfoCard } from '../../components/history/Block'
import HistoryMap from '../../components/history/HistoryMap'
import { UnavailableList } from '../../components/history/Unavailable'
import { disasterHex } from '../../config/disasterTypes'
import { useTheme } from '../../context/ThemeContext'
import { CurrencyNote, Inr } from '../../components/Inr'
import { formatCompact1, formatINR, formatNumber } from '../../lib/format'
import { strength } from '../../lib/history'

const MAP_METRICS = [
  { key: 'deaths', label: 'Deaths', format: formatNumber, short: formatCompact1 },
  { key: 'total_affected', label: 'People affected', format: formatNumber, short: formatCompact1 },
  { key: 'damages_inr', label: 'Economic loss', format: formatINR, short: formatINR, money: true },
]

/** Table cell for a metric; money gets the ₹ figure with its US$ and fallback tooltip. */
const renderMetric = (meta, row) =>
  meta.money ? (
    <Inr value={row.damages_inr} usd={row.damages_nominal_usd} estimated={row.fx_estimated} />
  ) : (
    meta.format(row[meta.key])
  )

const METRIC_WORDS = {
  deaths: 'deaths',
  total_affected: 'people affected',
  damages_inr: "economic loss (₹ at each year's exchange rate)",
}

const POINT_RADIUS = {
  magnitude: (value) => 2 + (value - 7) * 5,
  max_wind_kt: (value) => 2 + (value - 96) / 12,
}

function TopCountries({ type, rows, metric, title, source = 'emdat' }) {
  const meta = MAP_METRICS.find((item) => item.key === metric)
  const color = `var(--dt-${type.id})`
  return (
    <ChartCard
      headingLevel={3}
      title={title}
      insight={`Top ${rows.length} countries by ${METRIC_WORDS[metric]}, summed over all their records.`}
      badge={<SourceBadge source={source} />}
      footnote={meta.money ? <CurrencyNote /> : undefined}
      empty={rows.length === 0}
      tableColumns={[
        { key: 'country', label: 'Country' },
        { key: metric, label: meta.label, render: (row) => renderMetric(meta, row) },
        { key: 'records', label: 'Records' },
      ]}
      tableRows={rows.map((row) => ({ ...row, id: row.country }))}
      csvRows={rows}
      csvName={`${type.id}-top-${metric}.csv`}
    >
      <BarList
        ariaLabel={title}
        color={color}
        labelWidth="10rem"
        rows={rows.map((row) => ({
          key: row.country,
          label: row.country,
          value: row[metric],
          display: `${meta.short(row[metric])}${meta.money && row.fx_estimated ? '*' : ''}`,
          secondary: `${row.records} yr`,
        }))}
      />
    </ChartCard>
  )
}

/** 04 · Geographic analysis: choropleth (+ points where they exist) and top countries. */
export function GeographyBlock({ type, data }) {
  const { geography } = data
  const { theme } = useTheme()
  const [metric, setMetric] = useState('deaths')
  const [showPoints, setShowPoints] = useState(true)
  const hex = disasterHex(type.id, theme)
  const meta = MAP_METRICS.find((item) => item.key === metric)
  const label = type.label.toLowerCase()
  const points = geography.points

  const choropleth = useMemo(
    () => ({
      key: metric,
      label: `${meta.label} per country, all years`,
      format: meta.short,
      values: Object.fromEntries(
        geography.choropleth.filter((row) => row.iso3).map((row) => [row.iso3, row[metric]]),
      ),
    }),
    [geography.choropleth, metric, meta],
  )

  const markers = useMemo(() => {
    if (!points.available || !showPoints) return []
    const radius = POINT_RADIUS[points.size_by]
    return points.points.map(([latitude, longitude, value, year, title], index) => ({
      id: `${index}`,
      latitude,
      longitude,
      radius: Math.max(2, radius(value)),
      title: points.size_by === 'magnitude' ? `M${value.toFixed(1)} · ${title} · ${year}` : `${title} · ${value} kt`,
    }))
  }, [points, showPoints])

  const precision =
    geography.precision === 'point'
      ? `Shading: country totals from EM-DAT. Dots: ${points.count.toLocaleString()} ${points.filter} from ${points.source.name}, at their exact positions.`
      : 'Country-level data. EM-DAT via OWID records country totals, not event locations, so this map shades whole countries and cannot show where within a country the damage occurred.'

  return (
    <Block id="geography" index={5} title="Geographic analysis" lead={precision}>
      <ChartCard
        headingLevel={3}
        title={`${formatNumber(geography.countries_affected)} countries have at least one recorded ${label} record; ${geography.top_deaths[0]?.country ?? '—'} has the highest death toll`}
        insight={`Map: ${METRIC_WORDS[metric]} per country, darker for more (log scale). Countries with no record stay unshaded.`}
        badge={<SourceBadge source={points.available ? ['emdat', points.source.id] : 'emdat'} />}
        controls={
          <>
            <div className="seg" role="group" aria-label="Map metric">
              {MAP_METRICS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="seg-btn"
                  aria-pressed={metric === item.key}
                  onClick={() => setMetric(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {points.available && (
              <label className="check">
                <input type="checkbox" checked={showPoints} onChange={(event) => setShowPoints(event.target.checked)} />
                {points.size_by === 'magnitude' ? 'M7+ epicentres (USGS)' : 'Category 3+ cyclones (IBTrACS)'}
              </label>
            )}
          </>
        }
        footnote={
          <>
            {geography.historical_states.length > 0 &&
              `Not mapped: ${geography.historical_states.map((row) => row.country).join(', ')} (states that no longer exist), which EM-DAT keeps as recorded. They are in the table and rankings. `}
            <CurrencyNote />
          </>
        }
        tableColumns={[
          { key: 'country', label: 'Country' },
          { key: 'deaths', label: 'Deaths', render: (row) => formatNumber(row.deaths) },
          { key: 'total_affected', label: 'Affected', render: (row) => formatNumber(row.total_affected) },
          {
            key: 'damages_inr',
            label: 'Loss (₹, rate of each year)',
            render: (row) => <Inr value={row.damages_inr} usd={row.damages_nominal_usd} estimated={row.fx_estimated} />,
          },
          { key: 'records', label: 'Records' },
        ]}
        tableRows={[...geography.choropleth, ...geography.historical_states]
          .sort((a, b) => b[metric] - a[metric])
          .map((row) => ({ ...row, id: row.country }))}
        csvRows={[...geography.choropleth, ...geography.historical_states]}
        csvName={`${type.id}-countries.csv`}
      >
        <Deferred height={420}>
          <HistoryMap
            choropleth={choropleth}
            points={markers}
            color={hex}
            height="var(--history-map-height)"
            label={`Map of ${label} ${METRIC_WORDS[metric]} by country`}
          />
        </Deferred>
        <UnavailableList items={geography.unavailable} />
      </ChartCard>

      <TopCountries
        type={type}
        rows={geography.top_affected}
        metric="total_affected"
        title={`${geography.top_affected[0]?.country ?? '—'} has the most people affected by ${label}s: ${formatCompact1(geography.top_affected[0]?.total_affected)}`}
      />
      <TopCountries
        type={type}
        rows={geography.top_deaths}
        metric="deaths"
        title={`${geography.top_deaths[0]?.country ?? '—'} has the highest recorded ${label} death toll: ${formatNumber(geography.top_deaths[0]?.deaths)}`}
      />
      <TopCountries
        type={type}
        rows={geography.top_loss}
        metric="damages_inr"
        title={
          geography.top_loss.length
            ? `${geography.top_loss[0].country} has the highest recorded ${label} losses: ${formatINR(geography.top_loss[0].damages_inr)}`
            : 'No economic losses recorded'
        }
      />
    </Block>
  )
}

/** A ranked table of records by Severity Index; shared with the Overview. */
export function SeverityTable({ rows, showType = false, types, caption }) {
  const columns = [
    { key: 'rank', label: '#', numeric: true, defaultDir: 'asc' },
    ...(showType
      ? [{ key: 'type', label: 'Type', render: (row) => types?.[row.type]?.label ?? row.type }]
      : []),
    { key: 'country', label: 'Country' },
    { key: 'year', label: 'Year', numeric: true },
    { key: 'deaths', label: 'Deaths', numeric: true, render: (row) => formatNumber(row.deaths) },
    { key: 'total_affected', label: 'Affected', numeric: true, render: (row) => formatCompact1(row.total_affected) },
    {
      key: 'damages_inr',
      label: 'Loss (₹)',
      numeric: true,
      render: (row) =>
        row.damages_inr > 0 ? (
          <Inr value={row.damages_inr} usd={row.damages_nominal_usd} estimated={row.fx_estimated} />
        ) : (
          <span className="muted">not reported</span>
        ),
    },
    {
      key: 'score',
      label: 'Severity',
      numeric: true,
      render: (row) => (
        <span className="score">
          <span className="score-bar" aria-hidden="true">
            <span style={{ width: `${row.score}%`, background: `var(--dt-${row.type})` }} />
          </span>
          <span className="mono">{row.score.toFixed(1)}</span>
        </span>
      ),
    },
  ]
  return (
    <SortableTable
      columns={columns}
      rows={rows.map((row, index) => ({ ...row, rank: index + 1, id: `${row.type}-${row.country}-${row.year}` }))}
      caption={caption}
      initialSort={{ key: 'rank', dir: 'asc' }}
    />
  )
}

/** 05 · Severity analysis: the ranked table and the method behind the score. */
export function SeverityBlock({ type, data }) {
  const { severity } = data
  const top = severity.top[0]
  const label = type.label.toLowerCase()
  return (
    <Block
      id="severity"
      index={6}
      title="Severity analysis"
      lead={`Severity Index (0–100), ranked within the ${formatNumber(severity.population)} ${label} records.`}
    >
      <InfoCard
        title={
          top
            ? `The most severe ${label} record: ${top.country}, ${top.year} (score ${top.score.toFixed(1)})`
            : 'No records'
        }
        insight={`${formatNumber(top?.deaths)} deaths, ${formatCompact1(top?.total_affected)} people affected${top?.damages_inr > 0 ? `, ${formatINR(top.damages_inr)} in damages at ${top.year}'s exchange rate` : ''}. A record is one country's total for this disaster type in one year.`}
        badge={<SourceBadge source="emdat" />}
      >
        <SeverityTable rows={severity.top} caption={`Most severe ${label} records`} />
        <p className="text-xs muted" style={{ marginTop: 'var(--space-2)' }}>
          <CurrencyNote />
        </p>
        <details className="definitions">
          <summary>
            <Info size={13} aria-hidden="true" /> How the Severity Index is computed
          </summary>
          <p className="text-sm secondary">{severity.method}</p>
          <p className="text-xs muted">
            Weights: deaths {severity.weights.deaths * 100}% · people affected{' '}
            {severity.weights.total_affected * 100}% · economic loss {severity.weights.damages_usd * 100}%.
          </p>
        </details>
      </InfoCard>
    </Block>
  )
}

const PAIR_LABELS = {
  deaths: 'Deaths',
  total_affected: 'People affected',
  damages_inr: 'Economic loss (₹)',
}

const PAIR_FORMAT = {
  deaths: formatCompact1,
  total_affected: formatCompact1,
  damages_inr: formatINR,
}

/** 07 · Correlation analysis: three log-log scatters, each with r, ρ and n. */
export function CorrelationBlock({ type, data }) {
  const { correlation } = data
  const color = `var(--dt-${type.id})`
  return (
    <Block id="correlation" index={8} title="Correlation analysis" lead={correlation.method}>
      {correlation.pairs.map((pair) => {
        const x = PAIR_LABELS[pair.x]
        const y = PAIR_LABELS[pair.y]
        const enough = typeof pair.pearson_log === 'number'
        const title = enough
          ? `${y} and ${x.toLowerCase()} show ${strength(pair.pearson_log)} ${pair.pearson_log >= 0 ? 'positive' : 'negative'} relationship (r = ${pair.pearson_log.toFixed(2)})`
          : `${y} vs ${x.toLowerCase()}: too few records to measure`
        return (
          <ChartCard
            key={`${pair.x}-${pair.y}`}
            headingLevel={3}
            title={title}
            insight={
              enough
                ? `Pearson r on log values = ${pair.pearson_log.toFixed(2)}; Spearman ρ = ${pair.spearman.toFixed(2)}; n = ${formatNumber(pair.n)} records that report both.`
                : `Only ${pair.n} records report both.`
            }
            badge={<SourceBadge source="emdat" />}
            empty={!enough}
            emptyMessage="Fewer than three records report both figures."
            footnote={pair.y === 'damages_inr' || pair.x === 'damages_inr' ? <CurrencyNote /> : undefined}
            tableColumns={[
              { key: 'country', label: 'Country' },
              { key: 'year', label: 'Year' },
              { key: 'x', label: x, render: (row) => PAIR_FORMAT[pair.x](row.x) },
              { key: 'y', label: y, render: (row) => PAIR_FORMAT[pair.y](row.y) },
            ]}
            tableRows={pair.points.map(([px, py, country, year]) => ({ id: `${country}-${year}`, x: px, y: py, country, year }))}
            csvRows={pair.points.map(([px, py, country, year]) => ({ country, year, [pair.x]: px, [pair.y]: py }))}
            csvName={`${type.id}-${pair.y}-vs-${pair.x}.csv`}
          >
            <Deferred height={300}>
              <ScatterLog
                points={pair.points}
                xLabel={x}
                yLabel={y}
                color={color}
                height={300}
                formatX={PAIR_FORMAT[pair.x]}
                formatY={PAIR_FORMAT[pair.y]}
              />
            </Deferred>
          </ChartCard>
        )
      })}
    </Block>
  )
}

/** 08 · Recovery & resilience: stated as unavailable, not charted. */
export function RecoveryBlock({ type, data }) {
  const { recovery } = data
  const { reconstruction: recon, resilience } = recovery
  const label = type.noun[1]
  const verdict = resilience.verdict
  const decadeColumns = [
    { key: 'decade', label: 'Decade', render: (row) => `${row.decade}s${row.partial ? ' (to date)' : ''}` },
    {
      key: 'deaths_per_1000',
      label: 'Deaths per 1,000 affected',
      numeric: true,
      render: (row) => (row.deaths_per_1000 === null ? '—' : row.deaths_per_1000.toFixed(2)),
    },
    { key: 'records_with_both', label: 'Records', numeric: true },
    {
      key: 'median_damage_pct_gdp',
      label: 'Median damage, % of GDP',
      numeric: true,
      render: (row) => (row.median_damage_pct_gdp === null ? '—' : `${row.median_damage_pct_gdp.toFixed(3)}%`),
    },
  ]
  return (
    <Block
      id="recovery"
      index={9}
      title="Recovery & resilience"
      lead="What EM-DAT records about rebuilding, and how outcomes have changed since 1980. It has no recovery timeline, so none is shown."
    >
      <InfoCard
        title={
          recon.records
            ? `Only ${formatNumber(recon.records)} of ${formatNumber(recon.of_records)} ${label} records report a reconstruction cost: ${formatINR(recon.total_inr)} in total`
            : `No ${type.noun[0]} record reports a reconstruction cost`
        }
        insight={
          recon.share_of_damage !== null && recon.share_of_damage !== undefined
            ? `On the ${formatNumber(recon.share_records)} records that report both, reconstruction cost was ${(recon.share_of_damage * 100).toFixed(0)}% of the recorded damage.`
            : undefined
        }
        badge={<SourceBadge source="emdat" />}
      >
        {recon.top.length > 0 && (
          <SortableTable
            caption="Records with a reported reconstruction cost"
            columns={[
              { key: 'country', label: 'Country' },
              { key: 'year', label: 'Year', numeric: true },
              {
                key: 'reconstruction_inr',
                label: 'Reconstruction (₹)',
                numeric: true,
                render: (row) => (
                  <Inr value={row.reconstruction_inr} usd={row.reconstruction_nominal_usd} estimated={row.fx_estimated} />
                ),
              },
              {
                key: 'damages_inr',
                label: 'Damage (₹)',
                numeric: true,
                render: (row) =>
                  row.damages_inr > 0 ? (
                    <Inr value={row.damages_inr} usd={row.damages_nominal_usd} estimated={row.fx_estimated} />
                  ) : (
                    <span className="muted">not reported</span>
                  ),
              },
            ]}
            rows={recon.top}
            rowKey={(row) => `${row.country}-${row.year}`}
            initialSort={{ key: 'reconstruction_inr', dir: 'desc' }}
          />
        )}
        <p className="card-footnote" style={{ marginTop: 'var(--space-3)' }}>
          Largest five shown. <CurrencyNote />
        </p>
      </InfoCard>

      <InfoCard
        title={
          verdict
            ? `Deaths per 1,000 people affected: ${verdict.first.toFixed(2)} in the ${verdict.first_decade}s, ${verdict.last.toFixed(2)} in the ${verdict.last_decade}s`
            : 'Resilience indicators by decade'
        }
        insight="An outcome indicator: how many of the people a disaster affected died, and how large the damage was against the country's economy."
        badge={<SourceBadge source={['emdat', 'emdat_wdi']} />}
      >
        <SortableTable
          caption="Resilience indicators by decade"
          columns={decadeColumns}
          rows={resilience.decades}
          rowKey={(row) => row.decade}
          initialSort={{ key: 'decade', dir: 'asc' }}
        />
        <p className="card-footnote" style={{ marginTop: 'var(--space-3)' }}>
          {recovery.method} A handful of catastrophic records can dominate a decade.
        </p>
      </InfoCard>

      <InfoCard title="Not in the data" badge={<SourceBadge source="emdat" />}>
        <UnavailableList items={recovery.unavailable} title="Not available" />
      </InfoCard>
    </Block>
  )
}
