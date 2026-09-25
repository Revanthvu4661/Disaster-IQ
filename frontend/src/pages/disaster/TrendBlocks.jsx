import { useMemo } from 'react'
import ChartCard from '../../components/ChartCard'
import SourceBadge from '../../components/SourceBadge'
import { Block, InfoCard } from '../../components/history/Block'
import { CategoryBars, StackedBars, YearBars } from '../../components/charts/LazyCharts'
import Deferred from '../../components/Deferred'
import {
  formatChange,
  formatDecade,
  formatNumber,
  formatPercent,
  formatINR,
} from '../../lib/format'
import { maxBy, movingAverage, trendStats, trendWords } from '../../lib/history'
import { CurrencyNote, Inr } from '../../components/Inr'

const AVG_WINDOW = 10

function MonthsCard({ type, months }) {
  const color = `var(--dt-${type.id})`
  if (!months.available) {
    return (
      <InfoCard
        title="Month and season: not available"
        insight={months.reason}
        badge={<SourceBadge source="emdat" />}
      />
    )
  }
  const cyclone = type.id === 'cyclone'
  const peak = months.peak_season
  const title = months.seasonal
    ? `${peak.label} is the peak season: ${formatPercent(peak.share, 0)} of ${cyclone ? 'storms form' : 'events occur'} in those three months`
    : months.note
      ? `No real season: uneven monthly counts come from aftershock clusters, not the time of year`
      : `No seasonal pattern: ${type.noun[1]} are spread evenly across the year`
  const test = `χ² test against an even spread across the year (adjusted for month length): p ${months.p_value < 0.001 ? '< 0.001' : `= ${months.p_value.toFixed(3)}`}.`
  return (
    <ChartCard
      headingLevel={3}
      title={title}
      insight={`${formatNumber(months.total)} ${months.population} since ${months.first_year}. Busiest single month: ${months.peak_month.label} (${formatNumber(months.peak_month.count)}). ${test}`}
      badge={<SourceBadge source={months.source.id} />}
      footnote={
        cyclone
          ? 'Split by the hemisphere of each storm’s peak intensity: northern-hemisphere storms peak in Aug–Oct, southern ones in Jan–Mar.'
          : months.note ?? undefined
      }
      tableColumns={[
        { key: 'label', label: 'Month' },
        { key: 'count', label: 'Count', render: (row) => formatNumber(row.count) },
        ...(cyclone
          ? [
              { key: 'north', label: 'Northern hemisphere' },
              { key: 'south', label: 'Southern hemisphere' },
            ]
          : []),
      ]}
      tableRows={months.rows.map((row) => ({ ...row, id: row.month }))}
      csvRows={months.rows}
      csvName={`${type.id}-months.csv`}
    >
      <Deferred height={240}>
        {cyclone ? (
          <StackedBars
            data={months.rows}
            xKey="label"
            series={[
              { key: 'north', label: 'Northern hemisphere', color },
              { key: 'south', label: 'Southern hemisphere', color, opacity: 0.45 },
            ]}
            format={formatNumber}
          />
        ) : (
          <CategoryBars
            data={months.rows}
            xKey="label"
            valueKey="count"
            valueLabel={type.noun[1]}
            color={color}
            format={formatNumber}
          />
        )}
      </Deferred>
      {cyclone && (
        <ul className="legend" aria-label="Legend">
          <li>
            <span className="legend-swatch" style={{ background: color }} aria-hidden="true" />
            Northern hemisphere
          </li>
          <li>
            <span className="legend-swatch" style={{ background: color, opacity: 0.45 }} aria-hidden="true" />
            Southern hemisphere
          </li>
        </ul>
      )}
    </ChartCard>
  )
}

