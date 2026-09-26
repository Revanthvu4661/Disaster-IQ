import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import {
  ROLE_TONE,
  availabilityLabel,
  readinessLevel,
  statusGroup,
  statusLabel,
} from '../../lib/actionHub'

export function PriorityBadge({ priority }) {
  return <span className={`ah-badge ah-priority-${(priority ?? 'medium').toLowerCase()}`}>{priority}</span>
}

const GROUP_LABEL = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' }

export function StatusBadge({ status }) {
  const group = statusGroup(status)
  return (
    <span className={`ah-badge ah-status-${group}`} title={GROUP_LABEL[group]}>
      {group === 'completed' && <CheckCircle2 size={12} aria-hidden="true" />}
      {statusLabel(status)}
    </span>
  )
}

export function RoleBadge({ role }) {
  return <span className={`ah-role ah-role-${ROLE_TONE[role] ?? 'slate'}`}>{role}</span>
}

export function Availability({ value }) {
  return <span className={`ah-avail ah-avail-${value}`}>{availabilityLabel(value)}</span>
}

export function Avatar({ person, size = 32 }) {
  const initials = (person?.name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
  return person?.photo ? (
    <img className="ah-avatar" src={person.photo} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className={`ah-avatar ah-role-${ROLE_TONE[person?.role] ?? 'slate'}`} style={{ width: size, height: size }} aria-hidden="true">
      {initials}
    </span>
  )
}

export function ReadinessBar({ value, label }) {
  return (
    <span className={`ah-ready risk-${readinessLevel(value)}`} style={{ '--level': `var(--severity-${readinessLevel(value)})` }}>
      <span className="ah-ready-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
        <span style={{ width: `${value}%` }} />
      </span>
      <span className="ah-ready-value">{value}%</span>
    </span>
  )
}

const WHY = { availability: 'availability', location: 'location', role: 'role fits', workload: 'workload' }

/** The top three people for a need, with why each scored as it did. */
export function SmartMatchPanel({ need, matches, onPick, pickLabel = 'Assign to' }) {
  return (
    <section className="ah-match" aria-label={`Best matches for ${need.need}`}>
      <h4 className="ah-match-title">
        <Sparkles size={15} aria-hidden="true" /> Best matches for: &ldquo;{need.need}&rdquo;
      </h4>
      {matches.length === 0 ? (
        <p className="text-sm secondary">No responders registered yet. Add people in the People tab.</p>
      ) : (
        <>
          <ol className="ah-match-list">
            {matches.map(({ responder, active, score, parts }) => (
              <li key={responder.id}>
                {responder.availability === 'unavailable' || score < 0 ? (
                  <AlertTriangle size={16} className="ah-match-warn" aria-label="Weak match" />
                ) : (
                  <CheckCircle2 size={16} className="ah-match-ok" aria-label="Good match" />
                )}
                <span className="ah-match-who">
                  <strong>{responder.name}</strong> — {responder.role} — {responder.city} — {availabilityLabel(responder.availability)} —{' '}
                  {active} active {active === 1 ? 'task' : 'tasks'}
                </span>
                <span className="ah-match-score" title={Object.entries(parts).map(([key, value]) => `${WHY[key]} ${value >= 0 ? '+' : ''}${value}`).join(', ')}>
                  {score} pts
                </span>
              </li>
            ))}
          </ol>
          <div className="ah-match-actions">
            {matches.map(({ responder }) => (
              <button key={responder.id} type="button" className="btn btn-sm" onClick={() => onPick(responder)}>
                {pickLabel} {responder.name}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
