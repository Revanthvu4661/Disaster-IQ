import { describe, expect, it } from 'vitest'
import {
  formatDeadline,
  matchScore,
  needProgress,
  nextStatuses,
  overallReadiness,
  planIdFor,
  planReadiness,
  smartMatches,
  statusGroup,
  taskStats,
  taskSteps,
  validPhone,
} from './actionHub'

const KAKINADA = { area: 'Kakinada', state: 'Andhra Pradesh' }
const MEDICINE = { id: 'n1', need: 'Move medical supplies', category: 'transport' }
const people = [
  { id: 'suresh', name: 'Suresh Rao', role: 'Transporter', city: 'Kakinada', state: 'Andhra Pradesh', availability: 'now' },
  { id: 'ravi', name: 'Ravi Kumar', role: 'Volunteer', city: 'Kakinada', state: 'Andhra Pradesh', availability: 'now' },
  { id: 'ngo', name: 'NGO HelpIndia', role: 'NGO', city: 'Visakhapatnam', state: 'Andhra Pradesh', availability: '2hrs' },
  { id: 'off', name: 'Asha Menon', role: 'Transporter', city: 'Kakinada', state: 'Andhra Pradesh', availability: 'unavailable' },
  { id: 'far', name: 'Dev Singh', role: 'Medical', city: 'Delhi', state: 'Delhi', availability: 'now' },
]

describe('Smart Match', () => {
  it('scores availability, location, role and workload as specified', () => {
    expect(matchScore(people[0], MEDICINE, KAKINADA, 0)).toEqual({
      score: 8,
      parts: { availability: 3, location: 3, role: 2, workload: -0 },
    })
    expect(matchScore(people[2], MEDICINE, KAKINADA, 0).parts).toMatchObject({ availability: 1, location: 1, role: 0 })
    expect(matchScore(people[3], MEDICINE, KAKINADA, 0).parts.availability).toBe(-10)
    expect(matchScore(people[1], MEDICINE, KAKINADA, 2).parts.workload).toBe(-2)
  })

  it('matches the city case-insensitively and ignores blank cities', () => {
    expect(matchScore({ ...people[0], city: '  kakinada ' }, MEDICINE, KAKINADA, 0).parts.location).toBe(3)
    expect(matchScore({ ...people[0], city: '' }, MEDICINE, { area: '', state: 'Andhra Pradesh' }, 0).parts.location).toBe(1)
  })

  it('ranks the top three, counting only unfinished tasks', () => {
    const tasks = [
      { id: '1001', assigneeId: 'ravi', status: 'in_transit' },
      { id: '1000', assigneeId: 'suresh', status: 'delivered' },
    ]
    const top = smartMatches(people, tasks, MEDICINE, KAKINADA)
    // Available now in another state (3) beats available in 2 hrs in the same state (1 + 1).
    expect(top.map((m) => m.responder.name)).toEqual(['Suresh Rao', 'Ravi Kumar', 'Dev Singh'])
    expect(top.map((m) => m.active)).toEqual([0, 1, 0])
    expect(top.map((m) => m.score)).toEqual([8, 5, 3])
    expect(smartMatches(people, tasks, MEDICINE, KAKINADA, 5).at(-1).responder.name).toBe('Asha Menon')
  })
})

describe('tasks and readiness', () => {
  const plan = { id: 'cyclone:Andhra Pradesh:Kakinada', needs: [{ id: 'n1' }, { id: 'n2' }] }

  it('moves statuses forward only and groups them', () => {
    expect(nextStatuses('assigned').map((s) => s.id)).toEqual(['accepted', 'collected', 'in_transit', 'delivered'])
    expect(nextStatuses('delivered')).toEqual([])
    expect(['assigned', 'collected', 'delivered'].map(statusGroup)).toEqual(['pending', 'in_progress', 'completed'])
  })

  it('takes a need to 100% when its task is delivered, and averages the area', () => {
    const tasks = [
      { planId: plan.id, needId: 'n1', status: 'collected' },
      { planId: plan.id, needId: 'n1', status: 'delivered' },
      { planId: 'other', needId: 'n2', status: 'delivered' },
    ]
    expect(needProgress(tasks, plan.id, 'n1')).toBe(100)
    expect(needProgress(tasks, plan.id, 'n2')).toBe(0)
    expect(planReadiness(plan, tasks)).toBe(50)
    expect(overallReadiness([plan, { id: 'other', needs: [{ id: 'n2' }] }], tasks)).toBe(75)
    expect(overallReadiness([], tasks)).toBe(0)
  })

  it('counts completed, in progress and pending', () => {
    const tasks = [{ status: 'assigned' }, { status: 'accepted' }, { status: 'in_transit' }, { status: 'delivered' }]
    expect(taskStats(tasks)).toEqual({ total: 4, completed: 1, inProgress: 2, pending: 1 })
  })

  it('writes instructions from the task, with a fallback for missing places', () => {
    expect(taskSteps({ category: 'transport', from: 'Pharmacy Row, Kakinada', to: 'Safe Zone B', details: '500 medicine units' })).toEqual([
      'Collect 500 medicine units from Pharmacy Row, Kakinada',
      'Load into the transport vehicle',
      'Deliver to Safe Zone B',
      'Get a signature or confirmation on delivery',
    ])
    expect(taskSteps({ category: 'rescue' })[0]).toBe('Report to the pick-up point with your team and equipment')
  })

  it('formats deadlines relative to now', () => {
    const now = new Date(2026, 8, 26, 10, 0)
    expect(formatDeadline(new Date(2026, 8, 26, 16, 0).toISOString(), now)).toMatch(/today$/)
    expect(formatDeadline(new Date(2026, 8, 27, 9, 30).toISOString(), now)).toMatch(/tomorrow$/)
    expect(formatDeadline(new Date(2026, 8, 25, 9, 0).toISOString(), now)).toMatch(/\(overdue\)$/)
    expect(formatDeadline('', now)).toBe('No deadline')
  })

  it('makes a Firestore-safe plan id and checks phone numbers', () => {
    expect(planIdFor('flood:Odisha:A/B')).toBe('flood:Odisha:A_B')
    expect(validPhone('')).toBe(true)
    expect(validPhone('+91 98765 43210')).toBe(true)
    expect(validPhone('12ab')).toBe(false)
    expect(validPhone('123')).toBe(false)
  })
})
