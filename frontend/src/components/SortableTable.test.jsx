import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SortableTable from './SortableTable'

const ROWS = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, name: `District ${index + 1}`, people: index + 1 }))
const COLUMNS = [
  { key: 'id', label: '#', numeric: true, defaultDir: 'asc' },
  { key: 'name', label: 'District' },
  { key: 'people', label: 'People', numeric: true },
]

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('SortableTable preview', () => {
  it('shows the first rows with a count and a Show all button', async () => {
    const user = userEvent.setup()
    render(<SortableTable columns={COLUMNS} rows={ROWS} preview={25} noun="districts" initialSort={{ key: 'id', dir: 'asc' }} />)
    expect(bodyRows()).toHaveLength(25)
    expect(screen.getByText('Showing 25 of 40 districts')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Show all 40 districts' })
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await user.click(button)
    expect(bodyRows()).toHaveLength(40)
    expect(screen.getByText('Showing 40 of 40 districts')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show first 25 only' }))
    expect(bodyRows()).toHaveLength(25)
  })

  it('sorts every row, not only the ones shown', async () => {
    const user = userEvent.setup()
    render(<SortableTable columns={COLUMNS} rows={ROWS} preview={25} noun="districts" initialSort={{ key: 'id', dir: 'asc' }} />)
    expect(bodyRows()[0]).toHaveTextContent('District 1')
    await user.click(screen.getByRole('button', { name: /People/ }))
    // Sorting by people (descending) must bring District 40, which was hidden, to the top.
    expect(bodyRows()[0]).toHaveTextContent('District 40')
    expect(bodyRows()).toHaveLength(25)
  })

  it('adds nothing to a table that is already short', () => {
    render(<SortableTable columns={COLUMNS} rows={ROWS.slice(0, 10)} preview={25} noun="districts" />)
    expect(bodyRows()).toHaveLength(10)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })
})