/** 03 · Frequency & trends: events per year and decade, change, months, deaths and loss over time. */
export function FrequencyBlock({ type, data }) {
  const { frequency, time, coverage } = data
  const color = `var(--dt-${type.id})`
  const label = type.label.toLowerCase()
  const yearly = useMemo(() => {
    let rows = movingAverage(frequency.yearly, 'n_events', AVG_WINDOW)
    rows = movingAverage(rows, 'deaths', AVG_WINDOW)
    return movingAverage(rows, 'damages_inr', AVG_WINDOW)
  }, [frequency.yearly])
  const { dod, yoy } = frequency
  const decades = frequency.decades
  const deadliest = maxBy(frequency.yearly, 'deaths')
  const costliest = maxBy(frequency.yearly, 'damages_inr')
  const shade = coverage.trend_from
  const usgsRows = (frequency.usgs_decades ?? []).map((row) => ({
    ...row,
    disasters: decades.find((d) => d.decade === row.decade)?.n_events ?? 0,
  }))
  const usgsPeak = usgsRows.reduce((best, row) => (row.m6 > (best?.m6 ?? -1) ? row : best), null)
  const emdatOf = (decade) => decades.find((d) => d.decade === decade)?.n_events
  const avgNote = `Line: ${AVG_WINDOW}-year trailing average. Shaded: before ${shade}, when EM-DAT recorded far fewer disasters.`

  return (
    <Block
      id="frequency"
      index={3}
      title="Frequency & trends"
      lead={coverage.note}
    >
      <ChartCard
        headingLevel={3}
        title={`${formatNumber(dod.events)} ${label} disasters recorded in the ${formatDecade(dod.decade)}, ${formatChange(dod.change_pct)} on the ${formatDecade(dod.previous_decade)}`}
        insight={`Disasters per year worldwide. ${yoy.year}: ${formatNumber(yoy.events)}, against ${formatNumber(yoy.previous_events)} in ${yoy.year - 1} (${formatChange(yoy.change_pct)}). ${frequency.definition}`}
        badge={<SourceBadge source="emdat" />}
        footnote={`${avgNote} An EM-DAT event can span several countries and is counted once.`}
        tableColumns={[
          { key: 'year', label: 'Year' },
          { key: 'n_events', label: 'Disasters', render: (row) => formatNumber(row.n_events) },
        ]}
        tableRows={[...frequency.yearly].reverse().map((row) => ({ ...row, id: row.year }))}
        csvRows={frequency.yearly}
        csvName={`${type.id}-events-per-year.csv`}
      >
        <Deferred height={260}>
          <YearBars
            data={yearly}
            valueKey="n_events"
            valueLabel="Disasters"
            color={color}
            average={{ key: 'n_events_avg', label: `${AVG_WINDOW}-year average` }}
            shadeBefore={shade}
            format={formatNumber}
          />
        </Deferred>
      </ChartCard>

      <ChartCard
        headingLevel={3}
        title={`The ${formatDecade(time.peak_events_decade.decade)} recorded the most ${label} disasters: ${formatNumber(time.peak_events_decade.value)}`}
        insight={`Disasters per decade. ${frequency.definition} The change column compares disasters per year with the previous decade, so the unfinished current decade is comparable.`}
        badge={<SourceBadge source="emdat" />}
        footnote="Dashed bar: decade still in progress."
        tableColumns={[
          { key: 'decade', label: 'Decade', render: (row) => formatDecade(row.decade) },
          { key: 'n_events', label: 'Disasters', render: (row) => formatNumber(row.n_events) },
          { key: 'events_per_year', label: 'Per year', render: (row) => row.events_per_year.toFixed(1) },
          { key: 'change_pct', label: 'Change vs previous decade', render: (row) => formatChange(row.change_pct) },
          { key: 'years', label: 'Years covered' },
        ]}
        tableRows={decades.map((row) => ({ ...row, id: row.decade }))}
        csvRows={decades}
        csvName={`${type.id}-events-per-decade.csv`}
      >
        <Deferred height={240}>
          <CategoryBars
            data={decades.map((row) => ({ ...row, label: formatDecade(row.decade) }))}
            xKey="label"
            valueKey="n_events"
            valueLabel="Disasters"
            color={color}
            muted={(row) => !row.complete}
            format={formatNumber}
          />
        </Deferred>
      </ChartCard>

      {frequency.usgs_decades && (
        <ChartCard
          headingLevel={3}
          title={`Not every earthquake is a disaster: USGS records ${formatNumber(usgsPeak.m6)} earthquakes of M6.0+ in the ${formatDecade(usgsPeak.decade)}, EM-DAT ${formatNumber(emdatOf(usgsPeak.decade))} disasters`}
          insight="Two different counts. USGS lists every earthquake at or above magnitude 6 with a location; EM-DAT lists only those that caused a disaster (deaths, people affected, an emergency declaration or an appeal for aid). Smaller earthquakes are far more numerous still and appear in neither."
          badge={<SourceBadge source={['usgs', 'emdat']} />}
          footnote="USGS catalogue completeness for M6+ improves after about 1950, so the early decades are undercounts."
          tableColumns={[
            { key: 'decade', label: 'Decade', render: (row) => formatDecade(row.decade) },
            { key: 'm6', label: 'USGS M6.0+', render: (row) => formatNumber(row.m6) },
            { key: 'm7', label: 'of which M7.0+', render: (row) => formatNumber(row.m7) },
            { key: 'disasters', label: 'EM-DAT disasters', render: (row) => formatNumber(row.disasters) },
          ]}
          tableRows={usgsRows.map((row) => ({ ...row, id: row.decade }))}
          csvRows={usgsRows}
          csvName={`${type.id}-usgs-vs-emdat-per-decade.csv`}
        >
          <Deferred height={240}>
            <CategoryBars
              data={usgsRows.map((row) => ({ ...row, label: formatDecade(row.decade) }))}
              xKey="label"
              valueKey="m6"
              valueLabel="USGS M6.0+ earthquakes"
              color={color}
              format={formatNumber}
            />
          </Deferred>
        </ChartCard>
      )}

      <MonthsCard type={type} months={frequency.months} />

      <ChartCard
        headingLevel={3}
        title={`Deaths per year since ${time.deaths_trend.from ?? shade}: ${trendWords(time.deaths_trend)}. The deadliest year was ${deadliest.year} (${formatNumber(deadliest.deaths)})`}
        insight={`${trendStats(time.deaths_trend)}. One catastrophic event can dominate a year, so the ${AVG_WINDOW}-year line is the better guide.`}
        badge={<SourceBadge source="emdat" />}
        footnote={avgNote}
        tableColumns={[
          { key: 'year', label: 'Year' },
          { key: 'deaths', label: 'Deaths', render: (row) => formatNumber(row.deaths) },
        ]}
        tableRows={[...frequency.yearly].reverse().map((row) => ({ ...row, id: row.year }))}
        csvRows={frequency.yearly.map(({ year, deaths }) => ({ year, deaths }))}
        csvName={`${type.id}-deaths-per-year.csv`}
      >
        <Deferred height={260}>
          <YearBars
            data={yearly}
            valueKey="deaths"
            valueLabel="Deaths"
            color={color}
            average={{ key: 'deaths_avg', label: `${AVG_WINDOW}-year average` }}
            shadeBefore={shade}
          />
        </Deferred>
      </ChartCard>

      <ChartCard
        headingLevel={3}
        title={
          costliest?.damages_inr > 0
            ? `Economic loss per year: ${trendWords(time.loss_trend)} since ${time.loss_trend.from ?? shade} in inflation-adjusted terms. The largest rupee figure is ${costliest.year} (${formatINR(costliest.damages_inr)})`
            : 'No economic loss recorded'
        }
        insight={`Bars: ₹ at each year's exchange rate, not adjusted for inflation, so later years look larger partly because prices and the rupee changed. The trend verdict is therefore tested on ${time.loss_trend.basis ?? 'inflation-adjusted US$'}: ${trendStats(time.loss_trend)}. Damage figures are missing for many records, especially early ones.`}
        badge={<SourceBadge source="emdat" />}
        footnote={
          <>
            {avgNote} <CurrencyNote />
          </>
        }
        tableColumns={[
          { key: 'year', label: 'Year' },
          {
            key: 'damages_inr',
            label: 'Damages (₹, rate of that year)',
            render: (row) => <Inr value={row.damages_inr} usd={row.damages_nominal_usd} estimated={row.fx_estimated} />,
          },
        ]}
        tableRows={[...frequency.yearly].reverse().map((row) => ({ ...row, id: row.year }))}
        csvRows={frequency.yearly.map(({ year, damages_inr: inr, damages_nominal_usd: usd, fx_estimated: estimated }) => ({
          year,
          damages_inr: inr,
          damages_usd_as_reported: usd,
          nearest_year_rate: estimated,
        }))}
        csvName={`${type.id}-loss-per-year.csv`}
      >
        <Deferred height={260}>
          <YearBars
            data={yearly}
            valueKey="damages_inr"
            valueLabel="Damages"
            color={color}
            average={{ key: 'damages_inr_avg', label: `${AVG_WINDOW}-year average` }}
            shadeBefore={shade}
            format={formatINR}
          />
        </Deferred>
      </ChartCard>
    </Block>
  )
}

