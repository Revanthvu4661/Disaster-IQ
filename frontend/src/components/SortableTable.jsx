import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

/**
 * A visible data table whose headers sort it. `columns`:
 * [{ key, label, render?, sortValue?, numeric?, defaultDir? }]. Sorting is
 * announced through `aria-sort` on the active header.
 */
export function SortableTable({
  columns,
  rows,
  caption,
  initialSort,
  rowKey = (row, index) => row.id ?? row.key ?? index,
  rowStyle,
  maxHeight,
}) {
  const [sort, setSort] = useState(initialSort ?? null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    const value = (row) => (column?.sortValue ? column.sortValue(row) : row[sort.key])
    const out = [...rows].sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (av === bv) return 0
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      return av < bv ? -1 : 1
    })
    return sort.dir === 'desc' ? out.reverse() : out
  }, [rows, columns, sort])

  const toggle = (column) =>
    setSort((current) =>
      current?.key === column.key
        ? { key: column.key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, dir: column.defaultDir ?? (column.numeric ? 'desc' : 'asc') },
    )

  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
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
          {sorted.map((row, index) => (
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
}

export default SortableTable
