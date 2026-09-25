import { AlertTriangle, Banknote, HeartPulse, Home, Percent, ShieldCheck, Users } from 'lucide-react'
import ChartCard from '../../components/ChartCard'
import KpiCard from '../../components/KpiCard'
import SourceBadge from '../../components/SourceBadge'
import BarList from '../../components/charts/BarList'
import { Block } from '../../components/history/Block'
import { UnavailableList } from '../../components/history/Unavailable'
import LiveNow from '../../components/live/LiveNow'
import { CurrencyNote, Inr } from '../../components/Inr'
import { formatCompact1, formatINR, formatNumber, formatPercent } from '../../lib/format'

const METRIC_ICONS = {
  deaths: HeartPulse,
  total_affected: Users,
  affected: AlertTriangle,
  injured: HeartPulse,
  homeless: Home,
}

/** 01 · Human impact: every people-count the source has, plus fatality rate. */
export function HumanBlock({ type, data }) {
  const { human, coverage } = data
  const color = `var(--dt-${type.id})`
  const deaths = human.metrics.find((metric) => metric.key === 'deaths')
  const affected = human.metrics.find((metric) => metric.key === 'total_affected')
  const rate = human.fatality_rate
  const label = type.label.toLowerCase()

  return (
    <Block
      id="human"
      index={1}
      title="Human impact"
      lead={`People killed and affected in ${coverage.records.toLocaleString()} country-year records, ${coverage.records_first_year}–${coverage.last_year}.`}
    >
      <ChartCard
        headingLevel={3}
        title={
          deaths
            ? `${formatNumber(deaths.value)} deaths recorded in ${label} disasters${affected ? `, and ${formatCompact1(affected.value)} people affected` : ''}`
            : `No deaths recorded for ${label} disasters`
        }
        insight={
          rate.value_pct !== null
            ? `Pooled over the ${formatNumber(rate.records)} records that report both, ${rate.value_pct.toFixed(2)}% of the people affected died (median record: ${rate.median_pct.toFixed(2)}%).`
            : 'No record reports both deaths and people affected, so a fatality rate cannot be computed.'
        }
        badge={<SourceBadge source="emdat" />}
        tableColumns={[
          { key: 'label', label: 'Figure' },
          { key: 'value', label: 'Total', render: (row) => formatNumber(row.value) },
          { key: 'records_reporting', label: 'Records reporting it', render: (row) => formatNumber(row.records_reporting) },
          { key: 'definition', label: 'What it counts' },
        ]}
        tableRows={human.metrics.map((metric) => ({ ...metric, id: metric.key }))}
        csvRows={human.metrics}
        csvName={`${type.id}-human-impact.csv`}
        footnote="Totals are sums of what EM-DAT recorded. Where a record reports no figure it adds nothing, so these are lower bounds."
      >
        <div className="grid grid-kpi">
          {human.metrics.map((metric) => {
            const Icon = METRIC_ICONS[metric.key] ?? Users
            return (
              <KpiCard
                key={metric.key}
                title={metric.label}
                value={formatCompact1(metric.value)}
                sub={`${formatNumber(metric.records_reporting)} of ${formatNumber(human.records)} records report it`}
                icon={<Icon size={16} aria-hidden="true" />}
                accent={color}
                tone={metric.key}
                meter={human.records ? metric.records_reporting / human.records : null}
              />
            )
          })}
          {rate.value_pct !== null && (
            <KpiCard
              title="Fatality rate"
              value={`${rate.value_pct.toFixed(2)}%`}
              sub={`Deaths ÷ total affected, ${formatNumber(rate.records)} records`}
              icon={<Percent size={16} aria-hidden="true" />}
              accent={color}
              tone="fatality_rate"
            />
          )}
        </div>
        <details className="definitions">
          <summary>What each figure counts</summary>
          <dl>
            {human.metrics.map((metric) => (
              <div key={metric.key}>
                <dt>{metric.label}</dt>
                <dd>{metric.definition}</dd>
              </div>
            ))}
            <div>
              <dt>Fatality rate</dt>
              <dd>{rate.definition}</dd>
            </div>
          </dl>
        </details>
        <UnavailableList items={human.unavailable} />
      </ChartCard>
      <LiveNow type={type} />
    </Block>
  )
}

