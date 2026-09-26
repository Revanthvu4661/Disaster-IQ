import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../context/ThemeContext'
import { DEFAULT_MAP_SETTINGS, EventPopup, LiveEventMap, ZonePopup, fillZoom, tooltipText } from './LiveEventMap'
import { CYCLONE_ZONES } from '../../lib/cycloneZones'
import { MAP_TYPE_IDS } from '../../lib/liveEvents'

const time = new Date(Date.now() - 3 * 3600_000).toISOString()

const QUAKE = {
  id: 'earthquake:usgs:a+gdacs:b',
  type: 'earthquake',
  title: 'M 6.4 - 49 km NNE of Kainantu, Papua New Guinea',
  place: '49 km NNE of Kainantu, Papua New Guinea',
  latitude: -5.9,
  longitude: 146,
  magnitude: 6.4,
  time,
  gdacs_alert: 'orange',
  severity_level: 'high',
  severity_basis: 'GDACS Orange alert',
  disagreement: 'USGS M6.4 vs GDACS M6.1',
  sources: [
    { source: 'usgs', source_id: 'a', source_name: 'USGS', url: 'https://earthquake.usgs.gov/x' },
    { source: 'gdacs', source_id: 'b', source_name: 'GDACS', url: null },
  ],
}
const STORM = {
  id: 'cyclone:gdacs:TC10',
  type: 'cyclone',
  title: 'Tropical Cyclone POLO-26',
  location: 'Mexico',
  storm_name: 'POLO-26',
  latitude: 15.4,
  longitude: -101.8,
  time,
  wind_kmh: 287,
  gdacs_alert: 'orange',
  severity_level: 'high',
  track: { observed: [[14, -100], [15.4, -101.8]], forecast: [[15.4, -101.8], [17, -104]], source: 'GDACS' },
  sources: [{ source: 'gdacs', source_id: 'TC10', source_name: 'GDACS', url: 'https://www.gdacs.org/r' }],
}
const FLOOD = { id: 'flood:eonet:1', type: 'flood', title: 'Flood in Italy', latitude: 37.5, longitude: 15, time, sources: [] }

describe('fillZoom', () => {
  it('raises the minimum zoom just enough for one world copy to fill a wide map', () => {
    expect(fillZoom(1110)).toBe(2.25) // 256 * 2^2.25 = 1218 px >= 1110
    expect(256 * 2 ** fillZoom(1700)).toBeGreaterThanOrEqual(1700)
  })

  it('never goes below zoom 2', () => {
    expect(fillZoom(375)).toBe(2)
    expect(fillZoom(0)).toBe(2)
  })
})

describe('marker tooltips', () => {
  it('show place, magnitude and time for quakes', () => {
    expect(tooltipText(QUAKE)).toBe('49 km NNE of Kainantu, Papua New Guinea · M6.4 · 3 h ago')
  })

  it('show storm name, wind and alert for cyclones, only when given', () => {
    expect(tooltipText(STORM)).toBe('POLO-26 · 287 km/h · Orange alert')
    expect(tooltipText({ type: 'cyclone', title: 'Hurricane Polo' })).toBe('Hurricane Polo')
  })

  it('show name and time for floods', () => {
    expect(tooltipText(FLOOD)).toBe('Flood in Italy · 3 h ago')
  })
})

describe('EventPopup', () => {
  it('shows type, place, readings, severity, the disagreement and source links', () => {
    render(<EventPopup event={QUAKE} rule="RULE" />)
    expect(screen.getByText('Earthquake')).toBeInTheDocument()
    expect(screen.getByText('49 km NNE of Kainantu, Papua New Guinea')).toBeInTheDocument()
    expect(screen.getByText('M6.4')).toBeInTheDocument()
    expect(screen.getByText('Orange')).toBeInTheDocument()
    expect(screen.getByText('High')).toHaveAttribute('title', 'High: GDACS Orange alert. Rule: RULE')
    expect(screen.getByRole('note')).toHaveTextContent('USGS M6.4 vs GDACS M6.1')
    expect(screen.getByRole('link', { name: /USGS/ })).toHaveAttribute('href', 'https://earthquake.usgs.gov/x')
    expect(screen.getByText('GDACS').tagName).toBe('SPAN') // no URL, so no link
    expect(screen.getByText('3 h ago').closest('time')).toHaveAttribute('title')
  })

  it('names the track source and never shows missing readings', () => {
    render(<EventPopup event={STORM} />)
    expect(screen.getByText('287 km/h')).toBeInTheDocument()
    expect(screen.queryByText('Magnitude')).toBeNull()
    expect(screen.queryByText('Storm')).toBeNull() // already in the headline
    expect(screen.getByText(/observed track and forecast path \(fainter\) from GDACS/)).toBeInTheDocument()
  })

  it('shows an unrated flood as not rated, with no invented facts', () => {
    render(<EventPopup event={FLOOD} />)
    expect(screen.getByText('Not rated')).toBeInTheDocument()
    expect(screen.queryByRole('definition')).toBeNull()
  })
})

