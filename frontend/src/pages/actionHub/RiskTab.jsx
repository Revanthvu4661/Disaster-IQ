import { ArrowRight } from 'lucide-react'
import SortableTable from '../../components/SortableTable'
import SourceBadge from '../../components/SourceBadge'
import { InfoCard } from '../../components/history/Block'
import { ErrorState, SkeletonCard } from '../../components/ui'
import { RiskPill } from '../../components/flood/parts'
import { getDisasterType } from '../../config/disasterTypes'
import { formatLakh } from '../../lib/format'
import { formatDay } from '../../lib/risk'

const LEVEL_ORDER = { critical: 0, high: 1 }

/** High and critical areas from Level 2; each row starts an action plan. */
export default function RiskTab({ areasApi, plans, onPlan }) {
  const { data, error, loading, reload } = areasApi
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <SkeletonCard height={360} />
  const planned = new Set(plans.map((plan) => plan.riskId))
  const columns = [
    { key: 'area', label: 'Area', render: (row) => (row.area === row.state ? row.area : `${row.area}, ${row.state}`) },
    {
      key: 'hazard',
      label: 'Disaster type',
      render: (row) => {
        const type = getDisasterType(row.hazard)
        return (
          <span className="ah-type" data-hazard={row.hazard}>
            <type.icon size={14} aria-hidden="true" /> {type.shortLabel}
          </span>
        )
      },
    },
    {
      key: 'level',
      label: 'Risk level',
      sortValue: (row) => LEVEL_ORDER[row.level] * 10 - row.probability,
      render: (row) => <RiskPill level={row.level} probability={row.probability} />,
    },
    { key: 'population', label: 'Population (2011)', numeric: true, render: (row) => (row.population ? formatLakh(row.population) : 'Unavailable') },
    {
      key: 'updated',
      label: 'Last updated',
      render: (row) => (
        <span title={row.basis}>
          {row.hazard === 'flood' ? formatDay(row.updated) : `Index ${row.updated}`}
          <span className="ah-basis">{row.basis}</span>
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      sortValue: (row) => (planned.has(row.id) ? 0 : 1),
      render: (row) => (
        <button type="button" className="btn btn-sm ah-plan-btn" onClick={() => onPlan(row)}>
          {planned.has(row.id) ? 'Open action plan' : 'Create Action Plan'} <ArrowRight size={14} aria-hidden="true" />
        </button>
      ),
    },
  ]
  return (
    <InfoCard
      title={`${data.areas.length} areas at high or critical risk`}
      insight="Flood districts from the current flood model (latest 30 days); earthquake and cyclone states from the long-run hazard index. Most severe first."
      badge={<SourceBadge kind="model" source={['ifi', 'nasa_power', 'usgs', 'ibtracs']} detail="Level 2" />}
    >
      <SortableTable
        caption="High-risk areas"
        columns={columns}
        rows={data.areas}
        rowKey={(row) => row.id}
        preview={25}
        noun="areas"
      />
    </InfoCard>
  )
}
