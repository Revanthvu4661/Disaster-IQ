import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DISASTER_IDS, DISASTER_TYPES, applyDisasterTokens } from './disasterTypes'
import { NAV_ITEMS } from '../navigation'
import SourceBadge from '../components/SourceBadge'
import { downSources, isIncomplete } from '../hooks/useLive'
import { shortPlace } from '../lib/liveEvents'

describe('disaster taxonomy', () => {
  it('lists the three types in the fixed order', () => {
    expect(DISASTER_IDS).toEqual(['earthquake', 'flood', 'cyclone'])
  })

  it('gives every type EM-DAT impact data and only earthquake and cyclone a point source', () => {
    expect(DISASTER_TYPES.every((type) => type.historical.impact === 'emdat')).toBe(true)
    expect(Object.fromEntries(DISASTER_TYPES.map((type) => [type.id, type.historical.points]))).toEqual({
      earthquake: 'usgs',
      flood: null,
      cyclone: 'ibtracs',
    })
  })

  it('drives the primary navigation: Overview, three types, World Map, Pre-Prediction, then Levels 2 and 3', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Overview',
      'Earthquake',
      'Flood',
      'Cyclone/Hurricane',
      'World Map',
      'Pre-Prediction',
      'Disaster Risk Prediction',
      'Preparedness & Response Recommendations',
    ])
  })

  it('writes one colour token per type for the active theme', () => {
    applyDisasterTokens('light')
    expect(document.documentElement.style.getPropertyValue('--dt-flood')).toBe('#1D4ED8')
    applyDisasterTokens('dark')
    expect(document.documentElement.style.getPropertyValue('--dt-flood')).toBe('#60A5FA')
  })
})

describe('SourceBadge', () => {
  it('names the historical source, or says it is live', () => {
    render(
      <>
        <SourceBadge source={['emdat', 'usgs']} />
        <SourceBadge kind="live" />
      </>,
    )
    expect(screen.getByText(/OWID \/ EM-DAT · USGS/)).toBeInTheDocument()
    expect(screen.getByText(/live feed/i)).toBeInTheDocument()
  })

  it('discloses what the source is', async () => {
    render(<SourceBadge source="ibtracs" />)
    const toggle = screen.getByRole('button', { name: /about the source: noaa ibtracs/i })
    expect(screen.getByRole('note', { hidden: true })).not.toBeVisible()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('note')).toHaveTextContent('tropical-storm strength')
  })
})

describe('live helpers', () => {
  const layer = (statuses) => ({
    sources: statuses.map(([name, status]) => ({ id: name, name, status })),
  })

  it('treats a layer with a failed feed as incomplete', () => {
    expect(isIncomplete(layer([['GDACS', 'unavailable'], ['NASA EONET', 'ok']]))).toBe(true)
    expect(downSources(layer([['GDACS', 'unavailable'], ['NASA EONET', 'ok']]))).toEqual(['GDACS'])
    expect(isIncomplete(layer([['GDACS', 'stale'], ['NASA EONET', 'ok']]))).toBe(false)
  })

  it('shortens long country lists but keeps ordinary places', () => {
    expect(shortPlace({ location: 'Austria, Belgium, Belarus, Switzerland' })).toBe(
      'Austria, Belgium +2 more',
    )
    expect(shortPlace({ location: '35 km NNE of Ruteng, Indonesia' })).toBe(
      '35 km NNE of Ruteng, Indonesia',
    )
  })
})
