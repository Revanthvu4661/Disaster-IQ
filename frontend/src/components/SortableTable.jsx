import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { TableSearch, noResultsText, plainText, useTableSearch } from './TableSearch'

/**
 * A visible data table whose headers sort it. `columns`:
 * [{ key, label, render?, sortValue?, numeric?, defaultDir? }]. Sorting is
 * announced through `aria-sort` on the active header.
 *
 * `preview` (a row count) shortens a long table: only the first `preview`
 * rows of the *sorted* table are shown, with a "Show all" button under it.
 * Sorting always uses every row, so "top 25 by population" is the true top
 * 25. `noun` names the rows in the button ("districts").
 *
 * `searchable` (default true) adds a search box above the table that filters
 * rows by case-insensitive substring. It matches the columns in `searchKeys`,
 * or by default every column not marked `numeric`, using each cell's raw
 * value (or its `sortValue` when the raw field is not plain text). Pass
 * `searchable={false}` for short tables where a search box would be noise.
 */
export function SortableTable({
  columns,
  rows,
  caption,
  initialSort,
  rowKey = (row, index) => row.id ?? row.key ?? index,
  rowStyle,
  maxHeight,
  preview,
  noun = 'rows',
  searchable = true,
  searchKeys,
}) {
  const [sort, setSort] = useState(initialSort ?? null)
  const searchColumns = searchKeys ? columns.filter((c) => searchKeys.includes(c.key)) : columns.filter((c) => !c.numeric)
  const search = useTableSearch(rows, (row) =>
    searchColumns.map((c) => plainText(row[c.key]) || plainText(c.sortValue?.(row))).join(' '),
  )
  const visibleRows = searchable ? search.filtered : rows
  const [expanded, setExpanded] = useState(false)
  const wrapRef = useRef(null)
  const scrollOnCollapse = useRef(false)

  const sorted = useMemo(() => {
    if (!sort) return visibleRows
    const column = columns.find((c) => c.key === sort.key)
    const value = (row) => (column?.sortValue ? column.sortValue(row) : row[sort.key])
    const out = [...visibleRows].sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (av === bv) return 0
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      return av < bv ? -1 : 1
    })
    return sort.dir === 'desc' ? out.reverse() : out
  }, [visibleRows, columns, sort])

  const limited = Boolean(preview) && visibleRows.length > preview
  const shown = limited && !expanded ? sorted.slice(0, preview) : sorted

  const toggleExpanded = () => {
    scrollOnCollapse.current = expanded
    setExpanded((value) => !value)
  }

  // Collapsing from the bottom of a long list would leave the reader far below
  // the table, so bring its top back into view once the shorter table has
  // rendered (scrolling earlier is cancelled by the height change).
  useEffect(() => {
    if (expanded || !scrollOnCollapse.current) return
    scrollOnCollapse.current = false
    const element = wrapRef.current
    if (!element?.scrollIntoView) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [expanded])

  const toggle = (column) =>
    setSort((current) =>
      current?.key === column.key
        ? { key: column.key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, dir: column.defaultDir ?? (column.numeric ? 'desc' : 'asc') },
    )

  const table = (
    <div className="table-wrap" ref={wrapRef} style={maxHeight ? { maxHeight } : undefined}>
      <table className="data sortable">
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key
              const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={column.numeric ? 'num' : undefined}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="th-sort" onClick={() => toggle(column)}>
                    {column.label}
                    <Icon size={12} aria-hidden="true" className={active ? '' : 'muted'} />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {searchable && search.active && shown.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {noResultsText(search.needle)}
              </td>
            </tr>
          )}
          {shown.map((row, index) => (
            <tr key={rowKey(row, index)} style={rowStyle?.(row)}>
              {columns.map((column, columnIndex) => {
                const content = column.render ? column.render(row) : row[column.key]
                return columnIndex === 0 ? (
                  <th key={column.key} scope="row" className={column.numeric ? 'num' : undefined}>
                    {content}
                  </th>
                ) : (
                  <td key={column.key} className={column.numeric ? 'num' : undefined}>
                    {content}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const searchBox = searchable && (
    <TableSearch search={search} total={rows.length} label={`Search ${caption ?? 'table'}`} noun={noun} />
  )

  if (!limited) {
    return searchBox ? (
      <>
        {searchBox}
        {table}
      </>
    ) : (
      table
    )
  }
  return (
    <>
      {searchBox}
      {table}
      <div className="table-more">
        <span className="text-sm muted" role="status">
          Showing {shown.length.toLocaleString()} of {visibleRows.length.toLocaleString()} {noun}
        </span>
        <button type="button" className="btn" aria-expanded={expanded} onClick={toggleExpanded}>
          {expanded ? `Show first ${preview} only` : `Show all ${visibleRows.length.toLocaleString()} ${noun}`}
        </button>
      </div>
    </>
  )
}

export default SortableTable
