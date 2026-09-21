import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ClipboardCopy,
  Clock3,
  Languages,
  Send,
  Sparkles,
  Users,
} from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import SeverityGauge from '../components/SeverityGauge'
import {
  CategoryChip,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonCard,
} from '../components/ui'
import { formatPercent, humanCategory, titleCase } from '../lib/format'

const MAX_LENGTH = 4000

const SAMPLES = [
  'We are trapped under a collapsed building in Leogane, several people are injured and we have no water',
  'Please we need food and clean drinking water for about fifty families near the camp',
  'The river has burst its banks in Sindh, our village is cut off and we need boats to evacuate',
  'Nou bezwen dlo ak manje nan Jacmel, tanpri ede nou',
  'Power is still out across Staten Island and the basement is flooded',
]

const URGENCY_STYLE = {
  immediate: 'sev-critical',
  within_6h: 'sev-high',
  within_24h: 'sev-medium',
}

/** Renders the message with model-attributed terms highlighted. */
function HighlightedMessage({ text, highlights }) {
  if (!highlights?.length) return <p style={{ lineHeight: 1.7 }}>{text}</p>
  const parts = []
  let cursor = 0
  highlights.forEach((span, index) => {
    if (span.start > cursor) parts.push(text.slice(cursor, span.start))
    parts.push(
      <mark
        key={`${span.start}-${index}`}
        className="term"
        title={`Supports ${humanCategory(span.category)} (contribution ${span.contribution.toFixed(3)})`}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    )
    cursor = span.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <p style={{ lineHeight: 1.7 }}>{parts}</p>
}

function ActionTimeline({ actions }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
      {actions.map((action, index) => (
        <li
          key={action.id + index}
          className="card"
          style={{ padding: 'var(--space-3)', background: 'var(--surface-2)' }}
        >
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <span className={`chip ${URGENCY_STYLE[action.urgency] ?? ''}`}>
              <Clock3 size={13} aria-hidden="true" />
              {action.urgency_label}
            </span>
            <span className="chip">
              <Users size={13} aria-hidden="true" />
              {action.agency}
            </span>
          </div>
          <p style={{ fontWeight: 600, marginTop: 8 }}>{action.action}</p>
          <p className="text-sm secondary" style={{ marginTop: 4 }}>
            {action.rationale}
          </p>
          {action.resources.length > 0 && (
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              {action.resources.map((resource) => (
                <span key={resource} className="chip">
                  {resource}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

export default function Predict() {
  const [message, setMessage] = useState('')
  const [result, setResult] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const toast = useToast()
  const textareaRef = useRef(null)

  const submit = useCallback(
    async (event) => {
      event?.preventDefault()
      const text = message.trim()
      if (text.length < 3) {
        toast.error('Enter at least three characters')
        return
      }
      setPending(true)
      setError(null)
      try {
        const body = await api.predict(text)
        setResult(body)
      } catch (apiError) {
        setError(apiError.message)
        toast.error(apiError.message)
      } finally {
        setPending(false)
      }
    },
    [message, toast],
  )

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(result.incident_summary)
      toast.success('Incident summary copied')
    } catch {
      toast.error('Clipboard is not available in this browser')
    }
  }

  const triggered = useMemo(
    () => (result?.predictions ?? []).filter((entry) => entry.triggered),
    [result],
  )

  return (
    <div className="stack">
      <PageHeader
        title="Predict"
        description="Classify one message across 35 labels, score its severity, and get a prioritised action plan with the words that drove each label."
      />

      <form className="card" onSubmit={submit}>
        <label className="field-label" htmlFor="message">
          Incoming message
        </label>
        <textarea
          id="message"
          ref={textareaRef}
          className="textarea"
          value={message}
          maxLength={MAX_LENGTH}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit(event)
          }}
          placeholder="Paste or type a message from the field, in any language"
          aria-describedby="message-help"
        />
        <div
          className="row"
          style={{ justifyContent: 'space-between', marginTop: 'var(--space-3)' }}
        >
          <span id="message-help" className="text-xs muted">
            {message.length} / {MAX_LENGTH} characters · Ctrl+Enter to classify
          </span>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            <Send size={14} aria-hidden="true" />
            {pending ? 'Classifying' : 'Classify message'}
          </button>
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <span className="field-label">Sample messages</span>
          <div className="row" style={{ gap: 6 }}>
            {SAMPLES.map((sample, index) => (
              <button
                key={sample}
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setMessage(sample)
                  textareaRef.current?.focus()
                }}
              >
                <Sparkles size={12} aria-hidden="true" />
                Sample {index + 1}
              </button>
            ))}
          </div>
        </div>
      </form>

      {pending && !result && <SkeletonCard height={220} />}
      {error && !pending && <ErrorState message={error} onRetry={submit} />}

      {result && (
        <div className="stack" style={{ opacity: pending ? 0.6 : 1 }} aria-busy={pending}>
          <section className="card fade-in" aria-label="Classification result">
            <div className="grid" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'start' }}>
              <SeverityGauge score={result.severity.score} level={result.severity.level} />
              <div className="stack" style={{ gap: 'var(--space-3)', minWidth: 240 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="chip">Event: {result.event}</span>
                  <span className="chip">
                    {result.triggered_count} of {result.predictions.length} labels triggered
                  </span>
                  {result.language && !result.language.is_english && (
                    <span className="chip">
                      <Languages size={13} aria-hidden="true" />
                      {result.language.name}
                      {result.translation?.translated ? ' · translated' : ' · not translated'}
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="field-label">Message with model evidence</h3>
                  <HighlightedMessage
                    text={result.classified_text}
                    highlights={result.highlights}
                  />
                  {result.translation?.translated && (
                    <p className="text-xs muted" style={{ marginTop: 8 }}>
                      Translated from {result.language.name} via {result.translation.backend}.
                      Original: {result.message}
                    </p>
                  )}
                  {result.language &&
                    !result.language.is_english &&
                    !result.translation?.translated && (
                      <p className="text-xs muted" style={{ marginTop: 8 }}>
                        Translation unavailable ({result.translation?.error}); the multilingual
                        model classified the original text.
                      </p>
                    )}
                </div>

                <button type="button" className="btn btn-sm" onClick={copySummary}>
                  <ClipboardCopy size={13} aria-hidden="true" />
                  Copy incident summary
                </button>
              </div>
            </div>
          </section>

          <section className="card fade-in" aria-label="Triggered categories">
            <div className="card-header">
              <div>
                <h2 className="card-title">Triggered categories</h2>
                <p className="card-insight">
                  Each label uses its own tuned threshold, not a fixed 0.5 cut-off.
                </p>
              </div>
            </div>
            {triggered.length === 0 ? (
              <EmptyState message="No label passed its threshold. The message may be off-topic." />
            ) : (
              <div className="row" style={{ gap: 8 }}>
                {triggered.map((entry) => (
                  <CategoryChip
                    key={entry.category}
                    category={entry.category}
                    confidence={entry.confidence}
                    threshold={entry.threshold}
                  />
                ))}
              </div>
            )}

            {Object.keys(result.explanations ?? {}).length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <h3 className="field-label">Words that drove each label</h3>
                <div className="grid grid-2">
                  {Object.entries(result.explanations).map(([category, terms]) => (
                    <div key={category}>
                      <p className="text-sm" style={{ fontWeight: 600 }}>
                        {titleCase(category)}
                      </p>
                      <div className="row" style={{ gap: 6, marginTop: 6 }}>
                        {terms.map((term) => (
                          <span
                            key={term.term}
                            className="chip"
                            title={`Contribution ${term.contribution.toFixed(3)}`}
                          >
                            {term.term}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {result.recommendation && (
            <section className="card fade-in" aria-label="Recommended actions">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Recommended actions</h2>
                  <p className="card-insight">
                    {result.recommendation.immediate_count} immediate action
                    {result.recommendation.immediate_count === 1 ? '' : 's'} across{' '}
                    {result.recommendation.agencies.length} teams, ordered by urgency then
                    priority.
                  </p>
                </div>
              </div>
              <ActionTimeline actions={result.recommendation.actions} />

              {result.recommendation.resource_priorities.length > 0 && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <h3 className="field-label">Resources to move first</h3>
                  <div className="row" style={{ gap: 6 }}>
                    {result.recommendation.resource_priorities.slice(0, 8).map((resource) => (
                      <span key={resource.resource} className="chip">
                        {resource.resource}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              All {result.predictions.length} label scores
            </summary>
            <div className="table-wrap" style={{ marginTop: 'var(--space-3)', maxHeight: 340 }}>
              <table className="data">
                <caption className="visually-hidden">Confidence per category</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Confidence</th>
                    <th scope="col">Threshold</th>
                    <th scope="col">Triggered</th>
                  </tr>
                </thead>
                <tbody>
                  {result.predictions.map((entry) => (
                    <tr key={entry.category}>
                      <td>{titleCase(entry.category)}</td>
                      <td className="mono">{formatPercent(entry.confidence)}</td>
                      <td className="mono">{entry.threshold.toFixed(2)}</td>
                      <td>{entry.triggered ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
