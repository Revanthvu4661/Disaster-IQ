import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CardMotif, sourceHazard, sourceServes } from './OverviewParts'
import { GLYPHS } from '../map/eventIcons'
import Overview from '../../pages/Overview'

const LAYERS = {
  earthquake: { status: 'ok', count: 97, sources: [{ id: 'usgs' }, { id: 'gdacs' }] },
  flood: { status: 'ok', count: 16, sources: [{ id: 'gdacs' }, { id: 'eonet' }] },
  cyclone: { status: 'ok', count: 8, sources: [{ id: 'gdacs' }, { id: 'eonet' }] },
}
const SUMMARY = {
  layers: LAYERS,
  sources: [
    { id: 'usgs', name: 'USGS', status: 'ok', count: 96 },
    { id: 'gdacs', name: 'GDACS', status: 'unavailable', count: 0 },
    { id: 'eonet', name: 'NASA EONET', status: 'ok', count: 1 },
  ],
  fetched_at: new Date().toISOString(),
}

vi.mock('../../hooks/useApi', () => ({
  useApi: () => ({ data: null, error: null, loading: true, reload: () => {} }),
}))
vi.mock('../../hooks/useLive', async (importOriginal) => ({
  ...(await importOriginal()),
  useLiveSummary: () => ({ data: SUMMARY, error: null, loading: false, reload: () => {} }),
}))

describe('Overview helpers', () => {
  it('tints each feed toward one hazard', () => {
    expect(['usgs', 'gdacs', 'eonet'].map(sourceHazard)).toEqual(['earthquake', 'flood', 'cyclone'])
  })

  it('says what each feed serves, from the live layers', () => {
    expect(sourceServes('usgs', LAYERS)).toBe('earthquakes')
    expect(sourceServes('gdacs', LAYERS)).toBe('earthquakes · floods · cyclones')
    expect(sourceServes('eonet', LAYERS)).toBe('floods · cyclones')
    expect(sourceServes('usgs', undefined)).toBe('')
  })

  it('draws a decorative motif per hazard, the cyclone one from the map spiral', () => {
    for (const hazard of ['earthquake', 'flood', 'cyclone']) {
      const { container, unmount } = render(<CardMotif hazard={hazard} />)
      expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
      unmount()
    }
    const { container } = render(<CardMotif hazard="cyclone" />)
    const arm = /<path d="([^"]+)"/.exec(GLYPHS.cyclone)[1]
    expect(container.querySelector('path').getAttribute('d')).toBe(arm)
  })
})

describe('Overview page theme', () => {
  // The page is imported at the top (vi.mock is hoisted above it), so loading
  // it never counts against a test's time limit.
  const renderOverview = async () =>
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    )

  it('uses the blended overview theme on its root', async () => {
    const { container } = await renderOverview()
    const root = container.querySelector('.overview-page')
    expect(root).toHaveAttribute('data-hazard', 'overview')
    expect(root).toHaveClass('hazard-page')
  })

  it('keeps the feed status words and names what each feed serves', async () => {
    await renderOverview()
    const strip = screen.getByRole('list', { name: 'Live feed status' })
    expect(within(strip).getByText('96 records')).toBeInTheDocument()
    expect(within(strip).getByText('temporarily unavailable')).toBeInTheDocument()
    expect(within(strip).getByText('1 record')).toBeInTheDocument()
    expect(within(strip).getByText('floods · cyclones')).toBeInTheDocument()
    expect(within(strip).getByText('USGS').closest('li')).toHaveAttribute('data-hazard', 'earthquake')
  })

  it('shows the three hazard words and keeps the page title as its eyebrow', async () => {
    await renderOverview()
    expect(screen.getByText('Three disasters, one view')).toBeInTheDocument()
    const title = screen.getByRole('heading', { level: 1 })
    expect(title).toHaveTextContent(/Earthquake.*Flood.*Cyclone/)
    // Dashes, not invented figures, until the coverage data arrives; the type count is fixed.
    const stats = screen.getByLabelText('Coverage')
    expect([...stats.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['—', '—', '3'])
  })
})
