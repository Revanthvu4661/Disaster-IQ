/**
 * Action Hub logic with no Firebase or DOM in it: task statuses and progress,
 * readiness per area, the Smart Match ranking, role colours and the
 * step-by-step instructions a responder sees.
 */

/** A task moves forward through these; progress feeds the readiness score. */
export const STATUSES = [
  { id: 'assigned', label: 'Assigned', progress: 10 },
  { id: 'accepted', label: 'Accepted', progress: 25 },
  { id: 'collected', label: 'Collected', progress: 50 },
  { id: 'in_transit', label: 'In Transit', progress: 75 },
  { id: 'delivered', label: 'Delivered', progress: 100 },
]
const STATUS_INDEX = Object.fromEntries(STATUSES.map((s, i) => [s.id, i]))
export const statusLabel = (id) => STATUSES[STATUS_INDEX[id]]?.label ?? id
export const statusProgress = (id) => STATUSES[STATUS_INDEX[id]]?.progress ?? 0
/** Statuses a responder may move to from `current`: only forward. */
export const nextStatuses = (current) => STATUSES.slice((STATUS_INDEX[current] ?? 0) + 1)

/** Pending (just assigned), in progress, or completed (delivered). */
export function statusGroup(status) {
  if (status === 'delivered') return 'completed'
  if (status === 'assigned') return 'pending'
  return 'in_progress'
}

export const ROLES = ['Volunteer', 'Transporter', 'Medical', 'Rescue', 'NGO', 'Coordinator']
/** Role badge colour: one per role, assigned automatically. */
export const ROLE_TONE = {
  Volunteer: 'teal',
  Transporter: 'blue',
  Medical: 'red',
  Rescue: 'orange',
  NGO: 'violet',
  Coordinator: 'slate',
}

export const AVAILABILITY = [
  { id: 'now', label: 'Available now' },
  { id: '2hrs', label: 'Available in 2 hrs' },
  { id: 'unavailable', label: 'Unavailable' },
]
export const availabilityLabel = (id) => AVAILABILITY.find((a) => a.id === id)?.label ?? id

export const CATEGORIES = ['transport', 'medical', 'rescue', 'shelter', 'food', 'water', 'communication', 'power']
/** Which roles fit which kind of need (Smart Match, score 3). */
export const CATEGORY_ROLES = {
  transport: ['Transporter'],
  medical: ['Medical'],
  rescue: ['Rescue'],
  shelter: ['NGO', 'Volunteer'],
  food: ['NGO', 'Volunteer'],
  water: ['NGO', 'Volunteer'],
  communication: ['Coordinator', 'Volunteer'],
  power: ['Transporter', 'Volunteer'],
}

export const PRIORITIES = ['Critical', 'High', 'Medium']

const norm = (text) => (text ?? '').toString().trim().toLowerCase()

export const activeTasksFor = (tasks, responderId) =>
  tasks.filter((task) => task.assigneeId === responderId && task.status !== 'delivered')

/**
 * Smart Match score for one responder and one need:
 *   availability  now +3, in 2 hrs +1, unavailable −10
 *   location      same city or district as the area +3, same state +1
 *   role          fits the need's category +2
 *   workload      −1 per active task
 */
export function matchScore(responder, need, area, activeCount) {
  const parts = {
    availability: { now: 3, '2hrs': 1, unavailable: -10 }[responder.availability] ?? 0,
    location: norm(responder.city) && norm(responder.city) === norm(area?.area) ? 3 : norm(responder.state) && norm(responder.state) === norm(area?.state) ? 1 : 0,
    role: (CATEGORY_ROLES[need?.category] ?? []).includes(responder.role) ? 2 : 0,
    workload: -activeCount,
  }
  return { score: parts.availability + parts.location + parts.role + parts.workload, parts }
}

