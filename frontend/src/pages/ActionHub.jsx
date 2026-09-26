import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClipboardList, Database, ShieldAlert, Siren, Users, Wrench } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useToast } from '../context/ToastContext'
import { DisasterHeader } from '../components/DisasterHeader'
import SourceBadge from '../components/SourceBadge'
import { firebaseConfigured, REQUIRED_KEYS } from '../lib/firebase'
import { savePlan, useActionHubData } from '../lib/actionHubStore'
import { planIdFor } from '../lib/actionHub'
import RiskTab from './actionHub/RiskTab'
import NeedsTab from './actionHub/NeedsTab'
import PeopleTab from './actionHub/PeopleTab'
import OperationsTab from './actionHub/OperationsTab'
import AssignModal from './actionHub/AssignModal'
import '../styles/hazard-themes.css'
import '../styles/action-hub.css'

const TABS = [
  { id: 'risk', label: 'Risk', icon: ShieldAlert },
  { id: 'needs', label: 'Needs', icon: ClipboardList },
  { id: 'people', label: 'People', icon: Users },
  { id: 'operations', label: 'Operations', icon: Wrench },
]

/** Per-browser conveniences only; the Action Hub's own data lives in Firestore. */
const local = {
  get: (key) => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set: (key, value) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Private mode: the preference just is not remembered.
    }
  },
}
const SEEN_KEY = 'diq:action-hub:seen-task'
const VIEWER_KEY = 'diq:action-hub:viewing-as'

function SetupNotice({ status, error }) {
  if (status === 'ready' || status === 'loading') return null
  return (
    <div className="callout callout-coverage ah-setup" role="status">
      <Database size={16} aria-hidden="true" />
      <div>
        <strong>{status === 'off' ? 'Firebase is not configured.' : 'Firebase is not reachable.'}</strong>{' '}
        {status === 'off' ? 'The Risk tab and the needs lists work; saving plans, people and tasks needs the project’s Firestore.' : error}
        {status === 'off' && (
          <ol>
            <li>
              Firebase console → Project settings → Your apps → Web app: copy the config into <code>frontend/.env.local</code> as{' '}
              {REQUIRED_KEYS.map((key, index) => (
                <span key={key}>
                  {index > 0 && ', '}
                  <code>{key}</code>
                </span>
              ))}
              , then restart the dev server.
            </li>
            <li>Authentication → Sign-in method: enable Anonymous.</li>
            <li>
              Firestore Database → Rules: paste <code>firestore.rules</code> from the repo root and publish.
            </li>
          </ol>
        )}
      </div>
    </div>
  )
}

/**
 * Action Hub: turn the Level 2 risk into assigned work. Risk (high-risk
 * areas) → Needs (a plan per area, from Gemini) → People (responders) →
 * Operations (tasks, progress updates and readiness). Plans, people and tasks
 * are stored in Firebase Cloud Firestore and update live on every open page.
 */
