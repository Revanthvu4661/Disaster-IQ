import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Droplets,
  HeartPulse,
  Home,
  LifeBuoy,
  Package,
  Ship,
  Users,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { DisasterHeader } from '../components/DisasterHeader'
import SourceBadge from '../components/SourceBadge'
import SortableTable from '../components/SortableTable'
import KpiCard from '../components/KpiCard'
import LevelChain from '../components/LevelChain'
import TypeSwitch from '../components/hazard/TypeSwitch'
import { Block, InfoCard } from '../components/history/Block'
import { UnavailableList } from '../components/history/Unavailable'
import { ErrorState, SkeletonCard } from '../components/ui'
import { RiskPill, ScenarioSwitch } from '../components/flood/parts'
import { disasterVar } from '../config/disasterTypes'
import { useHazard } from '../hooks/useHazard'
import { formatDay, levelLabel, levelVar } from '../lib/risk'
import { formatIndian, formatLakh, formatPercent } from '../lib/format'

const SECTIONS = [
  ['prep-ranking', 'Where to prepare first'],
  ['prep-actions', 'Recommended actions'],
  ['resp-ranking', 'Who needs help first'],
  ['resp-detail', 'Response detail'],
  ['method', 'How it works'],
]

const HORIZONS = [3, 7, 14]
const BASIS_LABEL = { standard: 'Standard', data: 'Data', assumption: 'Assumption', 'standard + assumption': 'Standard + assumption' }
const TIER_SHORT = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'Monitor' }
const TIER_LEVEL = { 1: 'critical', 2: 'high', 3: 'medium', 4: 'low' }

const NOUN = { earthquake: 'earthquake', flood: 'flood', cyclone: 'cyclone' }
const AREA_WORD = { earthquake: 'state', flood: 'district', cyclone: 'state' }

const HEADER = {
  earthquake: 'Structural retrofitting, drills and search-and-rescue pre-positioning where earthquake risk is high, and the rescue, medical, food, water and shelter resources to plan for one.',
  flood: 'Drainage, evacuation routes and boat and relief-camp pre-positioning where flood risk is high, and the rescue, medical, food, water and shelter resources to plan for one.',
  cyclone: 'Early-warning readiness, coastal evacuation routes and wind-resistant shelters where cyclone risk is high, and the evacuation, medical, food, water and shelter resources to plan for one.',
}

function TierPill({ tier, label }) {
  return (
    <span className={`tier-pill risk-${TIER_LEVEL[tier]}`} title={label}>
      {TIER_SHORT[tier]}
      <span className="tier-pill-text">{label.split(': ')[1] ?? ''}</span>
    </span>
  )
}

/** Two labelled phases, matching the problem statement: before, then during and after. */
function PhaseHeader({ id, step, title, text }) {
  return (
    <header className="phase-header" id={id}>
      <p className="phase-step">{step}</p>
      <h2 className="phase-title">{title}</h2>
      <p className="phase-text">{text}</p>
    </header>
  )
}

function tiles(kind, plan) {
  const t = plan.totals
  const common = {
    people: { title: kind === 'cyclone' ? 'People to evacuate' : 'People needing assistance', value: formatLakh(t.people),
      sub: `${formatIndian(t.people)} in total`, icon: Users },
    medical: { title: 'Medical teams', value: formatIndian(t.medical_teams), sub: 'WHO EMT Type 1 (mobile) equivalents', icon: HeartPulse },
    food: { title: 'Food rations', value: formatLakh(t.food_rations), sub: `person-days over ${plan.days} days`, icon: Package },
    water: { title: 'Water', value: `${formatLakh(t.water_litres)} L`, sub: `15 L a person a day for ${plan.days} days`, icon: Droplets },
    shelter: { title: 'Shelter places', value: formatLakh(t.shelter_places),
      sub: kind === 'flood' ? `${formatLakh(t.long_stay_places)} long-stay (homeless)` : `${formatLakh(t.shelter_m2)} m² at 3.5 m² each`, icon: Home },
  }
  const special = {
    flood: { title: 'Rescue boats', value: formatIndian(t.rescue_boats), sub: 'for people on low-lying land', icon: Ship },
    earthquake: { title: 'Search-and-rescue teams', value: formatIndian(t.rescue_teams), sub: '1 per 5,000 people', icon: LifeBuoy },
    cyclone: { title: 'Cyclone shelters', value: formatIndian(t.cyclone_shelters), sub: '1,000 people each', icon: Building2 },
  }[kind]
  return [common.people, special, common.medical, common.food, common.water, common.shelter]
}

