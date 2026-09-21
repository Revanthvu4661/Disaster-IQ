import { useMemo, useState } from 'react'
import { ArrowDownUp } from 'lucide-react'
import { api } from '../api/client'
import { useApi, useApiAll } from '../hooks/useApi'
import ChartCard from '../components/ChartCard'
import { SimpleLineChart } from '../components/charts/Charts'
import { ErrorState, PageHeader, Skeleton, SkeletonCard } from '../components/ui'
import { formatDateTime, formatNumber, titleCase } from '../lib/format'

const BASELINE_MACRO_F1 = 0.405
const COLUMNS = [
  { key: 'category', label: 'Label', numeric: false },
  { key: 'f1', label: 'F1', numeric: true },
  { key: 'precision', label: 'Precision', numeric: true },
  { key: 'recall', label: 'Recall', numeric: true },
  { key: 'pr_auc', label: 'PR-AUC', numeric: true },
  { key: 'threshold', label: 'Threshold', numeric: true },
  { key: 'support', label: 'Support', numeric: true },
]

function LabelCurves({ category }) {
  const { data, error, loading } = useApi(() => api.modelCurves(category), [category])
  if (loading) return <Skeleton height={240} />
  if (error) return <ErrorState message={error} compact />
  if (!data?.available) return <p className="text-sm muted">No stored scores for this label.</p>

  const prRows = data.pr_curve.recall.map((recall, index) => ({
    recall,
    precision: data.pr_curve.precision[index],
  }))

  return (
    <div className="grid grid-2">
      <div>
        <h3 className="field-label">Precision-recall (PR-AUC {data.pr_curve.pr_auc})</h3>
        <SimpleLineChart
          data={prRows}
          xKey="recall"
          lines={[{ key: 'precision', label: 'precision', color: 'var(--series-1)' }]}
          xLabel="recall"
          yLabel="precision"
          height={230}
        />
      </div>
      <div>
        <h3 className="field-label">
          F1 by threshold (tuned value {data.threshold.toFixed(2)})
        </h3>
        <SimpleLineChart
          data={data.f1_by_threshold}
          xKey="threshold"
          lines={[{ key: 'f1', label: 'F1', color: 'var(--series-2)' }]}
          xLabel="threshold"
          yLabel="F1"
          height={230}
        />
      </div>
    </div>
  )
}

