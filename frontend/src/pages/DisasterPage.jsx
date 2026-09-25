import { History, Info } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { disasterVar, getDisasterType } from '../config/disasterTypes'
import { DisasterHeader } from '../components/DisasterHeader'
import SourceBadge from '../components/SourceBadge'
import LevelChain from '../components/LevelChain'
import { ErrorState, SkeletonCard } from '../components/ui'
import { EconomicBlock, HumanBlock } from './disaster/ImpactBlocks'
import { FrequencyBlock, TimeBlock } from './disaster/TrendBlocks'
import { EventFrequencyBlock } from './disaster/EventFrequencyBlock'
import {
  CorrelationBlock,
  GeographyBlock,
  RecoveryBlock,
  SeverityBlock,
} from './disaster/PlaceBlocks'
import { formatNumber } from '../lib/format'

const SECTIONS = [
  ['human', 'Human impact'],
  ['economic', 'Economic impact'],
  ['frequency', 'Frequency & trends'],
  ['event-frequency', 'Event frequency'],
  ['geography', 'Geography'],
  ['severity', 'Severity'],
  ['time', 'Time'],
  ['correlation', 'Correlation'],
  ['recovery', 'Recovery'],
]

/**
 * One page per disaster type: nine full-width analysis blocks over the
 * historical impact data (OWID/EM-DAT, plus USGS or NOAA IBTrACS points where
 * the type has them), and a compact live card.
 */
function DisasterView({ type }) {
  const { data, error, loading, reload } = useApi(() => api.disaster(type.id), [type.id])
  const pointSource = type.historical.points

  const header = (
    <DisasterHeader
      type={type}
      eyebrow="Historical impact · live monitoring"
      badges={
        <>
          <SourceBadge source={pointSource ? ['emdat', pointSource] : 'emdat'} />
          <SourceBadge kind="live" detail={type.liveSources.join(', ')} />
        </>
      }
    />
  )

  if (loading) {
    return (
      <div className="stack">
        {header}
        <SkeletonCard height={160} />
        <SkeletonCard height={320} />
        <SkeletonCard height={320} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="stack">
        {header}
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  const { coverage } = data
  return (
    <div className="stack disaster-page" style={{ '--dt': disasterVar(type.id) }}>
      {header}

      {/* Every hazard continues into Level 2 (risk prediction) and Level 3 (preparedness and response). */}
      <LevelChain current="analyze" hazard={type.id} />

      {data.caveat && (
        <p className="callout">
          <Info size={16} aria-hidden="true" />
          <span>{data.caveat}</span>
        </p>
      )}
      <p className="callout callout-coverage">
        <History size={16} aria-hidden="true" />
        <span>
          <strong>Coverage.</strong> {coverage.note} {formatNumber(coverage.records_before_trend)} of the{' '}
          {formatNumber(coverage.records)} records are from before {coverage.trend_from}. {coverage.unit_note}
          {coverage.partial_year_excluded && ` ${coverage.partial_year_excluded} is still in progress and is left out.`}
        </span>
      </p>

      <nav className="block-nav" aria-label="Sections on this page">
        <ol>
          {SECTIONS.map(([id, label], index) => (
            <li key={id}>
              <a href={`#${id}`}>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span> {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <HumanBlock type={type} data={data} />
      <EconomicBlock type={type} data={data} />
      <FrequencyBlock type={type} data={data} />
      <EventFrequencyBlock type={type} data={data} />
      <GeographyBlock type={type} data={data} />
      <SeverityBlock type={type} data={data} />
      <TimeBlock type={type} data={data} />
      <CorrelationBlock type={type} data={data} />
      <RecoveryBlock type={type} data={data} />
    </div>
  )
}

export default function DisasterPage({ id }) {
  const type = getDisasterType(id)
  return <DisasterView key={id} type={type} />
}