function PrepRankingBlock({ kind, plan, selected, onSelect }) {
  const area = AREA_WORD[kind]
  const flagged = plan.regions.filter((r) => r.tier <= 2)
  const first = plan.regions[0]
  const columns = [
    { key: 'rank', label: '#', numeric: true, defaultDir: 'asc' },
    {
      key: 'region',
      label: area === 'district' ? 'District' : 'State or UT',
      render: (row) => (
        <button type="button" className="row-button" onClick={() => onSelect(row.region)}>
          {row.region}
        </button>
      ),
    },
    { key: 'tier', label: 'Preparedness priority', numeric: true, defaultDir: 'asc', render: (row) => <TierPill tier={row.tier} label={row.preparedness_label} /> },
    { key: 'probability', label: 'Risk', numeric: true, render: (row) => <RiskPill level={row.level} probability={row.probability} /> },
    { key: 'population', label: 'Population (2011)', numeric: true, render: (row) => formatLakh(row.population) },
    { key: 'actions', label: 'Actions', numeric: true, sortValue: (row) => row.actions.length, render: (row) => row.actions.length || '—' },
  ]
  return (
    <Block
      id="prep-ranking"
      index={1}
      title={`Preparedness: where to prepare first for ${NOUN[kind]}s`}
      lead={`Every ${area}, ordered by Level 2 risk level, then by the people who could need help. ${flagged.length} of ${plan.regions.length} are at high or critical risk and get the full action list.`}
    >
      <InfoCard
        title={
          flagged.length
            ? `${flagged.length} ${flagged.length === 1 ? area : `${area}s`} at high or critical ${NOUN[kind]} risk; ${first.region} comes first`
            : `No ${area} is at high or critical ${NOUN[kind]} risk`
        }
        insight={
          plan.kind === 'backtest'
            ? `Back-test month ${formatDay(plan.window_start)} to ${formatDay(plan.as_of)}, scored by the Level 2 model that never saw it.`
            : kind === 'flood'
              ? `Latest 30 days, ${formatDay(plan.window_start)} to ${formatDay(plan.as_of)}.`
              : `Long-run index, ${plan.window_start}–${plan.as_of}: it does not change with the weather.`
        }
        badge={<SourceBadge kind="formula" source={kind === 'flood' ? ['ifi', 'nasa_power'] : ['census2011']} detail="rule table" />}
      >
        <SortableTable
          caption={`Preparedness priority by ${area}`}
          columns={columns}
          rows={plan.regions}
          rowKey={(row) => row.region}
          initialSort={{ key: 'rank', dir: 'asc' }}
          rowStyle={(row) => (row.region === selected ? { background: 'var(--surface-hover)' } : undefined)}
        />
      </InfoCard>
    </Block>
  )
}

