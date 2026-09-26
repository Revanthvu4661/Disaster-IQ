import { useId, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Table2 } from 'lucide-react'
import { downloadChartPng, downloadCsv } from '../lib/download'
import { ErrorState, SkeletonCard } from './ui'
import { TableSearch, noResultsText, plainText, useTableSearch } from './TableSearch'

/**
 * Card wrapper for every chart.
 *
 * Gives each chart the things the design brief requires: an insight headline,
 * loading / empty / error states, keyboard-accessible exports, and an
 * accessible data-table fallback for screen readers.
 *
 * Layout: headline and insight on the left, the provenance `badge` (a
 * <SourceBadge>) top-right, optional `controls` above the chart, and the
 * export/data actions in a quiet footer so they do not compete with the chart.
 * `headingLevel` sets the title's heading level (3 inside a page section).
 */
export function ChartCard({
  title,
  insight,
  badge,
  className = '',
  children,
  controls,
  footnote,
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
  headingLevel = 2,
}) {
  const bodyRef = useRef(null)
  const [tableOpen, setTableOpen] = useState(false)
  // Search the data table while it is open; closed, the screen-reader copy keeps every row.
  const search = useTableSearch(tableRows ?? [], (row) => (tableColumns ?? []).map((c) => plainText(row[c.key])).join(' '))
  const dataRows = tableOpen ? search.filtered : tableRows
  const titleId = useId()
  const Heading = `h${headingLevel}`
  const tableId = useId()

  if (loading) return <SkeletonCard />
  if (error) return <ErrorState message={error} onRetry={onRetry} />

  const exportPng = () => downloadChartPng(bodyRef.current, csvName.replace(/\.csv$/, '.png'))
  const hasTable = tableRows?.length > 0 && tableColumns?.length > 0
  const hasCsv = csvRows?.length > 0

  return (
    <section
      className={`card fade-in ${className}`}
      aria-labelledby={titleId}
    >
      <div className="card-header">
        <div className="card-heading">
          <Heading className="card-title" id={titleId}>
            {title}
          </Heading>
          {insight && <p className="card-insight">{insight}</p>}
        </div>
        {badge && <div className="card-badge">{badge}</div>}
      </div>

      {controls && (
        <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
          {controls}
        </div>
      )}

      <div ref={bodyRef} className="chart-frame">
        {empty ? <div className="empty-state">{emptyMessage}</div> : children}
      </div>

      {(footnote || hasCsv || hasTable) && (
        <div className="card-footer">
          {footnote ? <p className="card-footnote">{footnote}</p> : <span />}
          <div className="row" style={{ gap: 4 }}>
            {hasTable && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setTableOpen((open) => !open)}
                aria-expanded={tableOpen}
                aria-controls={tableId}
                aria-label={`${tableOpen ? 'Hide' : 'Show'} data table for ${title}`}
              >
                <Table2 size={13} aria-hidden="true" />
                Data
              </button>
            )}
            {hasCsv && (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => downloadCsv(csvRows, csvName)}
                  aria-label={`Download ${title} as CSV`}
                >
                  <Download size={13} aria-hidden="true" />
                  CSV
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={exportPng}
                  aria-label={`Download ${title} as PNG`}
                >
                  <ImageIcon size={13} aria-hidden="true" />
                  PNG
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {hasTable && tableOpen && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <TableSearch search={search} total={tableRows.length} label={`Search ${tableCaption ?? title}`} />
        </div>
      )}
      {hasTable && (
        <div
          id={tableId}
          className={tableOpen ? 'table-wrap' : 'visually-hidden'}
          style={tableOpen ? { maxHeight: 280 } : undefined}
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
              {tableOpen && search.active && dataRows.length === 0 && (
                <tr>
                  <td colSpan={tableColumns.length} className="table-empty">
                    {noResultsText(search.needle)}
                  </td>
                </tr>
              )}
              {dataRows.map((row, index) => (
                <tr key={row.id ?? row.key ?? index}>
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
