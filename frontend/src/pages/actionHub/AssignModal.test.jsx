import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssignModal from './AssignModal'

vi.mock('../../lib/actionHubStore', () => ({ createTask: vi.fn(async () => 1001) }))
const { createTask } = await import('../../lib/actionHubStore')

const plan = {
  id: 'cyclone:Andhra Pradesh:Kakinada',
  area: 'Kakinada',
  state: 'Andhra Pradesh',
  hazard: 'cyclone',
  needs: [{ id: 'n1', need: 'Move medical supplies', category: 'transport', priority: 'Critical', quantity: '500 units', from_hint: 'Pharmacy Row', to_hint: 'Safe Zone B' }],
}
const responders = [
  { id: 'suresh', name: 'Suresh Rao', role: 'Transporter', city: 'Kakinada', state: 'Andhra Pradesh', availability: 'now', phone: '+91 98765 43210' },
  { id: 'ravi', name: 'Ravi Kumar', role: 'Volunteer', city: 'Kakinada', state: 'Andhra Pradesh', availability: 'now' },
]

describe('AssignModal', () => {
  it('prefills the need, suggests the best match and creates the task', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    render(<AssignModal context={{ plan, need: plan.needs[0] }} plans={[plan]} responders={responders} tasks={[]} onClose={vi.fn()} onCreated={onCreated} />)

    const dialog = screen.getByRole('dialog', { name: 'Assign Task' })
    expect(within(dialog).getByText('Move medical supplies')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('From location')).toHaveValue('Pharmacy Row')
    expect(within(dialog).getByLabelText('To location')).toHaveValue('Safe Zone B')

    const create = within(dialog).getByRole('button', { name: 'Create & Assign' })
    expect(create).toBeDisabled()

    // Smart Match opens by default for a need; Suresh (Transporter) ranks first.
    const matches = within(dialog).getByRole('region', { name: /Best matches for Move medical supplies/ })
    expect(within(matches).getAllByRole('listitem')[0]).toHaveTextContent('Suresh Rao')
    await user.click(within(matches).getByRole('button', { name: 'Pick Suresh Rao' }))
    expect(within(dialog).getByText(/Contact on file: \+91 98765 43210/)).toBeInTheDocument()

    await user.click(create)
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: plan.id,
        needId: 'n1',
        need: 'Move medical supplies',
        priority: 'Critical',
        from: 'Pharmacy Row',
        to: 'Safe Zone B',
        details: '500 units',
        assigneeId: 'suresh',
        assigneeName: 'Suresh Rao',
        assigneeRole: 'Transporter',
      }),
    )
    expect(onCreated).toHaveBeenCalledWith(1001, responders[0])
  })

  it('asks for a need when opened from a person, and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AssignModal context={{ responder: responders[1] }} plans={[plan]} responders={responders} tasks={[]} onClose={onClose} onCreated={vi.fn()} />)
    const needSelect = screen.getByLabelText('Task (a need from an action plan)')
    await user.selectOptions(needSelect, `${plan.id}|n1`)
    expect(screen.getByLabelText('From location')).toHaveValue('Pharmacy Row')
    expect(screen.getByText(/Selected:/)).toHaveTextContent('Ravi Kumar')
    expect(screen.getByRole('button', { name: 'Create & Assign' })).toBeEnabled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