export default function ActionHub() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((item) => item.id === params.get('tab')) ? params.get('tab') : 'risk'
  const riskId = params.get('area')
  const toast = useToast()

  const data = useActionHubData()
  const ready = data.status === 'ready'
  const areasApi = useApi(() => api.actionHubRiskAreas(), [])
  const areas = areasApi.data?.areas ?? []

  const [generation, setGeneration] = useState({ riskId: null, generating: false, error: null, localPlan: null })
  const [assign, setAssign] = useState(null)
  const [needContext, setNeedContext] = useState(null)
  const [viewingAs, setViewingAsState] = useState(() => local.get(VIEWER_KEY) ?? '')
  const [seen, setSeen] = useState(() => Number(local.get(SEEN_KEY) ?? 0))

  const savedPlan = riskId ? data.plans.find((plan) => plan.id === planIdFor(riskId)) : null
  const plan = savedPlan ?? (generation.riskId === riskId ? generation.localPlan : null)
  const area =
    areas.find((item) => item.id === riskId) ??
    (savedPlan
      ? {
          id: riskId,
          area: savedPlan.area,
          state: savedPlan.state,
          hazard: savedPlan.hazard,
          level: savedPlan.level,
          population: savedPlan.population,
        }
      : null)

  const generate = async (regenerate) => {
    if (!area) return
    setGeneration({ riskId: area.id, generating: true, error: null, localPlan: null })
    try {
      const result = await api.actionHubNeeds(area)
      const next = {
        riskId: area.id,
        area: area.area,
        state: area.state,
        hazard: area.hazard,
        level: area.level,
        population: area.population ?? null,
        needs: result.needs,
        source: result.source,
        model: result.model ?? '',
        fallbackReason: result.fallback_reason ?? '',
      }
      if (ready) await savePlan(planIdFor(area.id), next)
      setGeneration({ riskId: area.id, generating: false, error: null, localPlan: ready ? null : { ...next, id: planIdFor(area.id) } })
      if (regenerate) toast.success(`New needs list for ${area.area}`)
    } catch (error) {
      setGeneration({ riskId: area.id, generating: false, error: error.message, localPlan: null })
    }
  }

  // Opening the Needs tab for an area without a plan generates one (once).
  const autoStarted = useRef(new Set())
  useEffect(() => {
    if (tab !== 'needs' || !area || savedPlan || data.status === 'loading') return
    if (autoStarted.current.has(area.id)) return
    autoStarted.current.add(area.id)
    generate(false)
    // Runs once per area; `generate` reads the current area and connection when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, area?.id, savedPlan?.id, data.status])

  // Red dot on Operations for tasks created since this browser last looked;
  // a toast when one is assigned to the person this browser is viewing as.
  const maxNumber = data.tasks.reduce((max, task) => Math.max(max, task.number ?? 0), 0)
  const knownTasks = useRef(null)
  useEffect(() => {
    if (!ready) return
    const ids = new Set(data.tasks.map((task) => task.id))
    if (knownTasks.current) {
      data.tasks
        .filter((task) => !knownTasks.current.has(task.id) && task.assigneeId === viewingAs)
        .forEach((task) => toast.push(`New task #${task.number} assigned to ${task.assigneeName}: ${task.need}`))
    }
    knownTasks.current = ids
  }, [data.tasks, ready, viewingAs, toast])
  const unseen = tab !== 'operations' && maxNumber > seen

  // Entering or leaving Operations counts as having seen every task so far.
  const go = (nextTab, nextArea = riskId) => {
    if ((nextTab === 'operations' || tab === 'operations') && maxNumber > seen) {
      setSeen(maxNumber)
      local.set(SEEN_KEY, String(maxNumber))
    }
    const next = { tab: nextTab }
    if (nextArea) next.area = nextArea
    setParams(next)
  }

  const setViewingAs = (id) => {
    setViewingAsState(id)
    local.set(VIEWER_KEY, id)
  }

  const openAssign = (context) => {
    if (context.need) setNeedContext({ plan: context.plan, need: context.need })
    setAssign(context)
  }

  return (
    <div className="stack hazard-page overview-page ah-page" data-hazard="overview">
      <DisasterHeader
        type={{
          id: 'overview',
          icon: Siren,
          label: 'Action Hub',
          definition:
            'From risk to action: pick a high-risk area, get its needs list, assign each need to a responder, and track every task to delivery and the area’s readiness.',
        }}
        eyebrow="Coordination · live"
        badges={
          <>
            <SourceBadge kind="model" detail="Level 2 risk" />
            <SourceBadge source="gemini" detail="needs lists" />
            <span className={`ah-conn ah-conn-${data.status}`}>
              <span aria-hidden="true" />{' '}
              {firebaseConfigured
                ? { ready: 'Firebase live', loading: 'Connecting…', error: 'Firebase error' }[data.status]
                : 'Firebase not configured'}
            </span>
          </>
        }
      />
      <SetupNotice status={data.status} error={data.error} />

      <nav className="ah-tabs" aria-label="Action Hub sections">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="ah-tab"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => go(item.id)}
          >
            <span className="ah-tab-no" aria-hidden="true">
              {index + 1}
            </span>
            <item.icon size={16} aria-hidden="true" />
            {item.label}
            {item.id === 'operations' && unseen && (
              <span className="ah-dot-new">
                <span className="visually-hidden">(new tasks)</span>
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'risk' && <RiskTab areasApi={areasApi} plans={data.plans} onPlan={(row) => go('needs', row.id)} />}
      {tab === 'needs' && (
        <NeedsTab
          area={area}
          plan={plan}
          plans={data.plans}
          tasks={data.tasks}
          generating={generation.generating && generation.riskId === riskId}
          error={generation.riskId === riskId ? generation.error : null}
          canSave={ready}
          onGenerate={generate}
          onAssign={(need) => openAssign({ plan, need })}
          onOpenPlan={(id) => go('needs', id)}
        />
      )}
      {tab === 'people' &&
        (ready ? (
          <PeopleTab
            responders={data.responders}
            tasks={data.tasks}
            needContext={needContext}
            onDismissNeed={() => setNeedContext(null)}
            onAssign={openAssign}
          />
        ) : (
          data.status === 'loading' && <p className="text-sm secondary">Connecting to Firebase…</p>
        ))}
      {tab === 'operations' &&
        (ready ? (
          <OperationsTab
            responders={data.responders}
            tasks={data.tasks}
            plans={data.plans}
            viewingAs={viewingAs}
            setViewingAs={setViewingAs}
          />
        ) : (
          data.status === 'loading' && <p className="text-sm secondary">Connecting to Firebase…</p>
        ))}

      {assign && (
        <AssignModal
          context={assign}
          plans={data.plans}
          responders={data.responders}
          tasks={data.tasks}
          onClose={() => setAssign(null)}
          onCreated={(number, person) => {
            setAssign(null)
            toast.success(`Task #${number} assigned to ${person.name}`)
          }}
        />
      )}
    </div>
  )
}
