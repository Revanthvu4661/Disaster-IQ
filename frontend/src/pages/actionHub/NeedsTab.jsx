import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react'
import SourceBadge from '../../components/SourceBadge'
import { InfoCard } from '../../components/history/Block'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui'
import { getDisasterType } from '../../config/disasterTypes'
import { needProgress, planReadiness } from '../../lib/actionHub'
import { formatLakh } from '../../lib/format'
import { PriorityBadge, ReadinessBar } from './parts'

function NeedsSkeleton() {
  return (
    <div className="stack" style={{ gap: 10 }} role="status" aria-label="Generating the needs list">
      <p className="text-sm secondary">
        <Sparkles size={14} aria-hidden="true" /> Asking Gemini for a needs list… this can take 20–40 seconds.
      </p>
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} height={34} />
      ))}
    </div>
  )
}

/** The action plan for one area: its needs, how far each has got, and an Assign button per need. */
export default function NeedsTab({ area, plan, plans, tasks, generating, error, canSave, onGenerate, onAssign, onOpenPlan }) {
  if (!area) {
    return (
      <div className="stack">
        <EmptyState message="Pick an area in the Risk tab and press Create Action Plan." />
        {plans.length > 0 && (
          <InfoCard title="Existing action plans" insight="Open one to keep assigning its needs.">
            <div className="ah-chips">
              {plans.map((item) => (
                <button key={item.id} type="button" className="btn btn-sm" onClick={() => onOpenPlan(item.riskId)}>
                  {item.area} · {getDisasterType(item.hazard).shortLabel} · {planReadiness(item, tasks)}%
                </button>
              ))}
            </div>
          </InfoCard>
        )}
      </div>
    )
  }

  const type = getDisasterType(area.hazard)
  const readiness = plan ? planReadiness(plan, tasks) : 0
  const planTasks = plan ? tasks.filter((task) => task.planId === plan.id) : []

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-heading">
          <h3 className="card-title">
            Action plan: {area.area === area.state ? area.area : `${area.area}, ${area.state}`}
          </h3>
          <p className="card-insight">
            {type.shortLabel} · {area.level} risk · {area.population ? `${formatLakh(area.population)} people` : 'population unavailable'}
          </p>
        </div>
        <div className="card-badge">
          {plan?.source === 'gemini' ? (
            <SourceBadge source="gemini" detail={plan.model} />
          ) : plan?.source === 'fallback' ? (
            <SourceBadge kind="formula" detail="standard list" note={`Gemini was not used: ${plan.fallbackReason}`} />
          ) : null}
        </div>
      </div>

      {plan && (
        <div className="ah-plan-ready">
          <span className="field-label">Area readiness</span>
          <ReadinessBar value={readiness} label={`${area.area} readiness`} />
          {plan.source === 'fallback' && (
            <p className="text-xs secondary">Standard needs for a {area.hazard}, because Gemini was not available ({plan.fallbackReason}).</p>
          )}
        </div>
      )}

      {error && <ErrorState compact message={error} onRetry={() => onGenerate(false)} />}
      {generating && <NeedsSkeleton />}

      {plan && !generating && (
        <div className="table-wrap">
          <table className="data ah-needs">
            <caption className="visually-hidden">Needs for {area.area}</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Need</th>
                <th scope="col">Category</th>
                <th scope="col">Quantity</th>
                <th scope="col">Priority</th>
                <th scope="col">Preparedness</th>
                <th scope="col">
                  <span className="visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.needs.map((need, index) => {
                const progress = needProgress(tasks, plan.id, need.id)
                const count = planTasks.filter((task) => task.needId === need.id).length
                return (
                  <tr key={need.id}>
                    <td className="mono">{index + 1}</td>
                    <th scope="row" className="ah-need-name">
                      {need.need}
                      {count > 0 && <span className="ah-basis">{count === 1 ? '1 task' : `${count} tasks`}</span>}
                    </th>
                    <td className="ah-category">{need.category}</td>
                    <td className="secondary">{need.quantity || '—'}</td>
                    <td>
                      <PriorityBadge priority={need.priority} />
                    </td>
                    <td>
                      <ReadinessBar value={progress} label={`${need.need} preparedness`} />
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => onAssign(need)} disabled={!canSave}>
                        Assign <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {plan && !generating && (
        <div className="ah-plan-foot">
          <p className="card-footnote">
            Preparedness per need is the furthest its task has got: assigned 10%, accepted 25%, collected 50%, in transit 75%, delivered 100%.
          </p>
          {canSave && planTasks.length === 0 && (
            <button type="button" className="btn btn-sm" onClick={() => onGenerate(true)}>
              <RefreshCw size={14} aria-hidden="true" /> Regenerate needs
            </button>
          )}
        </div>
      )}
    </section>
  )
}
