import { useMemo, useRef, useState } from 'react'
import { Download, Flame, ListFilter, Upload } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { downloadCsv } from '../lib/download'
import { SimpleBarChart } from '../components/charts/Charts'
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SeverityBadge,
  SkeletonCard,
} from '../components/ui'
import { SEVERITY_ORDER, formatNumber, humanCategory, titleCase } from '../lib/format'

const ROW_HEIGHT = 44
const VIEWPORT_ROWS = 12

const PLACEHOLDER = `One message per line, for example:

We need water and food at the school shelter
Building collapsed on Main Street, people trapped
Roads are flooded near the river crossing`

/** Simple windowed table: only the visible slice of rows is rendered. */
function VirtualTable({ rows, onSelect, selectedIndex }) {
  const [scrollTop, setScrollTop] = useState(0)
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3)
  const visible = rows.slice(start, start + VIEWPORT_ROWS + 6)

  return (
    <div
      className="table-wrap"
      style={{ maxHeight: ROW_HEIGHT * VIEWPORT_ROWS }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <table className="data">
        <caption className="visually-hidden">Triaged messages sorted by severity</caption>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Score</th>
            <th scope="col">Event</th>
            <th scope="col">Top label</th>
            <th scope="col">Message</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ height: start * ROW_HEIGHT }} aria-hidden="true">
            <td colSpan={5} style={{ padding: 0, border: 0 }} />
          </tr>
          {visible.map((row) => (
            <tr
              key={row.index}
              onClick={() => onSelect(row.index)}
              style={{
                cursor: 'pointer',
                background: selectedIndex === row.index ? 'var(--surface-hover)' : undefined,
              }}
            >
              <td>
                <SeverityBadge level={row.severity.level} />
              </td>
              <td className="mono">{row.severity.score.toFixed(0)}</td>
              <td>{row.event}</td>
              <td>{row.top_category ? titleCase(row.top_category) : '—'}</td>
              <td className="wrap">{row.message}</td>
            </tr>
          ))}
          <tr
            style={{ height: Math.max(0, (rows.length - start - visible.length) * ROW_HEIGHT) }}
            aria-hidden="true"
          >
            <td colSpan={5} style={{ padding: 0, border: 0 }} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function Triage() {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [severityFilter, setSeverityFilter] = useState('all')
  const [eventFilter, setEventFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedIndex, setSelectedIndex] = useState(null)
  const fileRef = useRef(null)
  const toast = useToast()

  const run = async (loader, label) => {
    setPending(true)
    setError(null)
    try {
      const body = await loader()
      setResult(body)
      setSelectedIndex(null)
      toast.success(`${label}: ${body.count} messages triaged in ${Math.round(body.elapsed_ms)} ms`)
    } catch (apiError) {
      setError(apiError.message)
      toast.error(apiError.message)
    } finally {
      setPending(false)
    }
  }

  const submitText = () => {
    const messages = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 3)
    if (messages.length === 0) {
      toast.error('Add at least one message of three characters or more')
      return
    }
    run(() => api.predictBatch(messages), 'Pasted batch')
  }

  const submitFile = (file) => {
    if (!file) return
    run(() => api.predictBatchCsv(file), file.name)
  }

  const categories = useMemo(() => {
    const set = new Set()
    result?.items.forEach((item) => item.triggered_categories.forEach((c) => set.add(c)))
    return [...set].sort()
  }, [result])

  const filtered = useMemo(() => {
    if (!result) return []
    return result.items.filter((item) => {
      if (severityFilter !== 'all' && item.severity.level !== severityFilter) return false
      if (eventFilter !== 'all' && item.event !== eventFilter) return false
      if (categoryFilter !== 'all' && !item.triggered_categories.includes(categoryFilter)) {
        return false
      }
      return true
    })
  }, [result, severityFilter, eventFilter, categoryFilter])

  const selected = result?.items.find((item) => item.index === selectedIndex)

  const exportCsv = () => {
    const rows = filtered.map((item) => ({
      severity: item.severity.level,
      score: item.severity.score,
      event: item.event,
      top_category: item.top_category,
      categories: item.triggered_categories.join('|'),
      immediate_actions: item.recommendation?.immediate_count ?? 0,
      message: item.message,
    }))
    if (!downloadCsv(rows, 'triage.csv')) toast.error('Nothing to export')
  }

  return (
    <div className="stack">
      <PageHeader
        title="Triage Inbox"
        description="Classify many messages at once, sort them by severity, and export the queue. Upload a CSV with a message column or paste one message per line."
      />

      <section className="card">
        <div className="grid grid-2">
          <div>
            <label className="field-label" htmlFor="batch-text">
              Paste messages
            </label>
            <textarea
              id="batch-text"
              className="textarea"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={PLACEHOLDER}
            />
            <div className="row" style={{ marginTop: 'var(--space-3)', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitText}
                disabled={pending}
              >
                <ListFilter size={14} aria-hidden="true" />
                Triage {text.split('\n').filter((l) => l.trim().length >= 3).length} messages
              </button>
            </div>
          </div>

          <div>
            <span className="field-label">Or upload a CSV</span>
            <div
              className="card"
              style={{
                background: 'var(--surface-2)',
                borderStyle: 'dashed',
                textAlign: 'center',
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                submitFile(event.dataTransfer.files?.[0])
              }}
            >
              <Upload size={20} aria-hidden="true" className="muted" />
              <p className="text-sm secondary" style={{ margin: '8px 0' }}>
                Drop a CSV here, or choose a file. The text column can be named message,
                text, body or content.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="visually-hidden"
                id="csv-file"
                onChange={(event) => submitFile(event.target.files?.[0])}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={pending}
              >
                Choose CSV file
              </button>
            </div>
          </div>
        </div>
      </section>

      {pending && <SkeletonCard height={260} />}
      {error && !pending && <ErrorState message={error} onRetry={submitText} />}

      {result && !pending && (
        <>
          <div className="grid grid-2">
            <section className="card" aria-label="Severity breakdown">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Severity breakdown</h2>
                  <p className="card-insight">
                    {result.severity_breakdown.critical + result.severity_breakdown.high} of{' '}
                    {result.count} messages need attention within six hours.
                  </p>
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {SEVERITY_ORDER.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="btn btn-sm"
                    aria-pressed={severityFilter === level}
                    onClick={() =>
                      setSeverityFilter((current) => (current === level ? 'all' : level))
                    }
                    style={{
                      borderColor:
                        severityFilter === level ? 'var(--accent)' : undefined,
                    }}
                  >
                    <SeverityBadge level={level} />
                    {formatNumber(result.severity_breakdown[level] ?? 0)}
                  </button>
                ))}
              </div>
            </section>

            <section className="card" aria-label="Resource demand forecast">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Resource demand forecast</h2>
                  <p className="card-insight">
                    Aggregated across every plan in this batch, ranked by priority weight.
                  </p>
                </div>
              </div>
              {result.forecast.resources.length === 0 ? (
                <EmptyState message="No resources were requested in this batch" />
              ) : (
                <SimpleBarChart
                  data={result.forecast.resources.slice(0, 8).map((row) => ({
                    resource: row.resource,
                    count: row.requests,
                  }))}
                  xKey="resource"
                  height={240}
                  color="var(--series-3)"
                />
              )}
            </section>
          </div>

          <section className="card" aria-label="Most urgent messages">
            <div className="card-header">
              <div>
                <h2 className="card-title">Top 10 most urgent messages</h2>
                <p className="card-insight">Highest severity scores in this batch.</p>
              </div>
            </div>
            <ol className="stack" style={{ paddingLeft: 18, margin: 0 }}>
              {result.top_urgent.map((item) => (
                <li key={item.index}>
                  <div className="row" style={{ gap: 8 }}>
                    <SeverityBadge level={item.severity.level} score={item.severity.score} />
                    <span className="text-sm">{item.message}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="card" aria-label="Triaged queue">
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  Queue ({formatNumber(filtered.length)} of {formatNumber(result.count)})
                </h2>
                <p className="card-insight">
                  Sorted by severity. Select a row to see its recommended actions.
                </p>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <label className="visually-hidden" htmlFor="event-filter">
                  Filter by event
                </label>
                <select
                  id="event-filter"
                  className="select"
                  style={{ width: 'auto', minWidth: 150 }}
                  value={eventFilter}
                  onChange={(event) => setEventFilter(event.target.value)}
                >
                  <option value="all">All events</option>
                  {Object.keys(result.event_breakdown).map((event) => (
                    <option key={event} value={event}>
                      {event}
                    </option>
                  ))}
                </select>
                <label className="visually-hidden" htmlFor="category-filter">
                  Filter by category
                </label>
                <select
                  id="category-filter"
                  className="select"
                  style={{ width: 'auto', minWidth: 150 }}
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {titleCase(category)}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-sm" onClick={exportCsv}>
                  <Download size={13} aria-hidden="true" />
                  Export CSV
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState message="No messages match these filters" />
            ) : (
              <VirtualTable
                rows={filtered}
                onSelect={setSelectedIndex}
                selectedIndex={selectedIndex}
              />
            )}
          </section>

          {selected?.recommendation && (
            <section className="card fade-in" aria-label="Actions for the selected message">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Actions for the selected message</h2>
                  <p className="card-insight">{selected.message}</p>
                </div>
                <SeverityBadge
                  level={selected.severity.level}
                  score={selected.severity.score}
                  size="lg"
                />
              </div>
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {selected.recommendation.actions.map((action, index) => (
                  <li key={action.id + index} className="row" style={{ gap: 8 }}>
                    <Flame size={14} aria-hidden="true" color="var(--severity-high)" />
                    <span className="text-sm" style={{ flex: 1 }}>
                      <strong>{action.urgency_label}:</strong> {action.action}{' '}
                      <span className="muted">({action.agency})</span>
                    </span>
                  </li>
                ))}
              </ul>
              {selected.triggered_categories.length > 0 && (
                <div className="row" style={{ gap: 6, marginTop: 'var(--space-3)' }}>
                  {selected.triggered_categories.map((category) => (
                    <span key={category} className="chip">
                      {humanCategory(category)}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
