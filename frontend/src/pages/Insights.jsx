import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { api } from '../api/client'
import { useApi, useApiAll } from '../hooks/useApi'
import ChartCard from '../components/ChartCard'
import { SimpleBarChart } from '../components/charts/Charts'
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  SkeletonCard,
} from '../components/ui'
import { formatNumber, formatPercent, humanCategory, titleCase } from '../lib/format'

const DEFAULT_CATEGORY = 'water'

/** "What words signal each category?" explorer. */
function TermExplorer({ categories }) {
  const [category, setCategory] = useState(DEFAULT_CATEGORY)
  const corpus = useApi(() => api.topTerms(category, 15), [category])
  const model = useApi(() => api.globalTerms(category, 15), [category])

  return (
    <section className="card" aria-label="Category term explorer">
      <div className="card-header">
        <div>
          <h2 className="card-title">What words signal each category?</h2>
          <p className="card-insight">
            Corpus terms are measured by lift against the whole dataset; model terms come
            from the linear explainer&apos;s coefficients.
          </p>
        </div>
        <div>
          <label className="visually-hidden" htmlFor="term-category">
            Category
          </label>
          <select
            id="term-category"
            className="select"
            style={{ width: 'auto', minWidth: 170 }}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categories.map((entry) => (
              <option key={entry.category} value={entry.category}>
                {titleCase(entry.category)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-2">
        <div>
          <h3 className="field-label">Distinctive in the corpus</h3>
          {corpus.loading && <Skeleton height={120} />}
          {corpus.error && <ErrorState message={corpus.error} onRetry={corpus.reload} compact />}
          {corpus.data?.length === 0 && (
            <EmptyState message="Too few labelled messages for reliable terms" />
          )}
          <div className="row" style={{ gap: 6 }}>
            {(corpus.data ?? []).map((term) => (
              <span
                key={term.term}
                className="chip"
                title={`${formatNumber(term.count)} messages, lift ${term.lift}`}
              >
                {term.term}
                <span className="muted mono">{term.lift}x</span>
              </span>
            ))}
          </div>
        </div>

        <div>
          <h3 className="field-label">Highest model weights</h3>
          {model.loading && <Skeleton height={120} />}
          {model.error && <ErrorState message={model.error} onRetry={model.reload} compact />}
          {model.data?.terms?.length === 0 && (
            <EmptyState message="The explainer has no positive weights for this label" />
          )}
          <div className="row" style={{ gap: 6 }}>
            {(model.data?.terms ?? []).map((term) => (
              <span key={term.term} className="chip" title={`Weight ${term.weight}`}>
                {term.term}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/** Keyword-in-context search over the corpus. */
function KwicSearch() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const { data, error, loading } = useApi(() => api.search(query, { limit: 15 }), [query], {
    enabled: query.trim().length >= 2,
  })

  return (
    <section className="card" aria-label="Keyword in context search">
      <div className="card-header">
        <div>
          <h2 className="card-title">Keyword in context</h2>
          <p className="card-insight">
            See how a term is actually used in the field, with the surrounding words.
          </p>
        </div>
      </div>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault()
          setQuery(input)
        }}
      >
        <label className="visually-hidden" htmlFor="kwic">
          Search term
        </label>
        <input
          id="kwic"
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="tent, cholera, boat, generator"
        />
        <button type="submit" className="btn">
          <Search size={14} aria-hidden="true" />
          Search
        </button>
      </form>

      <div style={{ marginTop: 'var(--space-4)' }}>
        {loading && <Skeleton height={140} />}
        {error && <ErrorState message={error} compact />}
        {!query && <EmptyState message="Enter a term to search 26,000 messages" />}
        {data && (
          <>
            <p className="text-xs muted" style={{ marginBottom: 8 }}>
              {formatNumber(data.total)} matches, showing {data.results.length}
            </p>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {data.results.map((row) => (
                <li key={row.id} className="text-sm" style={{ lineHeight: 1.6 }}>
                  <span className="muted">{row.before}</span>
                  <mark className="term">{row.match}</mark>
                  <span className="muted">{row.after}</span>
                  <span className="chip" style={{ marginLeft: 8 }}>
                    {row.event}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

export default function Insights() {
  const { data, error, loading, reload } = useApiAll(
    {
      categories: () => api.categoryDistribution(),
      bundles: () => api.needsBundles(10),
      lengths: () => api.messageLength(),
      urgentTerms: () => api.urgentTerms(30),
      quality: () => api.dataQuality(),
    },
    [],
  )

  const lengthRows = useMemo(
    () =>
      (data?.lengths?.bins ?? []).map((bin) => ({
        range: `${bin.start}-${bin.end}`,
        count: bin.count,
      })),
    [data],
  )

  if (loading) {
    return (
      <div className="stack">
        <PageHeader title="Insights" description="Loading text and quality analytics" />
        <SkeletonCard height={220} />
        <SkeletonCard height={220} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="stack">
        <PageHeader title="Insights" />
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  const { categories, bundles, lengths, urgentTerms, quality } = data
  const maxUrgent = urgentTerms[0]?.count ?? 1

  return (
    <div className="stack">
      <PageHeader
        title="Insights"
        description="Text analytics, needs bundles and data quality behind the headline numbers."
      />

      <TermExplorer categories={categories.filter((row) => row.count > 100)} />

      <div className="grid grid-2">
        <ChartCard
          title="Needs bundles"
          insight={`The most common combination is ${bundles[0]?.categories.map(humanCategory).join(' + ')}, in ${formatNumber(bundles[0]?.count ?? 0)} messages.`}
          csvRows={bundles.map((bundle) => ({
            categories: bundle.categories.join(' + '),
            count: bundle.count,
            share: bundle.share,
          }))}
          csvName="needs-bundles.csv"
        >
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {bundles.map((bundle) => (
              <li
                key={bundle.categories.join('|')}
                className="row"
                style={{ justifyContent: 'space-between' }}
              >
                <span className="row" style={{ gap: 4 }}>
                  {bundle.categories.map((category) => (
                    <span key={category} className="chip">
                      {humanCategory(category)}
                    </span>
                  ))}
                </span>
                <span className="text-xs mono muted">{formatNumber(bundle.count)}</span>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard
          title="Message length"
          insight={`Half of all messages are under ${lengths.median} characters, so the model must work on very short text.`}
          csvRows={lengthRows}
          csvName="message-length.csv"
          tableColumns={[
            { key: 'range', label: 'Characters' },
            { key: 'count', label: 'Messages' },
          ]}
          tableRows={lengthRows}
        >
          <SimpleBarChart data={lengthRows} xKey="range" height={240} color="var(--series-4)" />
          <p className="text-xs muted" style={{ marginTop: 8 }}>
            Median {lengths.median} · mean {lengths.mean} · 95th percentile {lengths.p95}{' '}
            characters
          </p>
        </ChartCard>
      </div>

      <ChartCard
        title="Terms in urgent messages"
        insight="Ranked by frequency inside severity-weighted messages, with lift against the whole corpus."
        csvRows={urgentTerms}
        csvName="urgent-terms.csv"
      >
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          {urgentTerms.map((term) => (
            <span
              key={term.term}
              title={`${formatNumber(term.count)} urgent messages, lift ${term.lift}`}
              style={{
                fontSize: `${0.75 + (term.count / maxUrgent) * 0.9}rem`,
                fontWeight: 600,
                color:
                  term.lift > 1.5
                    ? 'var(--severity-high)'
                    : term.lift > 1.1
                      ? 'var(--text)'
                      : 'var(--text-muted)',
              }}
            >
              {term.term}
            </span>
          ))}
        </div>
      </ChartCard>

      <KwicSearch />

      <section className="card" aria-label="Data quality">
        <div className="card-header">
          <div>
            <h2 className="card-title">Data quality</h2>
            <p className="card-insight">
              What was cleaned, what is noisy, and which labels are too rare to trust.
            </p>
          </div>
        </div>
        <div className="grid grid-kpi">
          {[
            ['Rows after cleaning', formatNumber(quality.rows)],
            ['Duplicate messages removed', formatNumber(quality.duplicates_removed)],
            ['Irrelevant (related=2)', `${formatNumber(quality.irrelevant_count)} (${formatPercent(quality.irrelevant_share, 2)})`],
            ['Messages under 20 characters', formatNumber(quality.short_messages)],
            ['Non-English originals', formatPercent(quality.non_english_share)],
            ['Label imbalance ratio', `${quality.imbalance_ratio}:1`],
            ['Events not inferable', formatPercent(quality.events_unassigned_share)],
            ['Labels with no positives', quality.empty_labels.map((l) => titleCase(l.category)).join(', ') || 'None'],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="field-label" style={{ marginBottom: 2 }}>
                {label}
              </p>
              <p style={{ fontWeight: 650 }}>{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs muted" style={{ marginTop: 'var(--space-3)' }}>
          Rarest labels:{' '}
          {quality.rarest_labels
            .map((row) => `${titleCase(row.category)} (${row.count})`)
            .join(', ')}
          . Metrics for these labels are unstable and are flagged on the Model page.
        </p>
      </section>
    </div>
  )
}