function PrepActionsBlock({ kind, region }) {
  const groups = Object.entries(
    region.actions.reduce((acc, action) => {
      ;(acc[action.category] ??= []).push(action)
      return acc
    }, {}),
  )
  return (
    <Block
      id="prep-actions"
      index={2}
      title={`Preparedness: recommended actions for ${region.region}`}
      lead="Each action comes from a fixed rule that fires at a minimum risk level, with the reason it fired. They are general practice, to be checked against national and state guidance."
    >
      <InfoCard
        title={
          region.actions.length
            ? `${region.actions.length} actions for ${region.region}: ${region.preparedness_label.toLowerCase()}`
            : `${region.region}: ${levelLabel(region.level).toLowerCase()} ${NOUN[kind]} risk, no actions triggered`
        }
        insight={region.reasoning}
        badge={<SourceBadge kind="formula" detail="rule table" />}
      >
        <div className="detail-head" style={{ '--level': levelVar(region.level) }}>
          <RiskPill level={region.level} probability={region.probability} />
          <span className="text-sm secondary">
            {formatLakh(region.population)} people
            {region.low_lying_pct !== null && region.low_lying_pct !== undefined && ` · ${region.low_lying_pct.toFixed(1)}% of land below 10 m`}
          </span>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm secondary" style={{ marginTop: 'var(--space-3)' }}>
            Below the medium threshold, so no preparedness actions are triggered; routine monitoring only. Pick a higher-risk
            {` ${AREA_WORD[kind]}`} in the table above to see the full list.
          </p>
        ) : (
          <div className="action-groups">
            {groups.map(([category, actions]) => (
              <section key={category} className="action-group">
                <h4 className="action-category">{category}</h4>
                <ul>
                  {actions.map((action) => (
                    <li key={action.id}>
                      <span className="action-text">{action.action}</span>
                      <span className="action-why">Why: {action.why}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        <p className="card-footnote" style={{ marginTop: 'var(--space-3)' }}>
          Basis for every action: general disaster-management practice; confirm against NDMA and State Disaster Management
          Authority guidance.{' '}
          <Link to={`/risk?type=${kind}`} className="inline-link">
            See the risk behind this <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </p>
      </InfoCard>
    </Block>
  )
}

function RespRankingBlock({ kind, plan, selected, onSelect, onReplay }) {
  const active = plan.regions.filter((r) => r.resources.people > 0)
  const first = plan.regions[0]
  const extra = {
    flood: { key: 'rescue_boats', label: 'Boats' },
    earthquake: { key: 'rescue_teams', label: 'Rescue teams' },
    cyclone: { key: 'cyclone_shelters', label: 'Cyclone shelters' },
  }[kind]
  const columns = [
    { key: 'rank', label: '#', numeric: true, defaultDir: 'asc' },
    {
      key: 'region',
      label: AREA_WORD[kind] === 'district' ? 'District' : 'State or UT',
      render: (row) => (
        <button type="button" className="row-button" onClick={() => onSelect(row.region)}>
          {row.region}
        </button>
      ),
    },
    { key: 'tier', label: 'Priority', numeric: true, defaultDir: 'asc', render: (row) => <TierPill tier={row.tier} label={row.response_label} /> },
    { key: 'probability', label: 'Risk', numeric: true, render: (row) => <RiskPill level={row.level} probability={row.probability} /> },
    { key: 'people', label: kind === 'cyclone' ? 'To evacuate' : 'People', numeric: true, sortValue: (row) => row.resources.people, render: (row) => formatIndian(row.resources.people) },
    { key: extra.key, label: extra.label, numeric: true, sortValue: (row) => row.resources[extra.key], render: (row) => formatIndian(row.resources[extra.key]) },
    { key: 'medical', label: 'Medical teams', numeric: true, sortValue: (row) => row.resources.medical_teams, render: (row) => formatIndian(row.resources.medical_teams) },
    { key: 'food', label: 'Food rations', numeric: true, sortValue: (row) => row.resources.food_rations, render: (row) => formatLakh(row.resources.food_rations) },
    { key: 'water', label: 'Water (L)', numeric: true, sortValue: (row) => row.resources.water_litres, render: (row) => formatLakh(row.resources.water_litres) },
    { key: 'shelter', label: 'Shelter places', numeric: true, sortValue: (row) => row.resources.shelter_places, render: (row) => formatIndian(row.resources.shelter_places) },
  ]
  return (
    <Block
      id="resp-ranking"
      index={3}
      title={`Response: who needs help most urgently in a ${NOUN[kind]}`}
      lead="Resources to plan for if a damaging event happens, in priority order: risk level first, then the number of people who may need assistance, then the risk probability."
    >
      <div className="grid grid-kpi">
        {tiles(kind, plan).map((tile) => {
          const Icon = tile.icon
          return (
            <KpiCard key={tile.title} title={tile.title} value={tile.value} sub={tile.sub}
              icon={<Icon size={16} aria-hidden="true" />} accent={disasterVar(kind)} />
          )
        })}
      </div>
      {kind === 'flood' && plan.kind === 'current' && active.length === 0 && (
        <p className="callout">
          <LifeBuoy size={16} aria-hidden="true" />
          <span>
            The last 30 days were quiet, so nothing is committed.{' '}
            <button type="button" className="row-button" onClick={() => onReplay('2018-08')}>
              Replay August 2018
            </button>{' '}
            to see the plan under a major flood.
          </span>
        </p>
      )}
      <InfoCard
        title={
          active.length
            ? `${first.region} is first in line: ${formatIndian(first.resources.people)} people may need assistance`
            : 'No resources committed: every region is at low risk'
        }
        insight={`Planning horizon ${plan.days} days. Select a ${AREA_WORD[kind]} for its breakdown. The number of people is a planning scale (${Object.entries(plan.exposure).filter(([, v]) => v > 0).map(([level, v]) => `${level} ${formatPercent(v, v < 0.01 ? 2 : 1)}`).join(', ')} of population), not a forecast.`}
        badge={<SourceBadge kind="formula" source="census2011" />}
      >
        <SortableTable
          caption="Resource estimate in priority order"
          columns={columns}
          rows={plan.regions}
          rowKey={(row) => row.region}
          initialSort={{ key: 'rank', dir: 'asc' }}
          rowStyle={(row) => (row.region === selected ? { background: 'var(--surface-hover)' } : undefined)}
        />
      </InfoCard>
    </Block>
  )
}

function detailLines(kind, row, plan) {
  const r = row.resources
  const exposure = plan.exposure[row.level]
  const lines = [
    { label: kind === 'cyclone' ? 'People to evacuate' : 'People needing assistance', value: formatIndian(r.people), icon: Users,
      how: `${formatIndian(row.population)} people × ${formatPercent(exposure, exposure < 0.01 ? 2 : 1)} (${row.level} risk)` },
  ]
  if (kind === 'flood') {
    lines.push({ label: 'Rescue boats', value: formatIndian(r.rescue_boats), icon: Ship,
      how: `${formatIndian(r.people)} × ${row.low_lying_pct.toFixed(1)}% on land below 10 m ÷ 200 people per boat` })
  } else if (kind === 'earthquake') {
    lines.push({ label: 'Search-and-rescue teams', value: formatIndian(r.rescue_teams), icon: LifeBuoy,
      how: `${formatIndian(r.people)} ÷ 5,000 people per team` })
  } else {
    lines.push({ label: 'Cyclone shelters', value: formatIndian(r.cyclone_shelters), icon: Building2,
      how: `${formatIndian(r.people)} ÷ 1,000 people per shelter` })
  }
  lines.push(
    { label: 'Medical teams', value: formatIndian(r.medical_teams), icon: HeartPulse,
      how: `${formatIndian(r.people)} × 2% needing care each day ÷ 50 patients per team a day` },
    { label: 'Food rations', value: formatIndian(r.food_rations), icon: Package,
      how: `${formatIndian(r.people)} × ${plan.days} days, one ration (2,100 kcal) per person per day` },
    { label: 'Water', value: `${formatIndian(r.water_litres)} L`, icon: Droplets,
      how: `${formatIndian(r.people)} × 15 L × ${plan.days} days (Sphere minimum)` },
    { label: 'Shelter places', value: formatIndian(r.shelter_places), icon: Home,
      how: `${formatIndian(r.shelter_m2)} m² at 3.5 m² a person${kind === 'flood' ? `; ${formatIndian(r.long_stay_places)} long-stay at the EM-DAT homeless share (${formatPercent(plan.homeless_share.value, 1)})` : ''}` },
  )
  return lines
}

function RespDetailBlock({ kind, plan, region }) {
  const lines = detailLines(kind, region, plan)
  return (
    <Block id="resp-detail" index={4} title={`Response: breakdown for ${region.region}`} lead="The arithmetic behind each line.">
      <InfoCard
        title={`#${region.rank} ${region.region}: ${region.response_label}`}
        insight={region.reasoning}
        badge={<SourceBadge kind="formula" source="census2011" />}
      >
        <div className="detail-head" style={{ '--level': levelVar(region.level) }}>
          <RiskPill level={region.level} probability={region.probability} />
          <span className="text-sm secondary">{formatLakh(region.population)} people</span>
        </div>
        {region.observed !== null && region.observed !== undefined && (
          <p className="text-sm secondary" style={{ marginTop: 'var(--space-2)' }}>
            In this back-test month the India Flood Inventory {region.observed ? 'recorded a flood' : 'recorded no flood'} in {region.region}.
          </p>
        )}
        <ul className="resource-lines">
          {lines.map((line) => {
            const Icon = line.icon
            return (
              <li key={line.label}>
                <span className="resource-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="resource-text">
                  <span className="resource-label">{line.label}</span>
                  <span className="resource-how">{line.how}</span>
                </span>
                <span className="resource-value">{line.value}</span>
              </li>
            )
          })}
        </ul>
      </InfoCard>
    </Block>
  )
}

function MethodBlock({ kind, plan }) {
  const h = plan.homeless_share
  const ruleColumns = [
    { key: 'category', label: 'Category' },
    { key: 'action', label: 'Action' },
    { key: 'min_level', label: 'Fires from', render: (row) => <RiskPill level={row.min_level} compact /> },
  ]
  const paramColumns = [
    { key: 'label', label: 'Parameter' },
    { key: 'value', label: 'Value' },
    { key: 'basis', label: 'Basis', render: (row) => <span className={`basis-chip basis-${row.basis.split(' ')[0]}`}>{BASIS_LABEL[row.basis]}</span> },
    { key: 'note', label: 'Where it comes from' },
  ]
  return (
    <Block
      id="method"
      index={5}
      title="How the recommendations work"
      lead="Rules and a formula, not a model: every action and number is Level 2 output, public data, a published standard or a stated assumption."
    >
      <InfoCard
        title={`Preparedness rules for ${NOUN[kind]}s`}
        insight="A rule fires when the region's risk level reaches its minimum level; a few also need a condition (for example, low-lying land)."
        badge={<SourceBadge kind="formula" />}
      >
        <SortableTable caption="Preparedness rules" columns={ruleColumns} rows={plan.rules} rowKey={(row) => row.id} />
      </InfoCard>
      <InfoCard title="Response formula, per region" insight="Rounded up where a whole team, boat or shelter is needed." badge={<SourceBadge kind="formula" />}>
        <ol className="formula-list">
          {plan.formula.map((line) => (
            <li key={line}>
              <code>{line}</code>
            </li>
          ))}
        </ol>
      </InfoCard>
      <InfoCard
        title="Parameters and their basis"
        insight="Standards are from the Sphere Handbook (2018) and WHO's Emergency Medical Team classification. Assumptions should be replaced by the State Disaster Management Authority's own planning figures."
        badge={<SourceBadge kind="formula" />}
      >
        <SortableTable caption="Recommendation parameters" columns={paramColumns} rows={plan.parameters} rowKey={(row) => row.key} />
      </InfoCard>
      {kind === 'flood' && (
        <InfoCard
          title={`Long-stay shelter uses Level 1 data: EM-DAT records ${formatPercent(h.value, 1)} of people affected by floods in India as left homeless`}
          insight={`${formatIndian(h.homeless)} homeless of ${formatLakh(h.total_affected)} affected, over the ${h.records} EM-DAT India flood records (${h.years?.[0]}–${h.years?.[1]}) that report both.`}
          badge={<SourceBadge source="emdat" />}
        >
          <p className="text-sm secondary">
            The same EM-DAT data drives the{' '}
            <Link to="/flood" className="inline-link">
              Flood page’s history <ArrowRight size={12} aria-hidden="true" />
            </Link>
            .
          </p>
        </InfoCard>
      )}
      <InfoCard title="What the recommendations do not account for" badge={<SourceBadge kind="formula" />}>
        <UnavailableList items={plan.not_included} title="Not included" />
      </InfoCard>
    </Block>
  )
}

function Plan({ kind }) {
  const [scenario, setScenario] = useState('current')
  const [days, setDays] = useState(7)
  const [selected, setSelected] = useState(null)
  const scenarios = useApi(() => api.floodRisk(), [], { enabled: kind === 'flood' })
  const { data: plan, error, loading, reload } = useApi(() => api.recommendations(kind, { scenario, days }), [kind, scenario, days])

  const scenarioList = scenarios.data?.scenarios ?? [{ id: 'current', kind: 'current' }]
  const meta = scenarioList.find((item) => item.id === scenario)
  const region = plan ? (plan.regions.find((r) => r.region === selected) ?? plan.regions[0]) : null

  const pick = (name, target) => {
    setSelected(name)
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const replay = (id) => {
    setScenario(id)
    setSelected(null)
  }

  return (
    <>
      <div className="alloc-controls">
        {kind === 'flood' ? (
          <div>
            <span className="field-label">Flood risk scenario (from Level 2)</span>
            <ScenarioSwitch scenarios={scenarioList} value={scenario} onChange={replay} />
            {meta?.kind === 'backtest' && <p className="text-xs secondary" style={{ marginTop: 6 }}>{meta.note}</p>}
          </div>
        ) : (
          <div>
            <span className="field-label">Risk basis (from Level 2)</span>
            <p className="text-sm secondary" style={{ maxWidth: '46ch' }}>
              {kind === 'earthquake' ? 'Earthquake' : 'Cyclone'} risk is a long-run statistical index (one view), not a weekly forecast.
            </p>
          </div>
        )}
        <div>
          <span className="field-label">Response planning horizon</span>
          <div className="seg" role="group" aria-label="Planning horizon">
            {HORIZONS.map((value) => (
              <button key={value} type="button" className="seg-btn" aria-pressed={days === value} onClick={() => setDays(value)}>
                {value} days
              </button>
            ))}
          </div>
        </div>
      </div>

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

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading || !plan ? (
        <>
          <SkeletonCard height={160} />
          <SkeletonCard height={360} />
        </>
      ) : (
        <>
          <PhaseHeader
            id="preparedness"
            step="Part 1 · Before a disaster"
            title="Preparedness"
            text="What to build, plan and pre-position now, where the risk is highest."
          />
          <PrepRankingBlock kind={kind} plan={plan} selected={region.region} onSelect={(name) => pick(name, 'prep-actions')} />
          <PrepActionsBlock kind={kind} region={region} />
          <PhaseHeader
            id="response"
            step="Part 2 · During and after"
            title="Response"
            text="What to have ready to deliver if a damaging event happens: who needs help first, and how much."
          />
          <RespRankingBlock kind={kind} plan={plan} selected={region.region} onSelect={(name) => pick(name, 'resp-detail')} onReplay={replay} />
          <RespDetailBlock kind={kind} plan={plan} region={region} />
          <MethodBlock kind={kind} plan={plan} />
        </>
      )}
    </>
  )
}

/**
 * Level 3: preparedness (before) and response (during and after)
 * recommendations for earthquakes, floods and cyclones, from the Level 2 risk of
 * the selected hazard. Reads /api/recommendations/{hazard}.
 */
export default function Recommendations() {
  const [hazard, setHazard] = useHazard()
  return (
    <div className="stack disaster-page" style={{ '--dt': disasterVar(hazard) }}>
      <DisasterHeader
        type={{ id: hazard, icon: LifeBuoy, label: 'Preparedness & Response Recommendations', definition: HEADER[hazard] }}
        eyebrow={`Level 3 · Recommendation · ${hazard === 'flood' ? 'Kerala districts' : 'Indian states'}`}
        badges={
          <>
            <SourceBadge kind="formula" source="census2011" />
            <SourceBadge kind="index" detail="Level 2 risk" />
          </>
        }
      />
      <TypeSwitch value={hazard} onChange={setHazard} />
      <LevelChain current="recommend" hazard={hazard} />
      <p className="callout callout-warn">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>
          <strong>Decision-support estimate, not an authoritative dispatch order.</strong> It applies fixed rules and
          standard planning figures to modelled risk and 2011 census population. It does not know the stock, teams or shelters
          already in place. Confirm against NDMA, the State Disaster Management Authority and district emergency
          operations centres before moving anything.
        </span>
      </p>
      <Plan key={hazard} kind={hazard} />
    </div>
  )
}
