import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { HazardBackdrop, HazardPanel, TileMotif } from './HazardHero'
import { GLYPHS } from '../map/eventIcons'
import KpiCard from '../KpiCard'
import { heroStats } from '../../lib/heroStats'
import { getDisasterType } from '../../config/disasterTypes'
import DisasterPage from '../../pages/DisasterPage'

vi.mock('../../hooks/useApi', () => ({
  useApi: () => ({ data: null, error: null, loading: true, reload: () => {} }),
}))

const DATA = {
  coverage: { records: 1087, records_first_year: 1900, last_year: 2025 },
  human: {
    metrics: [
      { key: 'deaths', value: 2433757 },
      { key: 'total_affected', value: 241700000 },
    ],
  },
}

describe('heroStats', () => {
  it('reads records, span and the headline metric from the page data', () => {
    expect(heroStats(getDisasterType('earthquake'), DATA)).toEqual([
      { label: 'Records', value: '1,087' },
      { label: 'Span', value: '1900–2025' },
      { label: 'Deaths', value: '2.4M', tone: 'deaths' },
    ])
    expect(heroStats(getDisasterType('flood'), DATA)[2]).toEqual({ label: 'Affected', value: '241.7M', tone: 'total_affected' })
  })

  it('is empty before the data arrives and skips a metric the data lacks', () => {
    expect(heroStats(getDisasterType('cyclone'), null)).toEqual([])
    expect(heroStats(getDisasterType('cyclone'), { ...DATA, human: { metrics: [] } })).toHaveLength(2)
  })
})

describe('HazardPanel', () => {
  it.each([
    ['earthquake', 'Seismograph · display', '.hz-trace'],
    ['flood', 'Water level · display', '.hz-wave-front'],
    ['cyclone', 'Storm radar · display', '.hz-sweep'],
  ])('draws the %s instrument', (hazard, title, part) => {
    const { container } = render(<HazardPanel hazard={hazard} stats={heroStats(getDisasterType(hazard), DATA)} />)
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(container.querySelector(part)).not.toBeNull()
    // The drawing is decorative; only the readouts are exposed.
    container.querySelectorAll('.hz-panel-body svg').forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })

  it('exposes the three readouts as a description list', () => {
    render(<HazardPanel hazard="earthquake" stats={heroStats(getDisasterType('earthquake'), DATA)} />)
    const panel = screen.getByRole('region', { name: 'Key figures' })
    expect(within(panel).getByText('Records').nextSibling).toHaveTextContent('1,087')
    expect(within(panel).getByText('Span').nextSibling).toHaveTextContent('1900–2025')
    expect(within(panel).getByText('Deaths').closest('div')).toHaveAttribute('data-tone', 'deaths')
  })

  it('shows dashes while the page is loading, never invented figures', () => {
    const { container } = render(<HazardPanel hazard="flood" stats={[]} />)
    expect([...container.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['—', '—', '—'])
  })

  it('renders nothing for an unknown hazard', () => {
    const { container } = render(<HazardPanel hazard="volcano" stats={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('hazard motifs', () => {
  it('reuses the World Map storm spiral for cyclones', () => {
    const { container } = render(<TileMotif hazard="cyclone" />)
    // Same artwork: the spiral's arm path from the map marker, parsed the same way.
    const arm = /<path d="([^"]+)"/.exec(GLYPHS.cyclone)[1]
    expect(container.querySelector('.hz-spiral path').getAttribute('d')).toBe(arm)
    expect(container.querySelectorAll('.hz-spiral path')).toHaveLength(3)
    expect(container.querySelector('.hz-spiral')).toHaveAttribute('aria-hidden', 'true')
  })

  it('draws ripples for floods and nothing extra for earthquakes', () => {
    expect(render(<TileMotif hazard="flood" />).container.querySelectorAll('.hz-ripples > span')).toHaveLength(3)
    expect(render(<TileMotif hazard="earthquake" />).container).toBeEmptyDOMElement()
    expect(render(<HazardBackdrop hazard="earthquake" />).container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('KpiCard theme hooks', () => {
  it('names its metric and draws a clamped meter only when asked', () => {
    const { container, rerender } = render(<KpiCard title="Deaths" value="2.4M" tone="deaths" meter={0.84} />)
    const card = container.querySelector('.kpi-card')
    expect(card).toHaveAttribute('data-tone', 'deaths')
    expect(container.querySelector('.kpi-meter > span').style.width).toBe('84%')
    expect(container.querySelector('.kpi-meter')).toHaveAttribute('aria-hidden', 'true')
    rerender(<KpiCard title="Deaths" value="2.4M" meter={1.7} />)
    expect(container.querySelector('.kpi-meter > span').style.width).toBe('100%')
    rerender(<KpiCard title="Deaths" value="2.4M" />)
    expect(container.querySelector('.kpi-meter')).toBeNull()
    expect(container.querySelector('.kpi-card')).not.toHaveAttribute('data-tone')
  })
})

describe('DisasterPage theme root', () => {
  it('sets data-hazard from the page type, so each tab gets its own theme', () => {
    const { container, rerender } = render(<DisasterPage id="earthquake" />)
    const root = () => container.querySelector('.hazard-page')
    expect(root()).toHaveAttribute('data-hazard', 'earthquake')
    expect(screen.getByText('Hazard 01')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Earthquake')
    rerender(<DisasterPage id="cyclone" />)
    expect(root()).toHaveAttribute('data-hazard', 'cyclone')
    expect(screen.getByText('Hazard 03')).toBeInTheDocument()
    expect(screen.getByText('Storm radar · display')).toBeInTheDocument()
  })
})
