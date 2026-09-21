import { useId, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Table2 } from 'lucide-react'
import { downloadChartPng, downloadCsv } from '../lib/download'
import { ErrorState, SkeletonCard } from './ui'

/**
 * Card wrapper for every chart.
 *
 * Gives each chart the things the design brief requires: an insight headline,
 * loading / empty / error states, a keyboard-accessible export menu, and an
 * accessible data-table fallback for screen readers.
 */
export function ChartCard({
  title,
  insight,
  children,
  controls,
  loading = false,
  error = null,
  onRetry,
  empty = false,
  emptyMessage = 'No data for this selection',
  csvRows,
  csvName = 'disasteriq.csv',
  tableCaption,
  tableColumns,
  tableRows,
}) {
  const bodyRef = useRef(null)
  const [tableOpen, setTableOpen] = useState(false)
  const titleId = useId()

  if (loading) return <SkeletonCard />
  if (error) return <ErrorState message={error} onRetry={onRetry} />

  const exportPng = () => downloadChartPng(bodyRef.current, csvName.replace(/\.csv$/, '.png'))

  return (
    <section className="card fade-in" aria-labelledby={titleId}>
      <div className="card-header">
        <div style={{ minWidth: 200 }}>
          <h2 className="card-title" id={titleId}>
            {title}
          </h2>
          {insight && <p className="card-insight">{insight}</p>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {controls}
          {csvRows?.length > 0 && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => downloadCsv(csvRows, csvName)}
                aria-label={`Download ${title} as CSV`}
              >
                <Download size={13} aria-hidden="true" />
                CSV
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={exportPng}
                aria-label={`Download ${title} as PNG`}
              >
                <ImageIcon size={13} aria-hidden="true" />
                PNG
              </button>
            </>
          )}
          {tableRows?.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setTableOpen((open) => !open)}
              aria-expanded={tableOpen}
              aria-label={`${tableOpen ? 'Hide' : 'Show'} data table for ${title}`}
            >
              <Table2 size={13} aria-hidden="true" />
              Data
            </button>
          )}
        </div>
      </div>

      <div ref={bodyRef} className="chart-frame">
        {empty ? (
          <div className="empty-state">{emptyMessage}</div>
        ) : (
          children
        )}
      </div>

      {tableRows?.length > 0 && (
        <div
          className={tableOpen ? 'table-wrap' : 'visually-hidden'}
          style={tableOpen ? { marginTop: 'var(--space-4)', maxHeight: 280 } : undefined}
        >
          <table className="data">
            <caption className="visually-hidden">{tableCaption ?? title}</caption>
            <thead>
              <tr>
                {tableColumns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, index) => (
                <tr key={row.id ?? index}>
                  {tableColumns.map((column) => (
                    <td key={column.key}>
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default ChartCard