describe('LiveEventMap', () => {
  const renderMap = (props = {}) =>
    render(
      <ThemeProvider>
        <LiveEventMap
          events={[QUAKE, STORM, FLOOD]}
          settings={{ ...DEFAULT_MAP_SETTINGS, plates: false }}
          onSettingsChange={props.onSettingsChange ?? vi.fn()}
          types={new Set(MAP_TYPE_IDS)}
          onToggleType={props.onToggleType ?? vi.fn()}
          typeNotes={{ earthquake: '96', cyclone: '8', flood: 'GDACS down' }}
        />
      </ThemeProvider>,
    )

  it('renders the map region with zoom, locate, legend and layers controls', () => {
    Object.defineProperty(window.navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
    renderMap()
    expect(screen.getByRole('region', { name: 'Map of current disaster events' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show my location' })).toBeInTheDocument()
    const legend = screen.getByLabelText('Map legend')
    expect(within(legend).getByText('Earthquake')).toBeInTheDocument()
    expect(within(legend).getByText('Cyclone / Hurricane')).toBeInTheDocument()
    expect(within(legend).getByText('Flood')).toBeInTheDocument()
  })

  it('shows the cyclone impact-zone legend when a cyclone is on the map, and hides it with the layer off', () => {
    const { unmount } = renderMap()
    const legend = screen.getByRole('group', { name: 'Cyclone impact zones' })
    expect(within(legend).getByText('Red Alert — Direct Impact')).toBeInTheDocument()
    expect(within(legend).getByText('Blue Advisory')).toBeInTheDocument()
    expect(within(legend).getByText('300–500 km')).toBeInTheDocument()
    unmount()
    render(
      <ThemeProvider>
        <LiveEventMap events={[QUAKE]} settings={DEFAULT_MAP_SETTINGS} types={new Set(MAP_TYPE_IDS)} />
      </ThemeProvider>,
    )
    expect(screen.queryByRole('group', { name: 'Cyclone impact zones' })).toBeNull()
  })

  it('opens the layers menu with basemaps and toggles, and closes on Escape', async () => {
    const user = userEvent.setup()
    const onSettingsChange = vi.fn()
    const onToggleType = vi.fn()
    renderMap({ onSettingsChange, onToggleType })
    const button = screen.getByRole('button', { name: 'Map layers' })
    await user.click(button)
    const panel = screen.getByRole('group', { name: 'Map layers' })
    expect(within(panel).getByRole('radio', { name: 'Satellite' })).toBeChecked()
    await user.click(within(panel).getByRole('radio', { name: 'Dark map' }))
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ basemap: 'dark' }))
    await user.click(within(panel).getByRole('checkbox', { name: /Plate boundaries/ }))
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ plates: true }))
    await user.click(within(panel).getByRole('checkbox', { name: /Cyclones/ }))
    expect(onToggleType).toHaveBeenCalledWith('cyclone')
    expect(within(panel).getByText('GDACS down')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Map layers' })).toBeNull()
    expect(button).toHaveFocus()
  })
})

describe('ZonePopup', () => {
  it('names the zone, its range and the Indian districts inside it', () => {
    const odisha = { ...STORM, storm_name: 'TEST-26', latitude: 19.8, longitude: 86.0 }
    render(<ZonePopup event={odisha} zone={CYCLONE_ZONES[0]} />)
    expect(screen.getByText(/Danger: Red Alert — Direct Impact/)).toBeInTheDocument()
    expect(screen.getByText('0–50 km from the centre of TEST-26')).toBeInTheDocument()
    expect(screen.getByText('Puri, Odisha')).toBeInTheDocument()
  })

  it('says so when no Indian district is in the ring', () => {
    render(<ZonePopup event={STORM} zone={CYCLONE_ZONES[3]} />)
    expect(screen.getByText(/no Indian district centre lies in this ring/)).toBeInTheDocument()
  })
})
