import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Filter,
  Layers,
  MessageSquare,
  PackageSearch,
  X,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi, useApiAll } from '../hooks/useApi'
import ChartCard from '../components/ChartCard'
import Deferred from '../components/Deferred'
import KpiCard from '../components/KpiCard'
import Heatmap from '../components/charts/Heatmap'
import { CategoryBarChart, GroupedBarChart, SimpleBarChart } from '../components/charts/LazyCharts'
import { ErrorState, PageHeader, SkeletonCard } from '../components/ui'
import { formatNumber, formatPercent, humanCategory, titleCase } from '../lib/format'

const TOP_N_OPTIONS = [10, 15, 20, 35]

function SegControl({ label, options, value, onChange, format = (v) => v }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="seg-btn"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [topN, setTopN] = useState(15)
  const [selectedCategory, setSelectedCategory] = useState(null)

  const { data, error, loading, reload } = useApiAll(
    {
      stats: () => api.summaryStats(),
      categories: () => api.categoryDistribution(),
      events: () => api.volumeByEvent(),
      genres: () => api.volumeByGenre(),
      mix: () => api.eventCategoryMix(),
      genreEvent: () => api.genreEventMatrix(),
    },
    [],
  )

  // The co-occurrence matrix is the largest payload on this page and is only
  // needed further down, so it loads separately instead of blocking the KPIs.
  const cooccurrence = useApi(() => api.cooccurrence(), [])

  const topCategories = useMemo(
    () => (data?.categories ?? []).slice(0, topN),
    [data, topN],
  )

  // The co-occurrence payload is in dataset order; the heatmap is far more
  // informative when it shows the most frequent labels instead of the first N.
  const cooccurrenceView = useMemo(() => {
    if (!cooccurrence.data) return null
    const { categories, counts, totals } = cooccurrence.data
    const order = totals
      .map((total, index) => ({ total, index }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 14)
      .map((entry) => entry.index)
    return {
      categories: order.map((index) => categories[index]),
      values: order.map((row) => order.map((column) => counts[row][column])),
    }
  }, [cooccurrence.data])

  const drilldown = useMemo(() => {
    if (!selectedCategory || !data) return null
    const row = data.categories.find((entry) => entry.category === selectedCategory)
    const pairs = (cooccurrence.data?.top_pairs ?? [])
      .filter((pair) => pair.cat_a === selectedCategory || pair.cat_b === selectedCategory)
      .slice(0, 6)
      .map((pair) => ({
        partner: pair.cat_a === selectedCategory ? pair.cat_b : pair.cat_a,
        count: pair.count,
        jaccard: pair.jaccard,
      }))
    const mixRows = data.mix.rows
      .filter((entry) => entry[selectedCategory] !== undefined)
      .map((entry) => ({ event: entry.event, share: entry[selectedCategory] }))
      .sort((a, b) => b.share - a.share)
    return { row, pairs, mixRows }
  }, [selectedCategory, data, cooccurrence.data])

  if (loading) {
    return (
      <div className="stack">
        <PageHeader title="Analytics Dashboard" description="Loading corpus analytics" />
        <div className="grid grid-kpi">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonCard key={index} height={40} lines={1} />
          ))}
        </div>
        <SkeletonCard height={320} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="stack">
        <PageHeader title="Analytics Dashboard" />
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  const { stats, events, genres, mix, genreEvent } = data
  const biggestEvent = [...events].sort((a, b) => b.count - a.count)[0]
  const urgentPct = formatPercent(stats.urgent_share)

  return (
    <div className="stack">
      <PageHeader
        title="Analytics Dashboard"
        description={`${formatNumber(stats.total_messages)} labelled disaster messages from four events: Haiti earthquake, Chile earthquake, Pakistan floods and Superstorm Sandy. ${urgentPct} carry a life-threatening need.`}
        actions={
          selectedCategory && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSelectedCategory(null)}
            >
              <X size={13} aria-hidden="true" />
              Clear filter: {humanCategory(selectedCategory)}
            </button>
          )
        }
      />

      <div className="grid grid-kpi">
        <KpiCard
          title="Total messages"
          value={formatNumber(stats.total_messages)}
          sub={`${formatNumber(stats.analysed_messages)} analysed after noise removal`}
          icon={<MessageSquare size={16} aria-hidden="true" />}
          accent="var(--series-1)"
        />
        <KpiCard
          title="Urgent messages"
          value={urgentPct}
          sub={`${formatNumber(stats.urgent_messages)} with a severity-weighted need`}
          icon={<AlertTriangle size={16} aria-hidden="true" />}
          accent="var(--severity-high)"
          sparkline={stats.sparklines.urgent_share}
          delta={stats.deltas.urgent_share}
          footer={<span>across corpus order</span>}
        />
        <KpiCard
          title="Most requested need"
          value={titleCase(stats.most_requested_need ?? '—')}
          sub={`${formatNumber(stats.most_requested_need_count)} messages`}
          icon={<PackageSearch size={16} aria-hidden="true" />}
          accent="var(--series-3)"
        />
        <KpiCard
          title="Irrelevant messages"
          value={formatPercent(stats.irrelevant_share, 2)}
          sub={`${formatNumber(stats.irrelevant_messages)} rows labelled related=2`}
          icon={<Filter size={16} aria-hidden="true" />}
          accent="var(--series-7)"
        />
        <KpiCard
          title="Categories per message"
          value={stats.avg_categories_per_message.toFixed(2)}
          sub="Average across labelled messages"
          icon={<Layers size={16} aria-hidden="true" />}
          accent="var(--series-4)"
          sparkline={stats.sparklines.avg_categories}
          delta={stats.deltas.avg_categories}
        />
      </div>

      <ChartCard
        title="Category distribution"
        insight={`${titleCase(stats.top_categories[0])} leads, and every bar in orange is a severity-weighted need. Select a bar to filter the dashboard.`}
        controls={
          <SegControl
            label="Number of categories"
            options={TOP_N_OPTIONS}
            value={topN}
            onChange={setTopN}
            format={(value) => `Top ${value}`}
          />
        }
        csvRows={topCategories}
        csvName="category-distribution.csv"
        tableColumns={[
          { key: 'category', label: 'Category', render: (row) => humanCategory(row.category) },
          { key: 'count', label: 'Messages' },
          { key: 'share', label: 'Share', render: (row) => formatPercent(row.share) },
        ]}
        tableRows={topCategories}
      >
        <CategoryBarChart
          data={topCategories}
          onSelect={(category) =>
            setSelectedCategory((current) => (current === category ? null : category))
          }
          selected={selectedCategory}
          height={Math.max(240, topN * 22)}
        />
      </ChartCard>

      {drilldown && (
        <section className="card fade-in" aria-label={`Details for ${selectedCategory}`}>
          <div className="card-header">
            <div>
              <h2 className="card-title">Drill-down: {titleCase(selectedCategory)}</h2>
              <p className="card-insight">
                {formatNumber(drilldown.row.count)} messages ({formatPercent(drilldown.row.share)}
                ){drilldown.pairs[0]
                  ? `, most often reported alongside ${humanCategory(drilldown.pairs[0].partner)}`
                  : ''}
                .
              </p>
            </div>
          </div>
          <div className="grid grid-2">
            <div>
              <h3 className="field-label">Appears together with</h3>
              {drilldown.pairs.length === 0 && (
                <p className="text-sm muted">Loading co-occurrence data.</p>
              )}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
                {drilldown.pairs.map((pair) => (
                  <li key={pair.partner} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="text-sm">{titleCase(pair.partner)}</span>
                    <span className="text-xs muted mono">
                      {formatNumber(pair.count)} · J={pair.jaccard.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="field-label">Share of each event&apos;s messages</h3>
              <SimpleBarChart
                data={drilldown.mixRows}
                xKey="event"
                yKey="share"
                height={200}
                color="var(--accent)"
              />
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-2">
        <ChartCard
          title="Volume by disaster event"
          insight={`${biggestEvent.event} dominates the corpus with ${formatNumber(biggestEvent.count)} messages; events are inferred, not labelled in the source data.`}
          csvRows={events}
          csvName="volume-by-event.csv"
          tableColumns={[
            { key: 'event', label: 'Event' },
            { key: 'count', label: 'Messages' },
            { key: 'keyword_inferred', label: 'By keyword' },
            { key: 'range_inferred', label: 'By id range' },
          ]}
          tableRows={events}
        >
          <SimpleBarChart
            data={events}
            xKey="event"
            height={260}
            colorBy={(row, index) => `var(--series-${(index % 7) + 1})`}
          />
        </ChartCard>

        <ChartCard
          title="Volume by source"
          insight={`${titleCase(genres[0].genre)} messages make up ${formatPercent(genres[0].share)} of the corpus.`}
          csvRows={genres}
          csvName="volume-by-genre.csv"
          tableColumns={[
            { key: 'genre', label: 'Source', render: (row) => titleCase(row.genre) },
            { key: 'count', label: 'Messages' },
            { key: 'share', label: 'Share', render: (row) => formatPercent(row.share) },
          ]}
          tableRows={genres}
        >
          <SimpleBarChart
            data={genres.map((row) => ({ ...row, genre: titleCase(row.genre) }))}
            xKey="genre"
            height={260}
            colorBy={(_, index) => `var(--series-${index + 1})`}
          />
        </ChartCard>
      </div>

      <ChartCard
        title="What each disaster needed most"
        insight="Shares, not counts, so a small event is comparable with a large one."
        csvRows={mix.rows}
        csvName="event-category-mix.csv"
        tableColumns={[
          { key: 'event', label: 'Event' },
          { key: 'total', label: 'Messages' },
          {
            key: 'top_need',
            label: 'Top need',
            render: (row) => titleCase(row.top_need ?? '—'),
          },
        ]}
        tableRows={mix.rows}
      >
        <Deferred height={320}>
          <GroupedBarChart rows={mix.rows} categories={mix.categories.slice(0, 6)} />
        </Deferred>
      </ChartCard>

      <div className="grid grid-2">
        <ChartCard
          title="Source by event"
          insight="Direct SMS dominates the Haiti response; social media carries the Chile and Sandy traffic."
          csvRows={genreEvent.genres.map((genre, index) =>
            Object.fromEntries([
              ['genre', genre],
              ...genreEvent.events.map((event, column) => [
                event,
                genreEvent.values[index][column],
              ]),
            ]),
          )}
          csvName="genre-event-matrix.csv"
        >
          <Deferred height={220}>
          <Heatmap
            rows={genreEvent.genres}
            columns={genreEvent.events}
            values={genreEvent.values}
            rowLabel="source"
            columnLabel="event"
            labelWidth={70}
            cellSize={34}
          />
          </Deferred>
        </ChartCard>

        <ChartCard
          title="Category co-occurrence"
          loading={cooccurrence.loading}
          error={cooccurrence.error}
          onRetry={cooccurrence.reload}
          insight={
            cooccurrence.data
              ? `${titleCase(cooccurrence.data.top_pairs[0].cat_a)} and ${humanCategory(cooccurrence.data.top_pairs[0].cat_b)} appear together most often (${formatNumber(cooccurrence.data.top_pairs[0].count)} messages).`
              : ''
          }
          csvRows={cooccurrence.data?.top_pairs ?? []}
          csvName="cooccurrence-pairs.csv"
          tableColumns={[
            { key: 'cat_a', label: 'Category A', render: (row) => humanCategory(row.cat_a) },
            { key: 'cat_b', label: 'Category B', render: (row) => humanCategory(row.cat_b) },
            { key: 'count', label: 'Together' },
            { key: 'jaccard', label: 'Jaccard' },
          ]}
          tableRows={(cooccurrence.data?.top_pairs ?? []).slice(0, 20)}
          empty={!cooccurrenceView}
          emptyMessage="Co-occurrence data is still loading"
        >
          <Deferred height={420}>
          <Heatmap
            rows={cooccurrenceView?.categories ?? []}
            columns={cooccurrenceView?.categories ?? []}
            values={cooccurrenceView?.values ?? []}
            rowLabel="category"
            columnLabel="category"
            cellSize={24}
          />
          </Deferred>
        </ChartCard>
      </div>
    </div>
  )
}