/** 06 · Time-based analysis: the direct answers, each with its basis. */
export function TimeBlock({ type, data }) {
  const { time, coverage } = data
  const label = type.label.toLowerCase()
  const partial = (peak) => (peak.complete ? '' : ' (decade still in progress)')
  const answers = [
    {
      q: 'Which decade had the most events?',
      a: `The ${formatDecade(time.peak_events_decade.decade)}: ${formatNumber(time.peak_events_decade.value)} events${partial(time.peak_events_decade)}.`,
    },
    {
      q: 'Which decade had the most deaths?',
      a: `The ${formatDecade(time.peak_deaths_decade.decade)}: ${formatNumber(time.peak_deaths_decade.value)} deaths${partial(time.peak_deaths_decade)}.`,
    },
    {
      q: 'Which decade had the highest losses?',
      a:
        time.peak_loss_decade.value > 0
          ? `The ${formatDecade(time.peak_loss_decade.decade)}${partial(time.peak_loss_decade)}, ${time.peak_loss_basis ?? 'ranked on inflation-adjusted US$'}. Its recorded damages come to ${formatINR(time.peak_loss_decade.value_inr)} at each year's exchange rate (not inflation-adjusted).`
          : 'No losses recorded.',
    },
    {
      q: `Is the number of recorded ${label} disasters increasing?`,
      a: `${trendWords(time.frequency_trend)[0].toUpperCase()}${trendWords(time.frequency_trend).slice(1)} since ${coverage.trend_from} (${trendStats(time.frequency_trend)}). Part of any rise reflects better reporting, not only more events.`,
    },
    {
      q: 'Are losses increasing?',
      a: `${trendWords(time.loss_trend)[0].toUpperCase()}${trendWords(time.loss_trend).slice(1)} since ${coverage.trend_from}, tested on ${time.loss_trend.basis ?? 'inflation-adjusted US$'} (${trendStats(time.loss_trend)}). Rising losses also track growing exposed wealth.`,
    },
    {
      q: 'Are deaths increasing?',
      a: `${trendWords(time.deaths_trend)[0].toUpperCase()}${trendWords(time.deaths_trend).slice(1)} since ${coverage.trend_from} (${trendStats(time.deaths_trend)}).`,
    },
    {
      q: 'Which month or season is strongest?',
      a: time.strongest_month
        ? time.strongest_month.seasonal
          ? `${time.strongest_month.peak_season.label} (${formatPercent(time.strongest_month.peak_season.share, 0)} of events); the single busiest month is ${time.strongest_month.peak_month.label}. Source: ${time.strongest_month.source.name}.`
          : time.strongest_month.note
            ? `None. ${time.strongest_month.note} Source: ${time.strongest_month.source.name}.`
            : `None: the month-to-month differences are within chance (p = ${time.strongest_month.p_value.toFixed(2)}). ${time.strongest_month.peak_month.label} is marginally the busiest. Source: ${time.strongest_month.source.name}.`
        : 'Not available: the sources for this type have no event dates.',
    },
  ]
  const headline = `Since ${coverage.trend_from}, recorded ${label} disasters show ${trendWords(time.frequency_trend) === 'no clear trend' ? 'no clear trend' : `an ${trendWords(time.frequency_trend)} trend`}, and losses ${trendWords(time.loss_trend) === 'no clear trend' ? 'show no clear trend' : `are ${trendWords(time.loss_trend)}`}`
  return (
    <Block id="time" index={7} title="Time-based analysis">
      <InfoCard
        title={headline}
        insight="Trend verdicts use a Spearman rank test on yearly totals; “increasing” or “decreasing” needs p < 0.05."
        badge={<SourceBadge source={time.strongest_month ? ['emdat', time.strongest_month.source.id] : 'emdat'} />}
      >
        <dl className="answers">
          {answers.map((item) => (
            <div key={item.q}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </InfoCard>
    </Block>
  )
}