export default function ModelPage() {
  const { data, error, loading, reload } = useApiAll(
    { info: () => api.modelInfo(), performance: () => api.modelPerformance() },
    [],
  )
  const [sort, setSort] = useState({ key: 'f1', direction: 'desc' })
  const [selected, setSelected] = useState('water')

  const rows = useMemo(() => {
    const list = [...(data?.performance.per_label ?? [])]
    list.sort((a, b) => {
      const left = a[sort.key]
      const right = b[sort.key]
      const compare =
        typeof left === 'string' ? left.localeCompare(right) : left - right
      return sort.direction === 'asc' ? compare : -compare
    })
    return list
  }, [data, sort])

  if (loading) {
    return (
      <div className="stack">
        <PageHeader title="Model" description="Loading model metrics" />
        <SkeletonCard height={220} />
      </div>
    )
  }
  if (error) {
    return (
      <div className="stack">
        <PageHeader title="Model" />
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  const { info, performance } = data
  const improvement = ((performance.macro_f1 - BASELINE_MACRO_F1) / BASELINE_MACRO_F1) * 100
  const weakest = [...performance.per_label].sort((a, b) => a.f1 - b.f1).slice(0, 5)

  return (
    <div className="stack">
      <PageHeader
        title="Model performance"
        description={`Serving ${info.model_name}. Every number here comes from the untouched test split of ${formatNumber(performance.split.test)} messages.`}
      />

      <section className="card" aria-label="Headline metrics">
        <div className="grid grid-kpi">
          {[
            ['Macro F1', performance.macro_f1.toFixed(4), `${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}% vs the 0.405 baseline`],
            ['Micro F1', performance.micro_f1.toFixed(4), 'Weighted by label frequency'],
            ['Macro PR-AUC', performance.macro_pr_auc.toFixed(4), 'Threshold independent'],
            ['Exact match', performance.exact_match.toFixed(4), 'All 35 labels correct'],
            ['Trained', formatDateTime(info.trained_at), `scikit-learn ${info.sklearn_version}`],
          ].map(([label, value, hint]) => (
            <div key={label}>
              <p className="field-label" style={{ marginBottom: 2 }}>
                {label}
              </p>
              <p style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>{value}</p>
              <p className="text-xs muted">{hint}</p>
            </div>
          ))}
        </div>
        <p className="text-sm secondary" style={{ marginTop: 'var(--space-3)' }}>
          With a fixed 0.5 cut-off this same model scores{' '}
          {performance.metrics_at_default_threshold.macro_f1?.toFixed(4)} macro F1, so
          per-label threshold tuning is doing real work.
        </p>
      </section>

      <ChartCard
        title="Candidate comparison"
        insight={`${performance.comparison[0].name} won on test macro F1; every candidate was tuned and scored the same way.`}
        csvRows={performance.comparison}
        csvName="model-comparison.csv"
      >
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">Benchmark of candidate models</caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Macro F1</th>
                <th scope="col">Micro F1</th>
                <th scope="col">PR-AUC</th>
                <th scope="col">Macro F1 at 0.5</th>
                <th scope="col">Fit (s)</th>
                <th scope="col">ms / message</th>
              </tr>
            </thead>
            <tbody>
              {performance.comparison.map((row) => (
                <tr key={row.name}>
                  <td>
                    {row.name}
                    {row.name === performance.model_name && (
                      <span className="chip" style={{ marginLeft: 6 }}>
                        serving
                      </span>
                    )}
                  </td>
                  <td className="mono">{row.test_macro_f1.toFixed(4)}</td>
                  <td className="mono">{row.test_micro_f1.toFixed(4)}</td>
                  <td className="mono">{row.test_macro_pr_auc.toFixed(4)}</td>
                  <td className="mono">{row.macro_f1_at_0_5.toFixed(4)}</td>
                  <td className="mono">{row.fit_seconds}</td>
                  <td className="mono">{row.predict_ms_per_message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard
        title="Per-label metrics"
        insight={`Weakest labels: ${weakest.map((row) => titleCase(row.category)).join(', ')}. They have little support, so treat their scores as indicative.`}
        csvRows={rows}
        csvName="per-label-metrics.csv"
      >
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="data">
            <caption className="visually-hidden">Per-label test metrics</caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="sortable"
                    aria-sort={
                      sort.key === column.key
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ border: 0, background: 'transparent', padding: 0 }}
                      onClick={() =>
                        setSort((current) => ({
                          key: column.key,
                          direction:
                            current.key === column.key && current.direction === 'desc'
                              ? 'asc'
                              : 'desc',
                        }))
                      }
                    >
                      {column.label}
                      <ArrowDownUp size={11} aria-hidden="true" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.category}
                  onClick={() => setSelected(row.category)}
                  style={{
                    cursor: 'pointer',
                    background: selected === row.category ? 'var(--surface-hover)' : undefined,
                  }}
                >
                  <td>{titleCase(row.category)}</td>
                  <td className="mono">{row.f1.toFixed(3)}</td>
                  <td className="mono">{row.precision.toFixed(3)}</td>
                  <td className="mono">{row.recall.toFixed(3)}</td>
                  <td className="mono">{row.pr_auc.toFixed(3)}</td>
                  <td className="mono">{row.threshold.toFixed(2)}</td>
                  <td className="mono">{formatNumber(row.support)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <section className="card" aria-label="Curves for the selected label">
        <div className="card-header">
          <div>
            <h2 className="card-title">Threshold view: {titleCase(selected)}</h2>
            <p className="card-insight">
              Select any row above to inspect that label&apos;s trade-off.
            </p>
          </div>
        </div>
        <LabelCurves category={selected} />
      </section>
    </div>
  )
}