/** 02 · Economic impact: total, insured, reconstruction, per person, share of GDP. */
export function EconomicBlock({ type, data }) {
  const { economic } = data
  const color = `var(--dt-${type.id})`
  const label = type.label.toLowerCase()
  const gdpTop = economic.gdp.top[0]
  const kpis = [
    {
      key: 'total',
      title: 'Total damages',
      value: <Inr value={economic.total_damages_inr} usd={economic.total_damages_nominal_usd} />,
      sub: `${formatNumber(economic.records_with_damages)} of ${formatNumber(economic.records)} records report a damage figure`,
      icon: Banknote,
    },
    economic.insured_inr > 0 && {
      key: 'insured',
      title: 'Insured losses',
      value: <Inr value={economic.insured_inr} usd={economic.insured_nominal_usd} />,
      sub: `${formatPercent(economic.insured_share_inr)} of total damages · ${formatNumber(economic.records_with_insured)} records`,
      icon: ShieldCheck,
    },
    economic.reconstruction_inr > 0 && {
      key: 'reconstruction',
      title: 'Reconstruction costs',
      value: <Inr value={economic.reconstruction_inr} usd={economic.reconstruction_nominal_usd} />,
      sub: `${formatNumber(economic.records_with_reconstruction)} records report one`,
      icon: Home,
    },
    economic.loss_per_affected_inr !== null && {
      key: 'per-person',
      title: 'Loss per affected person',
      value: <Inr value={economic.loss_per_affected_inr} full />,
      sub: `Damages ÷ total affected, ${formatNumber(economic.loss_per_affected_records)} records`,
      icon: Users,
    },
  ].filter(Boolean)

  return (
    <Block
      id="economic"
      index={2}
      title="Economic impact"
      lead={<CurrencyNote estimatedCount={economic.records_fx_estimated} />}
    >
      <ChartCard
        headingLevel={3}
        title={
          economic.total_damages_inr > 0
            ? `${formatINR(economic.total_damages_inr)} in recorded ${label} damages${economic.insured_inr > 0 ? `, ${formatPercent(economic.insured_share_inr, 0)} of it insured` : ''}`
            : `No damage figures recorded for ${label} disasters`
        }
        insight={`Only ${formatPercent(economic.records_with_damages / economic.records, 0)} of records carry a damage estimate, so the true cost is higher than these totals. Hover a figure for the exact rupee amount and EM-DAT's original US$ figure.`}
        footnote={<CurrencyNote estimatedCount={economic.records_fx_estimated} />}
        badge={<SourceBadge source="emdat" />}
        tableColumns={[
          { key: 'title', label: 'Figure' },
          { key: 'value', label: 'Value' },
          { key: 'sub', label: 'Basis' },
        ]}
        tableRows={kpis}
      >
        <div className="grid grid-kpi">
          {kpis.map((kpi) => {
            const Icon = kpi.icon
            return (
              <KpiCard
                key={kpi.key}
                title={kpi.title}
                value={kpi.value}
                sub={kpi.sub}
                icon={<Icon size={16} aria-hidden="true" />}
                accent={color}
                tone={`economic_${kpi.key}`}
              />
            )
          })}
        </div>
        <UnavailableList items={economic.unavailable} />
      </ChartCard>

      <ChartCard
        headingLevel={3}
        title={
          gdpTop
            ? `${gdpTop.country}, ${gdpTop.year}: damages equal to ${gdpTop.damages_pct_gdp.toFixed(1)}% of the country's GDP`
            : 'Damages as a share of GDP'
        }
        insight={
          gdpTop
            ? `The ${economic.gdp.top.length} records with the largest damages relative to the national economy. Across the ${formatNumber(economic.gdp.records)} records with both figures, the median is ${economic.gdp.median_pct.toFixed(2)}% of GDP.`
            : 'No record has both a damage figure and a GDP figure.'
        }
        badge={<SourceBadge source="emdat_wdi" />}
        empty={!gdpTop}
        emptyMessage="No record has both a damage figure and a GDP figure."
        tableColumns={[
          { key: 'country', label: 'Country' },
          { key: 'year', label: 'Year' },
          { key: 'damages_pct_gdp', label: '% of GDP', render: (row) => `${row.damages_pct_gdp.toFixed(2)}%` },
          {
            key: 'damages_inr',
            label: 'Damages (₹, rate of that year)',
            render: (row) => <Inr value={row.damages_inr} usd={row.damages_nominal_usd} estimated={row.fx_estimated} />,
          },
        ]}
        tableRows={economic.gdp.top.map((row) => ({ ...row, id: `${row.country}-${row.year}` }))}
        csvRows={economic.gdp.top}
        csvName={`${type.id}-damages-share-of-gdp.csv`}
        footnote={<CurrencyNote />}
      >
        <BarList
          ariaLabel="Damages as a share of GDP, largest records"
          color={color}
          labelWidth="11rem"
          rows={economic.gdp.top.map((row) => ({
            key: `${row.country}-${row.year}`,
            label: `${row.country} ${row.year}`,
            value: row.damages_pct_gdp,
            display: `${row.damages_pct_gdp.toFixed(1)}%`,
            secondary: `${formatINR(row.damages_inr)}${row.fx_estimated ? '*' : ''}`,
            title: `${row.country} ${row.year}`,
          }))}
        />
      </ChartCard>
    </Block>
  )
}
