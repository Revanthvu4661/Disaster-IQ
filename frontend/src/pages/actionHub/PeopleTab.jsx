import { Fragment, useState } from 'react'
import { ChevronDown, ChevronUp, UserPlus, X } from 'lucide-react'
import { InfoCard } from '../../components/history/Block'
import { TableSearch, noResultsText, useTableSearch } from '../../components/TableSearch'
import { useToast } from '../../context/ToastContext'
import {
  AVAILABILITY,
  INDIA_STATES,
  ROLES,
  activeTasksFor,
  formatDeadline,
  smartMatches,
  taskLabel,
  validPhone,
} from '../../lib/actionHub'
import { createResponder, imageToDataUrl } from '../../lib/actionHubStore'
import { Availability, Avatar, RoleBadge, SmartMatchPanel, StatusBadge } from './parts'

const EMPTY = { name: '', role: 'Volunteer', city: '', state: '', availability: 'now', capacity: '10', skills: '', phone: '', photo: '' }

function RegisterForm({ onDone }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  const pickPhoto = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setForm({ ...form, photo: await imageToDataUrl(file, 256, 0.8) })
    } catch (err) {
      setError(err.message)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!validPhone(form.phone)) {
      setError('Enter a phone number with 7 to 15 digits, or leave it empty.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createResponder({
        name: form.name.trim().slice(0, 80),
        role: form.role,
        city: form.city.trim().slice(0, 80),
        state: form.state,
        availability: form.availability,
        capacity: Math.max(0, Math.min(100000, Math.round(Number(form.capacity) || 0))),
        skills: form.skills.trim().slice(0, 200),
        phone: form.phone.trim().slice(0, 20),
        photo: form.photo,
      })
      toast.success(`${form.name.trim()} registered`)
      setForm(EMPTY)
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="ah-register" onSubmit={submit}>
      <label className="ah-field">
        <span className="field-label">Name *</span>
        <input className="input" required maxLength={80} value={form.name} onChange={set('name')} />
      </label>
      <label className="ah-field">
        <span className="field-label">Role *</span>
        <select className="select" value={form.role} onChange={set('role')}>
          {ROLES.map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
      </label>
      <label className="ah-field">
        <span className="field-label">City or district *</span>
        <input className="input" required maxLength={80} value={form.city} onChange={set('city')} placeholder="e.g. Kakinada" />
      </label>
      <label className="ah-field">
        <span className="field-label">State *</span>
        <select className="select" required value={form.state} onChange={set('state')}>
          <option value="">Choose…</option>
          {INDIA_STATES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label className="ah-field">
        <span className="field-label">Availability</span>
        <select className="select" value={form.availability} onChange={set('availability')}>
          {AVAILABILITY.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="ah-field">
        <span className="field-label">Capacity (people or units they can handle)</span>
        <input className="input" type="number" min={0} max={100000} value={form.capacity} onChange={set('capacity')} />
      </label>
      <label className="ah-field">
        <span className="field-label">Skills</span>
        <input className="input" maxLength={200} value={form.skills} onChange={set('skills')} placeholder="e.g. first aid, driving, boat handling" />
      </label>
      <label className="ah-field">
        <span className="field-label">Contact for task alerts (WhatsApp or phone)</span>
        <input className="input" type="tel" maxLength={20} value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" />
      </label>
      <div className="ah-field">
        <span className="field-label">Profile photo (optional)</span>
        <div className="ah-photo-pick">
          {form.photo && <img src={form.photo} alt="Chosen profile" className="ah-avatar" width={40} height={40} />}
          <input type="file" accept="image/*" aria-label="Profile photo" onChange={pickPhoto} />
          {form.photo && (
            <button type="button" className="icon-btn" aria-label="Remove photo" onClick={() => setForm({ ...form, photo: '' })}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="ah-error" role="alert">
          {error}
        </p>
      )}
      <div className="ah-register-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <UserPlus size={16} aria-hidden="true" /> {saving ? 'Registering…' : 'Register responder'}
        </button>
        <p className="text-xs secondary">
          Stored in the project&rsquo;s Firebase database and visible to everyone who opens the Action Hub. Photos are shrunk to 256 px.
        </p>
      </div>
    </form>
  )
}

function Profile({ person, tasks }) {
  const history = tasks.filter((task) => task.assigneeId === person.id)
  return (
    <div className="ah-profile">
      <Avatar person={person} size={64} />
      <dl className="ah-profile-facts">
        <div><dt>Role</dt><dd><RoleBadge role={person.role} /></dd></div>
        <div><dt>Location</dt><dd>{person.city}, {person.state}</dd></div>
        <div><dt>Availability</dt><dd><Availability value={person.availability} /></dd></div>
        <div><dt>Capacity</dt><dd>{person.capacity}</dd></div>
        <div><dt>Skills</dt><dd>{person.skills || '—'}</dd></div>
        <div><dt>Contact for task alerts</dt><dd>{person.phone || '—'}</dd></div>
        <div><dt>Registered</dt><dd>{new Date(person.createdAt).toLocaleDateString('en-IN')}</dd></div>
      </dl>
      <div className="ah-profile-history">
        <h4 className="field-label">Task history</h4>
        {history.length === 0 ? (
          <p className="text-sm secondary">No tasks yet.</p>
        ) : (
          <ul>
            {history.map((task) => (
              <li key={task.id}>
                <span className="mono">{taskLabel(task)}</span> {task.need} · {task.area} <StatusBadge status={task.status} />
                <span className="text-xs secondary"> · due {formatDeadline(task.deadline)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Register responders, see who is free, and assign from the directory or the Smart Match panel. */
export default function PeopleTab({ responders, tasks, needContext, onDismissNeed, onAssign }) {
  const [showForm, setShowForm] = useState(responders.length === 0)
  const [open, setOpen] = useState(null)
  const search = useTableSearch(responders, (person) => `${person.name} ${person.role} ${person.city} ${person.state} ${person.skills ?? ''}`)
  const shown = search.filtered
  const matches = needContext ? smartMatches(responders, tasks, needContext.need, { area: needContext.plan.area, state: needContext.plan.state }) : []

  return (
    <div className="stack">
      {needContext && (
        <div className="card ah-match-card">
          <button type="button" className="icon-btn ah-match-close" aria-label="Hide the matches" onClick={onDismissNeed}>
            <X size={16} aria-hidden="true" />
          </button>
          <SmartMatchPanel need={needContext.need} matches={matches} onPick={(person) => onAssign({ ...needContext, responder: person })} />
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <div className="card-heading">
            <h3 className="card-title">Register a responder</h3>
            <p className="card-insight">Volunteers, transporters, medical teams, rescue teams, NGOs and coordinators.</p>
          </div>
          <button type="button" className="btn btn-sm" aria-expanded={showForm} onClick={() => setShowForm((value) => !value)}>
            {showForm ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {showForm ? 'Hide form' : 'Show form'}
          </button>
        </div>
        {showForm && <RegisterForm />}
      </section>

      <InfoCard title={`Responder directory (${responders.length})`} insight="Current assignment comes live from the tasks.">
        {responders.length > 0 && <TableSearch search={search} total={responders.length} label="Search responders by name, role or place" noun="responders" />}
        {responders.length === 0 ? (
          <p className="text-sm secondary">Nobody registered yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data ah-directory">
              <caption className="visually-hidden">Responder directory</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Location</th>
                  <th scope="col">Availability</th>
                  <th scope="col">Current assignment</th>
                  <th scope="col">Capacity</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {search.active && shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      {noResultsText(search.needle)}
                    </td>
                  </tr>
                )}
                {shown.map((person) => {
                  const active = activeTasksFor(tasks, person.id)
                  const expanded = open === person.id
                  return (
                    <Fragment key={person.id}>
                      <tr>
                        <th scope="row">
                          <span className="ah-person">
                            <Avatar person={person} size={28} /> {person.name}
                          </span>
                        </th>
                        <td><RoleBadge role={person.role} /></td>
                        <td>{person.city}, {person.state}</td>
                        <td><Availability value={person.availability} /></td>
                        <td>
                          {active.length === 0 ? (
                            <span className="ah-free">Free</span>
                          ) : (
                            <span className="ah-busy">
                              On Task {taskLabel(active[active.length - 1])}
                              {active.length > 1 && ` +${active.length - 1}`}
                            </span>
                          )}
                        </td>
                        <td className="mono">{person.capacity}</td>
                        <td>
                          <div className="ah-row-actions">
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => onAssign({ responder: person })}>
                              Assign Task
                            </button>
                            <button type="button" className="btn btn-sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : person.id)}>
                              {expanded ? 'Hide profile' : 'View Profile'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="ah-profile-row">
                          <td colSpan={7}>
                            <Profile person={person} tasks={tasks} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </InfoCard>
    </div>
  )
}
