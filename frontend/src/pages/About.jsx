import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { SOURCES } from '../config/sources'
import { PageHeader } from '../components/ui'
import { InfoCard } from '../components/history/Block'
import { UnavailableList } from '../components/history/Unavailable'

const FEEDS = [
  ['USGS', 'Earthquakes of magnitude 4.5+ in the past week.'],
  ['GDACS', 'Earthquake, cyclone and flood alerts from the Global Disaster Alert and Coordination System.'],
  ['NASA EONET', 'Open storm and flood events from the Earth Observatory Natural Event Tracker.'],
]

const NOT_AVAILABLE = [
  { metric: 'Missing people (separately)', reason: 'EM-DAT folds missing people into deaths.' },
  { metric: 'Displaced / evacuated', reason: 'Not in the free export; "left homeless" is the closest figure.' },
  { metric: 'Sector losses (infrastructure, agriculture, housing, business)', reason: 'EM-DAT gives one total damage figure per record.' },
  { metric: 'Urban vs rural', reason: 'No source used records it.' },
  { metric: 'Recovery time, response time', reason: 'Not in any source used.' },
  { metric: 'Month / season for floods', reason: 'Their only source (EM-DAT via OWID) has no event dates.' },
  { metric: 'Point locations for floods', reason: 'The Dartmouth Flood Observatory archive is gone (HTTP 410), so EM-DAT flood impact is country-level. The Kerala flood model uses the India Flood Inventory instead.' },
]

/** Data sources, their coverage, what each feeds, and what is not available. */
export default function About() {
  const { data } = useApi(() => api.disasterOverview(), [])
  const coverage = data?.coverage
  return (
    <div className="stack">
      <PageHeader
        title="About the data"
        description="Every historical number in DisasterIQ is a computation on one of the public datasets below. Where a figure is not in them, the app says so rather than estimating it."
      />

      <InfoCard headingLevel={2} title="Data sources">
        <dl className="answers">
          {Object.entries(SOURCES).map(([id, source]) => (
            <div key={id}>
              <dt>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.short}
                </a>
              </dt>
              <dd>{source.long}</dd>
            </div>
          ))}
        </dl>
        {coverage && (
          <p className="text-sm secondary" style={{ marginTop: 'var(--space-3)' }}>
            Years covered: {coverage.first_year}–{coverage.last_year}. {coverage.note} {coverage.unit_note} Data
            built {new Date(coverage.built_at).toLocaleDateString()}.
          </p>
        )}
      </InfoCard>

      <InfoCard
        headingLevel={2}
        title="How the derived figures are computed"
        insight="Full definitions are in docs/DATA_SOURCES.md in the repository."
      >
        <dl className="answers">
          <div>
            <dt>Fatality rate</dt>
            <dd>Deaths ÷ total affected × 100, pooled over records that report both.</dd>
          </div>
          <div>
            <dt>Loss per affected person</dt>
            <dd>Damages ÷ total affected, pooled over records that report both.</dd>
          </div>
          <div>
            <dt>Money</dt>
            <dd>
              Shown in ₹. Each record&apos;s damage figure as EM-DAT reported it (US$ of that year) is
              converted at that year&apos;s average exchange rate (World Bank WDI, from IMF data,
              1960–2025; earlier years use the 1960 rate and are marked *), then summed. Converted from
              USD using that year&apos;s average exchange rate. Not adjusted for inflation. The original
              US$ figure appears on hover. Rankings across years (Severity Index, trends, highest-loss
              decade) use EM-DAT damages adjusted with the US consumer price index (2024 prices).
            </dd>
          </div>
          <div>
            <dt>Severity Index</dt>
            <dd>
              log10(1 + x) of deaths, total affected and damages, each min-max scaled within the records
              being ranked, weighted 50 / 25 / 25, times 100.
            </dd>
          </div>
          <div>
            <dt>Trends</dt>
            <dd>Spearman rank test on yearly totals from 1980; &quot;increasing&quot; needs p &lt; 0.05.</dd>
          </div>
          <div>
            <dt>Correlation</dt>
            <dd>Pearson r on log10 values and Spearman ρ, over records reporting both figures.</dd>
          </div>
        </dl>
      </InfoCard>

      <InfoCard headingLevel={2} title="Not available in these sources">
        <UnavailableList items={NOT_AVAILABLE} title="Shown as unavailable in the app" />
      </InfoCard>

      <InfoCard
        headingLevel={2}
        title="Live feeds"
        insight="Fetched every 10 minutes and shown on the World Map and each disaster page. They are separate from the historical records."
      >
        <dl className="answers">
          {FEEDS.map(([name, text]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm" style={{ marginTop: 'var(--space-3)' }}>
          <Link to="/map" className="text-link">
            Open the World Map
          </Link>
        </p>
      </InfoCard>
    </div>
  )
}
