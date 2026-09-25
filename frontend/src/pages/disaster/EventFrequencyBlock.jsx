import { useId, useState } from 'react'
import ChartCard from '../../components/ChartCard'
import SourceBadge from '../../components/SourceBadge'
import Deferred from '../../components/Deferred'
import { Block } from '../../components/history/Block'
import { CategoryBars, YearBars } from '../../components/charts/LazyCharts'
import { CalendarHeatmap, YearMonthHeatmap } from '../../components/charts/Heatmap'
import { formatNumber, formatPercent } from '../../lib/format'
import { formatDay } from '../../lib/risk'
import { movingAverage, trendStats, trendWords } from '../../lib/history'

const AVG_WINDOW = 10
const TABS = [
  ['yearly', 'Yearly'],
  ['monthly', 'Monthly'],
  ['daily', 'Daily'],
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "India only" and the like go beside the source name on the badge. */
const badgeFor = (block) => (
  <SourceBadge source={block.source?.id} detail={block.scope === 'India only' ? 'India only' : undefined} />
)

const one = (value, digits = 2) => (typeof value === 'number' ? value.toFixed(digits) : '—')

function unavailableView(name, block, type) {
  return {
    title: `${name} counts: not available`,
    insight: block.reason,
    badge: <SourceBadge source="emdat" />,
    empty: true,
    emptyMessage: block.reason,
    body: null,
    key: type.id,
  }
}

function yearlyView(type, block) {
  const colorFor = (series) => (series.kind === 'physical' ? `var(--dt-${type.id})` : 'var(--text-secondary)')
  const lead = block.series[0]
  const rows = block.series.map((series) => ({ series, rows: movingAverage(series.rows, 'count', AVG_WINDOW) }))
  const years = [...new Set(block.series.flatMap((s) => s.rows.map((r) => r.year)))].sort((a, b) => a - b)
  const table = years.map((year) => ({
    id: year,
    year,
    ...Object.fromEntries(block.series.map((s) => [s.id, s.rows.find((r) => r.year === year)?.count ?? null])),
  }))
  const shaded = block.series.filter((s) => s.poor_before)
  return {
    title: `${lead.label}: ${formatNumber(lead.n_events)} events ${lead.first_year}–${lead.last_year}; since ${block.trend_from} the yearly count shows ${trendWords(lead.trend)}`,
    insight: block.series
      .map((s) => `${s.label}: ${trendWords(s.trend)} since ${block.trend_from}${trendStats(s.trend) ? ` (${trendStats(s.trend)})` : ''}.`)
      .join(' '),
    badge: <SourceBadge source={block.series.map((s) => s.source.id)} />,
    footnote: [
      `Line: ${AVG_WINDOW}-year trailing average.`,
      shaded.length
        ? `Shaded: before ${shaded.map((s) => `${s.poor_before} (${s.source.name})`).join(' and ')}, when recording was poor.`
        : null,
      block.note,
    ]
      .filter(Boolean)
      .join(' '),
    tableColumns: [{ key: 'year', label: 'Year' }, ...block.series.map((s) => ({ key: s.id, label: s.label, render: (r) => (r[s.id] === null ? '—' : formatNumber(r[s.id])) }))],
    tableRows: [...table].reverse(),
    csvRows: table.map((row) => ({ ...row, id: undefined })),
    csvName: `${type.id}-event-frequency-yearly.csv`,
    body: (
      <div className="event-series">
        {rows.map(({ series, rows: withAverage }) => (
          <div key={series.id}>
            <h4 className="event-series-title">{series.label}</h4>
            <p className="text-xs secondary">
              {formatNumber(series.n_events)} events, {series.first_year}–{series.last_year}.
              {series.note ? ` ${series.note}` : ''}
            </p>
            <Deferred height={220}>
              <YearBars
                data={withAverage}
                valueKey="count"
                valueLabel={series.label}
                color={colorFor(series)}
                height={220}
                average={{ key: 'count_avg', label: `${AVG_WINDOW}-year average` }}
                shadeBefore={series.poor_before}
                format={formatNumber}
              />
            </Deferred>
          </div>
        ))}
      </div>
    ),
  }
}

function monthlyView(type, block) {
  const color = `var(--dt-${type.id})`
  const busiest = block.busiest_calendar_month
  const record = block.busiest_month_on_record
  const noun = block.scope === 'India only' ? 'flood events' : type.noun[1]
  return {
    title: `${busiest.label} is the busiest month: ${one(busiest.average, 1)} ${noun} in an average ${busiest.label}, ${formatPercent(busiest.share, 0)} of the year’s events`,
    insight: `${formatNumber(block.n_events)} ${block.unit}, ${block.first_year}–${block.last_year} (${block.scope}). Busiest single month on record: ${record.label} with ${formatNumber(record.count)}.`,
    badge: badgeFor(block),
    footnote: block.note ?? undefined,
    tableColumns: [
      { key: 'label', label: 'Month' },
      { key: 'average', label: 'Average per year', render: (r) => one(r.average, 2) },
      { key: 'total', label: 'Total', render: (r) => formatNumber(r.total) },
    ],
    tableRows: block.average_per_month.map((row) => ({ ...row, id: row.month })),
    csvRows: block.years.map((year, index) => ({
      year,
      ...Object.fromEntries(MONTHS.map((name, month) => [name, block.matrix[index][month]])),
    })),
    csvName: `${type.id}-event-frequency-monthly.csv`,
    body: (
      <div className="event-series">
        <div>
          <h4 className="event-series-title">Events per month, every year</h4>
          <YearMonthHeatmap
            years={block.years}
            matrix={block.matrix}
            color={color}
            unit={noun}
            ariaLabel={`Heatmap of ${noun} per month, ${block.first_year} to ${block.last_year}. Busiest month on record: ${record.label}, ${record.count}.`}
          />
        </div>
        <div>
          <h4 className="event-series-title">Average per calendar month</h4>
          <Deferred height={220}>
            <CategoryBars
              data={block.average_per_month}
              xKey="label"
              valueKey="average"
              valueLabel={`${noun} a year`}
              color={color}
              height={220}
              format={(value) => one(value, 1)}
            />
          </Deferred>
        </div>
      </div>
    ),
  }
}

function DailyBody({ type, block, mode, setMode, year, setYear }) {
  const color = `var(--dt-${type.id})`
  const noun = block.scope === 'India only' ? 'flood events' : type.noun[1]
  const thinned = mode === 'thinned' && block.declustered
  const stats = thinned ? block.declustered : block
  const days = stats.by_year[String(year)] ?? []
  const counts = Object.fromEntries(days)
  const total = days.reduce((sum, [, count]) => sum + count, 0)
  const yearId = useId()
  const busiest = stats.busiest_day
  return (
    <div className="event-series">
      {block.declustered && (
        <div className="row event-mode">
          <div className="seg seg-wrap" role="group" aria-label="Which earthquakes to count">
            <button type="button" className="seg-btn" aria-pressed={!thinned} onClick={() => setMode('all')}>
              All M6+ earthquakes
            </button>
            <button type="button" className="seg-btn" aria-pressed={Boolean(thinned)} onClick={() => setMode('thinned')}>
              One per day per 5° cell
            </button>
          </div>
        </div>
      )}
      {block.declustered && (
        <p className="text-xs secondary">
          {block.declustered.why} With one earthquake per day per 5° cell, the busiest day has{' '}
          {block.declustered.busiest_day.count} instead of {block.busiest_day.count} (
          {formatNumber(block.declustered.n_events)} of {formatNumber(block.n_events)} earthquakes remain).
        </p>
      )}
      <div className="event-tiles">
        <div className="event-tile">
          <p className="event-tile-label">Average per day</p>
          <p className="kpi-value">{one(stats.average_per_day, 3)}</p>
          <p className="text-xs secondary">
            {formatNumber(stats.n_events ?? block.n_events)} {noun} over {formatNumber(stats.period_days)} days
          </p>
        </div>
        <div className="event-tile">
          <p className="event-tile-label">Days with at least one event</p>
          <p className="kpi-value">{formatPercent(stats.share_days_with_event, 1)}</p>
          <p className="text-xs secondary">
            {formatNumber(stats.days_with_event)} of {formatNumber(stats.period_days)} days
          </p>
        </div>
        <div className="event-tile">
          <p className="event-tile-label">Busiest single day</p>
          <p className="kpi-value">{formatDay(busiest.date)}</p>
          <p className="text-xs secondary">
            {busiest.count} {busiest.count === 1 ? 'event' : 'events'}: {busiest.events.slice(0, 3).join('; ')}
            {busiest.count > 3 ? ` and ${busiest.count - Math.min(3, busiest.events.length)} more` : ''}
          </p>
        </div>
      </div>
      <div>
        <div className="row event-year">
          <label htmlFor={yearId} className="field-label">
            Year
          </label>
          <select id={yearId} className="select" value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {[...block.years].reverse().map((y) => (
              <option key={y} value={y}>
                {y}
                {y === block.default_year ? ' (latest complete year)' : ''}
              </option>
            ))}
          </select>
          <span className="text-xs secondary">
            {days.length ? `${days.length} days with an event, ${formatNumber(total)} ${noun}` : `No ${noun} dated in ${year}`}
          </span>
        </div>
        <CalendarHeatmap
          key={`${year}-${mode}`}
          year={year}
          counts={counts}
          color={color}
          unit={noun}
          ariaLabel={`Calendar of ${noun} per day in ${year}: ${days.length} days with an event, ${total} in total.`}
        />
      </div>
      <div>
        <h4 className="event-series-title">Busiest days on record</h4>
        <ol className="event-top">
          {stats.top_days.map((day) => (
            <li key={day.date}>
              <strong>{formatDay(day.date)}</strong>: {day.count} {day.count === 1 ? 'event' : 'events'}
              <span className="text-xs secondary"> · {day.events.slice(0, 2).join('; ')}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function dailyView(type, block, state) {
  const { mode, year } = state
  const thinned = mode === 'thinned' && block.declustered
  const stats = thinned ? block.declustered : block
  const noun = block.scope === 'India only' ? 'flood events' : type.noun[1]
  const days = stats.by_year[String(year)] ?? []
  return {
    title: `${formatPercent(stats.share_days_with_event, 0)} of days have at least one ${type.noun[0]}${block.scope === 'India only' ? ' in India' : ''}; busiest day ${formatDay(stats.busiest_day.date)} with ${stats.busiest_day.count}`,
    insight: `${formatNumber(stats.n_events ?? block.n_events)} ${block.unit}, ${block.first_year}–${block.last_year} (${block.scope}). ${thinned ? 'Counting one earthquake per day per 5° cell.' : ''}`.trim(),
    badge: badgeFor(block),
    footnote: block.note ?? undefined,
    tableColumns: [
      { key: 'date', label: 'Date' },
      { key: 'count', label: `${noun[0].toUpperCase()}${noun.slice(1)}` },
    ],
    tableRows: days
      .slice()
      .sort((a, b) => a[0] - b[0])
      .map(([doy, count]) => ({
        id: doy,
        date: new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10),
        count,
      })),
    csvRows: days
      .slice()
      .sort((a, b) => a[0] - b[0])
      .map(([doy, count]) => ({ date: new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10), count })),
    csvName: `${type.id}-event-frequency-daily-${year}.csv`,
    body: <DailyBody type={type} block={block} {...state} />,
  }
}

/**
 * 04 · Event frequency: counts of events per year, month and day, in one card
 * with three tabs. Decades are covered by "Frequency & trends" and not repeated.
 */
export function EventFrequencyBlock({ type, data }) {
  const counts = data.event_counts
  const [tab, setTab] = useState('yearly')
  const [mode, setMode] = useState('all')
  const [year, setYear] = useState(counts.daily.available ? counts.daily.default_year : null)
  const tabId = useId()

  const block = counts[tab]
  const view = !block.available
    ? unavailableView(TABS.find(([id]) => id === tab)[1], block, type)
    : tab === 'yearly'
      ? yearlyView(type, block)
      : tab === 'monthly'
        ? monthlyView(type, block)
        : dailyView(type, block, { mode, setMode, year, setYear })

  const controls = (
    <div className="seg seg-wrap" role="group" aria-label="Count events by">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className="seg-btn"
          aria-pressed={tab === id}
          aria-controls={tabId}
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <Block
      id="event-frequency"
      index={4}
      title="Event frequency"
      lead="How many events happen each year, month and day. Decades are in Frequency & trends above."
    >
      <div id={tabId}>
        <ChartCard
          headingLevel={3}
          title={view.title}
          insight={view.insight}
          badge={view.badge}
          controls={controls}
          footnote={view.footnote}
          empty={view.empty}
          emptyMessage={view.emptyMessage}
          tableColumns={view.tableColumns}
          tableRows={view.tableRows}
          csvRows={view.csvRows}
          csvName={view.csvName}
        >
          {view.body}
        </ChartCard>
      </div>
    </Block>
  )
}
