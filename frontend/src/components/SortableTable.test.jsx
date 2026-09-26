import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

describe('SortableTable search', () => {
  it('filters rows by text after a short debounce, with a count and an empty state', async () => {
    const user = userEvent.setup()
    render(<SortableTable columns={COLUMNS} rows={ROWS} caption="Districts" noun="districts" initialSort={{ key: 'id', dir: 'asc' }} />)
    const box = screen.getByRole('searchbox', { name: 'Search Districts' })
    await user.type(box, 'district 1')
    // District 1, 10–19: eleven matches.
    await waitFor(() => expect(bodyRows()).toHaveLength(11))
    expect(screen.getByText('11 of 40 districts')).toHaveAttribute('aria-live', 'polite')

    await user.clear(box)
    await user.type(box, 'zzz')
    await waitFor(() => expect(screen.getByText('No results for “zzz”.')).toBeInTheDocument())
    expect(screen.getByText('0 of 40 districts')).toBeInTheDocument()
  })

  it('keeps sorting and the preview working on the filtered rows', async () => {
    const user = userEvent.setup()
    render(<SortableTable columns={COLUMNS} rows={ROWS} preview={5} noun="districts" initialSort={{ key: 'id', dir: 'asc' }} />)
    await user.type(screen.getByRole('searchbox'), 'district 3')
    // District 3, 30–39: eleven matches, five shown.
    await waitFor(() => expect(screen.getByText('Showing 5 of 11 districts')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /People/ }))
    expect(bodyRows()[0]).toHaveTextContent('District 39')
  })

  it('matches only the columns in searchKeys, and can be turned off', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<SortableTable columns={COLUMNS} rows={ROWS} searchKeys={['id']} />)
    await user.type(screen.getByRole('searchbox'), 'District')
    await waitFor(() => expect(screen.getByText(/No results/)).toBeInTheDocument())
    unmount()
    render(<SortableTable columns={COLUMNS} rows={ROWS} searchable={false} />)
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
