import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LiveEventsPanel } from './LiveEventsPanel'
import { SourceStrip, sourceStatusText } from './SourceStrip'
import { MAP_TYPE_IDS, SEVERITY_FILTERS } from '../../lib/liveEvents'

const recent = new Date(Date.now() - 2 * 3600_000).toISOString()

const EVENTS = [
  {
    id: 'earthquake:usgs:a+gdacs:b',
    type: 'earthquake',
    title: 'M 6.4 - 49 km NNE of Kainantu, Papua New Guinea',
    place: '49 km NNE of Kainantu, Papua New Guinea',
    latitude: -5.9,
    longitude: 146,
    magnitude: 6.4,
    time: recent,
    gdacs_alert: 'orange',
    severity_level: 'high',
    severity_basis: 'GDACS Orange alert',
    sources: [{ source: 'usgs' }, { source: 'gdacs' }],
  },
  {
    id: 'cyclone:eonet:1',
    type: 'cyclone',
    title: 'Hurricane Polo',
    latitude: 15,
    longitude: -101,
    time: recent,
    severity_level: null,
    sources: [{ source: 'eonet' }],
  },
]

function renderPanel(props = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onSortChange: vi.fn(),
    onToggleType: vi.fn(),
    onToggleSeverity: vi.fn(),
  }
  render(
    <LiveEventsPanel
      events={EVENTS}
      sort="recent"
      types={new Set(MAP_TYPE_IDS)}
      severities={new Set(SEVERITY_FILTERS)}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('LiveEventsPanel', () => {
  it('shows the live count and one card per event with type text, place and facts', () => {
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Live Events' })).toBeInTheDocument()
    expect(screen.getByText('2 events in view')).toBeInTheDocument()
    const quake = screen.getByRole('button', { name: /Kainantu/ })
    expect(within(quake).getByText('Earthquake')).toBeInTheDocument()
    expect(within(quake).getByText(/2 h ago • M6\.4 • Alert: Orange • 2 sources/)).toBeInTheDocument()
    expect(within(quake).getByText('High')).toHaveAttribute('title', expect.stringContaining('GDACS Orange alert'))
  })

  it('leaves out fields a source did not give and marks unrated events', () => {
    renderPanel()
    const storm = screen.getByRole('button', { name: /Hurricane Polo/ })
    expect(within(storm).queryByText(/Wind/)).toBeNull()
    expect(within(storm).queryByText(/M\d/)).toBeNull()
    expect(within(storm).getByText('Not rated')).toBeInTheDocument()
  })

  it('selects on click and highlights on hover and focus', async () => {
    const user = userEvent.setup()
    const { onSelect, onHover } = renderPanel()
    const quake = screen.getByRole('button', { name: /Kainantu/ })
    await user.hover(quake)
    expect(onHover).toHaveBeenLastCalledWith(EVENTS[0].id)
    await user.unhover(quake)
    expect(onHover).toHaveBeenLastCalledWith(null)
    await user.click(quake)
    expect(onSelect).toHaveBeenCalledWith(EVENTS[0])
  })

  it('moves between cards with the arrow keys and activates with Enter', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPanel()
    const [first, second] = screen.getAllByRole('button', { name: /Kainantu|Polo/ })
    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(second).toHaveFocus()
    await user.keyboard('{Home}')
    expect(first).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(EVENTS[0])
  })

  it('opens type and severity filters that explain the severity rule', async () => {
    const user = userEvent.setup()
    const { onToggleType, onToggleSeverity } = renderPanel({ rule: 'THE RULE' })
    const button = screen.getByRole('button', { name: 'Filters' })
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('checkbox', { name: /Floods/ }))
    expect(onToggleType).toHaveBeenCalledWith('flood')
    await user.click(screen.getByRole('checkbox', { name: 'Very High' }))
    expect(onToggleSeverity).toHaveBeenCalledWith('very_high')
    expect(screen.getByText('THE RULE')).toBeInTheDocument()
  })

  it('offers the three sorts', async () => {
    const user = userEvent.setup()
    const { onSortChange } = renderPanel()
    const select = screen.getByRole('combobox', { name: 'Sort by' })
    expect([...select.options].map((option) => option.text)).toEqual(['Most recent', 'Severity', 'Magnitude'])
    await user.selectOptions(select, 'magnitude')
    expect(onSortChange).toHaveBeenCalledWith('magnitude')
  })

  it('has an empty state for an empty view and for filters that hide everything', () => {
    const { unmount } = render(
      <LiveEventsPanel events={[]} sort="recent" types={new Set(MAP_TYPE_IDS)} severities={new Set(SEVERITY_FILTERS)} onSortChange={() => {}} />,
    )
    expect(screen.getByText('No events in this view. Zoom out to see more.')).toBeInTheDocument()
    expect(screen.getByText('0 events in view')).toBeInTheDocument()
    unmount()
    renderPanel({ events: [], filteredOut: true })
    expect(screen.getByText('No events match the selected filters.')).toBeInTheDocument()
  })
})

describe('LiveEventsPanel when the API fails', () => {
  it('says the events could not be loaded instead of showing zero events', () => {
    renderPanel({ events: [], failed: true })
    expect(screen.getByText('Live events unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/0 events in view/)).toBeNull()
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
  })
})

describe('SourceStrip', () => {
  const sources = [
    { id: 'usgs', name: 'USGS', status: 'ok', count: 96, current_rule: 'M4.5+' },
    { id: 'gdacs', name: 'GDACS', status: 'unavailable', count: 0 },
    { id: 'eonet', name: 'NASA EONET', status: 'stale', count: 9, fetched_at: new Date(Date.now() - 25 * 60_000).toISOString() },
  ]

  it('shows records, outages and cached copies in words', () => {
    render(<SourceStrip sources={sources} fetchedAt={new Date().toISOString()} onRefresh={() => {}} />)
    const list = screen.getByRole('list', { name: 'Live feed status' })
    expect(within(list).getByText('96 records')).toBeInTheDocument()
    expect(within(list).getByText('temporarily unavailable')).toBeInTheDocument()
    expect(within(list).getByText('9 records · cached, updated 25 min ago')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  it('words a single record and a disabled feed', () => {
    expect(sourceStatusText({ status: 'ok', count: 1 })).toBe('1 record')
    expect(sourceStatusText({ status: 'disabled', count: 0 })).toBe('disabled')
  })
})
