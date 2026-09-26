import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList, MapPin, Sparkles, X } from 'lucide-react'
import { activeTasksFor, availabilityLabel, smartMatches } from '../../lib/actionHub'
import { createTask } from '../../lib/actionHubStore'
import { Avatar, SmartMatchPanel } from './parts'

/** datetime-local value for 24 hours from now, in the browser's own clock. */
function defaultDeadline() {
  const date = new Date(Date.now() + 24 * 3_600_000)
  date.setMinutes(0, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`
}

/**
 * Task Assignment modal. Opened from a need (Needs tab, Smart Match) or from
 * a person (People tab); without a need it asks which need the task is for.
 */
export default function AssignModal({ context, plans, responders, tasks, onClose, onCreated }) {
  const needOptions = useMemo(
    () => plans.flatMap((plan) => plan.needs.map((need) => ({ key: `${plan.id}|${need.id}`, plan, need }))),
    [plans],
  )
  const [needKey, setNeedKey] = useState(context.plan && context.need ? `${context.plan.id}|${context.need.id}` : '')
  const chosen = needOptions.find((option) => option.key === needKey)
  const plan = chosen?.plan ?? context.plan
  const need = chosen?.need ?? context.need

  const [form, setForm] = useState(() => ({
    from: context.need?.from_hint ?? '',
    to: context.need?.to_hint ?? '',
    details: context.need?.quantity ?? '',
    deadline: defaultDeadline(),
  }))
  const [assigneeId, setAssigneeId] = useState(context.responder?.id ?? '')
  const [search, setSearch] = useState('')
  const [showMatch, setShowMatch] = useState(Boolean(context.need && !context.responder))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const dialogRef = useRef(null)

  // Prefill the locations when a need is picked in the modal.
  const pickNeed = (key) => {
    setNeedKey(key)
    const option = needOptions.find((item) => item.key === key)
    if (option) setForm((prev) => ({ ...prev, from: option.need.from_hint ?? '', to: option.need.to_hint ?? '', details: option.need.quantity ?? '' }))
  }

  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.querySelector('input, select, button')?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll('button, input, select, textarea')].filter((el) => !el.disabled)
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])

  const area = plan ? { area: plan.area, state: plan.state } : null
  const matches = need ? smartMatches(responders, tasks, need, area) : []
  const selected = responders.find((person) => person.id === assigneeId)
  const filtered = responders.filter((person) =>
    `${person.name} ${person.role} ${person.city}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const submit = async (event) => {
    event.preventDefault()
    if (!plan || !need || !selected) return
    setSaving(true)
    setError(null)
    try {
      const number = await createTask({
        planId: plan.id,
        needId: need.id,
        need: need.need.slice(0, 120),
        category: need.category,
        priority: need.priority,
        area: plan.area,
        state: plan.state,
        hazard: plan.hazard,
        from: form.from.trim().slice(0, 120),
        to: form.to.trim().slice(0, 120),
        details: form.details.trim().slice(0, 300),
        deadline: form.deadline ? new Date(form.deadline).toISOString() : '',
        assigneeId: selected.id,
        assigneeName: selected.name,
        assigneeRole: selected.role,
      })
      onCreated(number, selected)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="ah-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="ah-modal" role="dialog" aria-modal="true" aria-labelledby="ah-modal-title" ref={dialogRef} onSubmit={submit}>
        <div className="ah-modal-head">
          <h2 id="ah-modal-title">
            <ClipboardList size={18} aria-hidden="true" /> Assign Task
          </h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {context.need ? (
          <p className="ah-modal-task">
            Task: <strong>{need.need}</strong>
            <span className="secondary"> · {plan.area}</span>
          </p>
        ) : (
          <label className="ah-field">
            <span className="field-label">Task (a need from an action plan)</span>
            <select className="select" value={needKey} onChange={(event) => pickNeed(event.target.value)} required>
              <option value="">Choose a need…</option>
              {needOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.plan.area} — {option.need.need}
                </option>
              ))}
            </select>
            {needOptions.length === 0 && <span className="text-xs secondary">No action plans yet: create one from the Risk tab first.</span>}
          </label>
        )}

        <div className="ah-modal-grid">
          <label className="ah-field">
            <span className="field-label">From location</span>
            <input className="input" value={form.from} maxLength={120} onChange={(event) => setForm({ ...form, from: event.target.value })} />
          </label>
          <label className="ah-field">
            <span className="field-label">To location</span>
            <input className="input" value={form.to} maxLength={120} onChange={(event) => setForm({ ...form, to: event.target.value })} />
          </label>
          <label className="ah-field">
            <span className="field-label">Quantity / details</span>
            <input className="input" value={form.details} maxLength={300} onChange={(event) => setForm({ ...form, details: event.target.value })} />
          </label>
          <label className="ah-field">
            <span className="field-label">Deadline</span>
            <input className="input" type="datetime-local" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
          </label>
        </div>

        <fieldset className="ah-assign">
          <legend className="field-label">Assign to</legend>
          <div className="ah-assign-row">
            <button type="button" className="btn btn-sm" aria-pressed={showMatch} onClick={() => setShowMatch((value) => !value)} disabled={!need}>
              <Sparkles size={14} aria-hidden="true" /> Smart Match
            </button>
            <span className="secondary text-sm">or</span>
            <input
              className="input ah-search"
              type="search"
              placeholder="Search by name, role or city"
              aria-label="Search responders"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select className="select" aria-label="Responder" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              <option value="">Choose a person…</option>
              {filtered.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} — {person.role} — {person.city}
                </option>
              ))}
            </select>
          </div>
          {showMatch && need && <SmartMatchPanel need={need} matches={matches} onPick={(person) => setAssigneeId(person.id)} pickLabel="Pick" />}
          {selected && (
            <div className="ah-selected">
              <Avatar person={selected} size={36} />
              <div>
                <p>
                  Selected: <strong>{selected.name}</strong> ({selected.role})
                </p>
                <p className="text-sm secondary">
                  <MapPin size={12} aria-hidden="true" /> {selected.city} · <span className={`ah-dot ah-avail-${selected.availability}`} aria-hidden="true" />{' '}
                  {availabilityLabel(selected.availability)} · {activeTasksFor(tasks, selected.id).length} active tasks
                </p>
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="ah-notify">
          <legend className="field-label">Notify via</legend>
          <label className="ah-check">
            <input type="checkbox" checked disabled /> In-app (always on): the task appears live on every open Action Hub
          </label>
          <label className="ah-check">
            <input type="checkbox" checked disabled /> Show the task on their Operations view when they open it
          </label>
          {selected?.phone && (
            <p className="text-xs secondary">
              Contact on file: {selected.phone}. SMS or WhatsApp alerts are not connected yet; phone them if the task is urgent.
            </p>
          )}
        </fieldset>

        {error && (
          <p className="ah-error" role="alert">
            {error}
          </p>
        )}

        <div className="ah-modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!need || !selected || saving}>
            {saving ? 'Assigning…' : 'Create & Assign'}
          </button>
        </div>
      </form>
    </div>
  )
}