/** The top `limit` responders for a need, best first (ties: fewer active tasks, then name). */
export function smartMatches(responders, tasks, need, area, limit = 3) {
  return responders
    .map((responder) => {
      const active = activeTasksFor(tasks, responder.id).length
      return { responder, active, ...matchScore(responder, need, area, active) }
    })
    .sort((a, b) => b.score - a.score || a.active - b.active || a.responder.name.localeCompare(b.responder.name))
    .slice(0, limit)
}

/* ── readiness ─────────────────────────────────────────────────────────── */

/** A need's preparedness: the furthest any of its tasks has got (0 with no task). */
export function needProgress(tasks, planId, needId) {
  return tasks
    .filter((task) => task.planId === planId && task.needId === needId)
    .reduce((best, task) => Math.max(best, statusProgress(task.status)), 0)
}

/** An area's readiness: the mean preparedness of its needs, 0–100. */
export function planReadiness(plan, tasks) {
  if (!plan?.needs?.length) return 0
  const total = plan.needs.reduce((sum, need) => sum + needProgress(tasks, plan.id, need.id), 0)
  return Math.round(total / plan.needs.length)
}

/** Readiness across every area with a plan. */
export function overallReadiness(plans, tasks) {
  if (!plans.length) return 0
  return Math.round(plans.reduce((sum, plan) => sum + planReadiness(plan, tasks), 0) / plans.length)
}

export function taskStats(tasks) {
  const count = (group) => tasks.filter((task) => statusGroup(task.status) === group).length
  return { total: tasks.length, completed: count('completed'), inProgress: count('in_progress'), pending: count('pending') }
}

/** Colour band for a 0–100 readiness bar. */
export function readinessLevel(percent) {
  if (percent >= 80) return 'low'
  if (percent >= 50) return 'medium'
  if (percent >= 20) return 'high'
  return 'critical'
}

/* ── what the responder does ───────────────────────────────────────────── */

const place = (text, fallback) => (text?.trim() ? text.trim() : fallback)

/** Step-by-step instructions for a task, from its category and locations. */
export function taskSteps(task) {
  const from = place(task.from, 'the pick-up point')
  const to = place(task.to, 'the destination')
  const what = place(task.details, 'the items')
  switch (task.category) {
    case 'rescue':
      return [`Report to ${from} with your team and equipment`, `Move to ${to}`, 'Search and rescue as directed by the coordinator', 'Report how many people were helped']
    case 'shelter':
      return [`Collect shelter materials from ${from}`, `Set up the shelter at ${to}`, 'Register everyone who arrives', 'Confirm capacity and needs to the coordinator']
    case 'communication':
      return [`Collect the equipment from ${from}`, `Install and test it at ${to}`, 'Confirm contact with the control room', 'Report the working channels']
    default:
      return [`Collect ${what} from ${from}`, 'Load into the transport vehicle', `Deliver to ${to}`, 'Get a signature or confirmation on delivery']
  }
}

/** "4:00 PM today", "10:30 AM tomorrow", "28 Sep, 9:00 AM"; overdue deadlines say so. */
export function formatDeadline(iso, now = new Date()) {
  if (!iso) return 'No deadline'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'No deadline'
  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(date) - day(now)) / 86_400_000)
  const text = diff === 0 ? `${time} today` : diff === 1 ? `${time} tomorrow` : `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`
  return date < now ? `${text} (overdue)` : text
}

export const taskLabel = (task) => `#${task.number ?? task.id}`

/** Firestore document id for an area's plan ("/" is not allowed in ids). */
export const planIdFor = (riskId) => riskId.replace(/\//g, '_')

/** The 36 states and union territories, for the registration form. */
export const INDIA_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]

/** Loose phone check: 7–15 digits, optional +, spaces and dashes. Empty is allowed. */
export const validPhone = (text) => !text.trim() || /^\+?[\d\s-]{7,20}$/.test(text.trim()) && text.replace(/\D/g, '').length >= 7 && text.replace(/\D/g, '').length <= 15
