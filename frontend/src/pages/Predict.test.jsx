import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../context/ToastContext'
import Predict from './Predict'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: { predict: vi.fn() },
  ApiError: class extends Error {},
}))

const RESPONSE = {
  message: 'People are trapped and we need water',
  classified_text: 'People are trapped and we need water',
  predictions: [
    { category: 'search_and_rescue', confidence: 0.91, threshold: 0.4, triggered: true },
    { category: 'water', confidence: 0.77, threshold: 0.6, triggered: true },
    { category: 'money', confidence: 0.05, threshold: 0.5, triggered: false },
  ],
  triggered_categories: ['search_and_rescue', 'water'],
  triggered_count: 2,
  severity: { score: 94.2, level: 'critical', contributors: [] },
  event: 'Haiti earthquake',
  explanations: { water: [{ term: 'water', contribution: 0.4 }] },
  highlights: [
    { start: 31, end: 36, text: 'water', category: 'water', contribution: 0.4 },
  ],
  language: { code: 'en', name: 'English', confidence: 0.99, is_english: true, detector: 'langdetect' },
  translation: { text: null, translated: false, backend: null, error: null },
  recommendation: {
    actions: [
      {
        id: 'sar_primary',
        action: 'Dispatch a search and rescue team to the reported location',
        agency: 'Search and rescue',
        agency_key: 'sar',
        resources: ['USAR team'],
        urgency: 'immediate',
        urgency_label: 'Immediate',
        rationale: 'People are reported trapped.',
        category: 'search_and_rescue',
        probability: 0.91,
        priority: 0.9,
        source: 'category',
      },
    ],
    severity_level: 'critical',
    severity_score: 94.2,
    event: 'Haiti earthquake',
    agencies: ['Search and rescue'],
    immediate_count: 1,
    resource_priorities: [{ resource: 'USAR team', score: 0.9 }],
    rules_version: 2,
  },
  incident_summary: 'INCIDENT SUMMARY - severity CRITICAL (94.2/100)',
  model_name: 'distilbert',
  model_macro_f1: 0.4763,
}

const renderPage = () =>
  render(
    <ToastProvider>
      <Predict />
    </ToastProvider>,
  )

describe('Predict page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a character count and sample messages', () => {
    renderPage()
    expect(screen.getByText(/0 \/ 4000 characters/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /sample/i }).length).toBeGreaterThan(2)
  })

  it('classifies a message and renders severity, categories and actions', async () => {
    api.predict.mockResolvedValue(RESPONSE)
    renderPage()

    await userEvent.type(
      screen.getByLabelText(/incoming message/i),
      'People are trapped and we need water',
    )
    await userEvent.click(screen.getByRole('button', { name: /classify message/i }))

    await waitFor(() => expect(api.predict).toHaveBeenCalledOnce())
    expect(
      await screen.findByRole('img', { name: /severity critical/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Event: Haiti earthquake')).toBeInTheDocument()
    expect(screen.getAllByText('Search And Rescue').length).toBeGreaterThan(0)
    expect(
      screen.getByText('Dispatch a search and rescue team to the reported location'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Immediate').length).toBeGreaterThan(0)
  })

  it('highlights the words that drove a label', async () => {
    api.predict.mockResolvedValue(RESPONSE)
    renderPage()
    await userEvent.type(screen.getByLabelText(/incoming message/i), 'trapped and water')
    await userEvent.click(screen.getByRole('button', { name: /classify message/i }))

    const marks = await screen.findAllByText('water', { selector: 'mark' })
    expect(marks[0]).toHaveAttribute('title', expect.stringContaining('Supports water'))
  })

  it('surfaces an API failure as an alert', async () => {
    api.predict.mockRejectedValue(new Error('Cannot reach the API'))
    renderPage()
    await userEvent.type(screen.getByLabelText(/incoming message/i), 'we need help now')
    await userEvent.click(screen.getByRole('button', { name: /classify message/i }))

    expect(await screen.findAllByText(/cannot reach the api/i)).not.toHaveLength(0)
  })

  it('refuses to send a message shorter than three characters', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/incoming message/i), 'ab')
    await userEvent.click(screen.getByRole('button', { name: /classify message/i }))
    expect(api.predict).not.toHaveBeenCalled()
    expect(await screen.findByText(/at least three characters/i)).toBeInTheDocument()
  })
})
