import { useState } from 'react'
import { Camera, CheckCircle2, Clock, ListChecks, LocateFixed, MapPin, Package, TriangleAlert, User } from 'lucide-react'
import KpiCard from '../../components/KpiCard'
import { InfoCard } from '../../components/history/Block'
import { useToast } from '../../context/ToastContext'
import { getDisasterType } from '../../config/disasterTypes'
import {
  STATUSES,
  formatDeadline,
  nextStatuses,
  overallReadiness,
  planReadiness,
  statusGroup,
  statusLabel,
  statusProgress,
  taskLabel,
  taskStats,
  taskSteps,
} from '../../lib/actionHub'
import { imageToDataUrl, submitUpdate, useTaskUpdates } from '../../lib/actionHubStore'
import { PriorityBadge, ReadinessBar, RoleBadge, StatusBadge } from './parts'

function TaskHistory({ task }) {
  const updates = useTaskUpdates(task.id)
  if (updates === null) return <p className="text-xs secondary">Loading updates…</p>
  if (updates.length === 0) return <p className="text-xs secondary">No updates yet.</p>
  return (
    <ol className="ah-history">
      {updates.map((update) => (
        <li key={update.id}>
          <StatusBadge status={update.status} />
          <span className="text-xs secondary">
            {new Date(update.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            {update.by && ` · ${update.by}`}
            {update.lat != null && (
              <>
                {' · '}
                <a href={`https://www.openstreetmap.org/?mlat=${update.lat}&mlon=${update.lon}#map=15/${update.lat}/${update.lon}`} target="_blank" rel="noreferrer noopener">
                  location
                </a>
              </>
            )}
          </span>
          {update.note && <p className="text-sm">{update.note}</p>}
          {update.photo && <img src={update.photo} alt={`Proof photo for ${taskLabel(task)}, ${statusLabel(update.status)}`} className="ah-proof" />}
        </li>
      ))}
    </ol>
  )
}

function TaskCard({ task }) {
  const [open, setOpen] = useState(false)
  return (
    <article className={`card ah-task ah-task-${statusGroup(task.status)}`}>
      <div className="ah-task-top">
        <span className="mono ah-task-no">{taskLabel(task)}</span>
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
      </div>
      <h4 className="ah-task-title">{task.need}</h4>
      <p className="text-sm secondary">
        {task.area} · {getDisasterType(task.hazard).shortLabel}
      </p>
      <p className="text-sm ah-task-who">
        <User size={13} aria-hidden="true" /> {task.assigneeName} <RoleBadge role={task.assigneeRole} />
      </p>
      <p className="text-sm secondary">
        <Clock size={13} aria-hidden="true" /> Due {formatDeadline(task.deadline)}
      </p>
      <ReadinessBar value={statusProgress(task.status)} label={`${taskLabel(task)} progress`} />
      <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide details' : 'Details and updates'}
      </button>
      {open && (
        <div className="ah-task-more">
          <p className="text-sm">
            {task.from && `From ${task.from}`} {task.to && `→ ${task.to}`}
            {task.details && <span className="secondary"> · {task.details}</span>}
          </p>
          <TaskHistory task={task} />
        </div>
      )}
    </article>
  )
}

function UpdateForm({ task, viewer }) {
  const toast = useToast()
  const options = nextStatuses(task.status)
  const [status, setStatus] = useState(options[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState('')
  const [location, setLocation] = useState(null)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const done = STATUSES.findIndex((s) => s.id === task.status)

  const locate = () => {
    if (!navigator.geolocation) {
      setError('This browser cannot share its location.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ lat: +position.coords.latitude.toFixed(5), lon: +position.coords.longitude.toFixed(5) })
        setLocating(false)
      },
      () => {
        setError('Location permission was refused or unavailable.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const pick = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setPhoto(await imageToDataUrl(file, 800, 0.7))
    } catch (err) {
      setError(err.message)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!status) return
    setSaving(true)
    setError(null)
    try {
      await submitUpdate(task, { status, note: note.trim().slice(0, 500), photo, location, by: viewer.name })
      toast.success(`Update submitted for Task ${taskLabel(task)}`)
      setNote('')
      setPhoto('')
      setLocation(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (options.length === 0) return null
  return (
    <form className="ah-update" onSubmit={submit}>
      <fieldset>
        <legend className="field-label">Update your progress</legend>
        <div className="ah-stepper">
          {STATUSES.map((step, index) => {
            const past = index <= done
            return (
              <label key={step.id} className={`ah-step${past ? ' is-done' : ''}${status === step.id ? ' is-chosen' : ''}`}>
                <input
                  type="radio"
                  name={`status-${task.id}`}
                  value={step.id}
                  checked={past ? false : status === step.id}
                  disabled={past}
                  onChange={() => setStatus(step.id)}
                />
                {past && <CheckCircle2 size={13} aria-hidden="true" />}
                {step.id === 'delivered' ? 'Mark Delivered' : step.label}
              </label>
            )
          })}
        </div>
      </fieldset>
      <div className="ah-update-row">
        <label className="btn btn-sm ah-file">
          <Camera size={14} aria-hidden="true" /> {photo ? 'Change photo' : 'Choose photo'}
          <input type="file" accept="image/*" capture="environment" onChange={pick} className="visually-hidden" />
        </label>
        <button type="button" className="btn btn-sm" onClick={locate} disabled={locating}>
          <LocateFixed size={14} aria-hidden="true" /> {location ? `${location.lat}, ${location.lon}` : locating ? 'Locating…' : 'My location'}
        </button>
        {photo && <img src={photo} alt="Chosen proof" className="ah-proof ah-proof-small" />}
      </div>
      <label className="ah-field">
        <span className="field-label">Notes (optional)</span>
        <textarea className="textarea" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error && (
        <p className="ah-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={saving || !status}>
        <CheckCircle2 size={16} aria-hidden="true" /> {saving ? 'Submitting…' : 'Submit Update'}
      </button>
    </form>
  )
}

function MyTask({ task, viewer }) {
  return (
    <article className={`card ah-mytask ah-task-${statusGroup(task.status)}`}>
      <div className="ah-task-top">
        <span className="mono ah-task-no">TASK {taskLabel(task)}</span>
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
      </div>
      <h3 className="ah-task-title">{task.need}</h3>
      <ul className="ah-facts">
        {task.from && <li><MapPin size={14} aria-hidden="true" /> From: {task.from}</li>}
        {task.to && <li><MapPin size={14} aria-hidden="true" /> To: {task.to}</li>}
        {task.details && <li><Package size={14} aria-hidden="true" /> {task.details}</li>}
        <li><Clock size={14} aria-hidden="true" /> Deadline: {formatDeadline(task.deadline)}</li>
        <li><TriangleAlert size={14} aria-hidden="true" /> Priority: {task.priority} · {task.area}</li>
      </ul>
      <h4 className="field-label">What you need to do</h4>
      <ol className="ah-steps">
        {taskSteps(task).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <UpdateForm key={task.status} task={task} viewer={viewer} />
    </article>
  )
}

function MyTasksView({ responders, tasks, viewingAs, setViewingAs }) {
  const viewer = responders.find((person) => person.id === viewingAs)
  const mine = viewer ? tasks.filter((task) => task.assigneeId === viewer.id) : []
  const active = mine.filter((task) => task.status !== 'delivered')
  const done = mine.filter((task) => task.status === 'delivered')
  return (
    <div className="stack">
      <label className="ah-viewing">
        <User size={16} aria-hidden="true" />
        <span className="field-label">Viewing as</span>
        <select className="select" value={viewingAs} onChange={(event) => setViewingAs(event.target.value)}>
          <option value="">Choose a responder…</option>
          {responders.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} ({person.role})
            </option>
          ))}
        </select>
      </label>
      {!viewer ? (
        <p className="text-sm secondary">Choose who you are to see your tasks. There is no login yet, so anyone can pick any name.</p>
      ) : (
        <>
          <h3 className="ah-section-title">Your active tasks ({active.length})</h3>
          {active.length === 0 && <p className="text-sm secondary">Nothing to do right now.</p>}
          {active.map((task) => (
            <MyTask key={task.id} task={task} viewer={viewer} />
          ))}
          {done.length > 0 && (
            <>
              <h3 className="ah-section-title">Completed ({done.length})</h3>
              <div className="ah-task-grid">
                {done.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

const FILTERS = [
  ['all', 'All'],
  ['pending', 'Pending'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
]

/** Stats, readiness per area, and the tasks: everyone's, or one responder's with the update form. */
export default function OperationsTab({ responders, tasks, plans, viewingAs, setViewingAs }) {
  const [view, setView] = useState(viewingAs ? 'mine' : 'all')
  const [filter, setFilter] = useState('all')
  const stats = taskStats(tasks)
  const readiness = overallReadiness(plans, tasks)
  const shown = filter === 'all' ? tasks : tasks.filter((task) => statusGroup(task.status) === filter)

  return (
    <div className="stack">
      <div className="grid grid-kpi ah-stats">
        <KpiCard title="Total tasks" value={stats.total} icon={<ListChecks size={16} aria-hidden="true" />} />
        <KpiCard title="Completed" value={stats.completed} className="ah-kpi-completed" />
        <KpiCard title="In progress" value={stats.inProgress} className="ah-kpi-progress" />
        <KpiCard title="Pending" value={stats.pending} className="ah-kpi-pending" />
        <KpiCard title="Overall readiness" value={`${readiness}%`} sub={`${plans.length} areas with an action plan`} />
      </div>

      {plans.length > 0 && (
        <InfoCard title="Readiness by area" insight="Mean preparedness of each area's needs.">
          <div className="ah-city-grid">
            {plans.map((plan) => (
              <div key={plan.id} className="ah-city" data-hazard={plan.hazard}>
                <p className="ah-city-name">{plan.area}</p>
                <p className="text-xs secondary">
                  {getDisasterType(plan.hazard).shortLabel} · {plan.needs.length} needs
                </p>
                <ReadinessBar value={planReadiness(plan, tasks)} label={`${plan.area} readiness`} />
              </div>
            ))}
          </div>
        </InfoCard>
      )}

      <div className="seg" role="group" aria-label="Task view">
        <button type="button" className="seg-btn" aria-pressed={view === 'mine'} onClick={() => setView('mine')}>
          My Tasks view
        </button>
        <button type="button" className="seg-btn" aria-pressed={view === 'all'} onClick={() => setView('all')}>
          All Tasks view
        </button>
      </div>

      {view === 'mine' ? (
        <MyTasksView responders={responders} tasks={tasks} viewingAs={viewingAs} setViewingAs={setViewingAs} />
      ) : (
        <div className="stack">
          <div className="seg seg-wrap" role="group" aria-label="Filter tasks">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className="seg-btn" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="text-sm secondary">{tasks.length === 0 ? 'No tasks yet. Assign one from the Needs or People tab.' : 'No tasks match this filter.'}</p>
          ) : (
            <div className="ah-task-grid">
              {shown.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
