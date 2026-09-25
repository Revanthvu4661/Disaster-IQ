import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { disasterVar, getDisasterType } from '../../config/disasterTypes'
import { formatRelative } from '../../lib/format'

const COLUMNS = [
  { key: 'type', label: 'Type' },
  { key: 'place', label: 'Location' },
  { key: 'severity', label: 'Severity' },
  { key: 'date', label: 'Updated' },
]

const TYPE_ORDER = { earthquake: 0, flood: 1, cyclone: 2 }

const sortValue = (event, key) => {
  switch (key) {
    case 'type':
      return TYPE_ORDER[event.type] ?? 9
    case 'place':
      return (event.location ?? event.title ?? '').toLowerCase()
    case 'severity':
      // Alert level first, then the magnitude / wind / exposure value.
      return (event.severity?.rank ?? 0) * 1e6 + (event.magnitude ?? event.severity?.value ?? 0)
    default:
      return event.updated ?? event.date ?? ''
  }
}

/** "Austria, Belgium, Belarus, …" -> "Austria, Belgium +23 more"; the detail card shows all. */
export const shortPlace = (event) => {
  const text = event.location ?? event.title ?? ''
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean)
  // Only multi-country lists are shortened; "35 km NNE of X, Indonesia" is kept.
  if (parts.length <= 3) return text
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`
}

/** Short severity text for a table cell; the detail card shows every source. */
export const severityShort = (event) => {
  const parts = []
  if (event.magnitude != null && event.type === 'earthquake') parts.push(`M${event.magnitude.toFixed(1)}`)
  if (event.alert) parts.push(`${event.alert[0].toUpperCase()}${event.alert.slice(1)} alert`)
  if (!parts.length && event.severity?.label) parts.push(event.severity.label.split(' | ')[0])
  return parts.join(' · ') || '—'
}

/**
 * Sortable list of live events. Rows are buttons so the table is the keyboard
 * route to every marker on the map.
 */
export function LiveEventTable({
  events,
  selectedId,
  onSelect,
  caption,
  maxHeight = 420,
  showType = true,
}) {
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })

  const rows = useMemo(() => {
    const sorted = [...events].sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      if (av < bv) return -1
      if (av > bv) return 1
      return 0
    })
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [events, sort])

  const toggle = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'place' || key === 'type' ? 'asc' : 'desc' },
    )

  const columns = showType ? COLUMNS : COLUMNS.filter((column) => column.key !== 'type')

  return (
    <div className="live-table-host stack" style={{ gap: 'var(--space-2)' }}>
      {/* When the list is narrow the severity and date columns fold away, so sorting moves here. */}
      <label className="live-sort">
        <span className="text-xs muted">Sort by</span>
        <select
          className="select"
          value={`${sort.key}:${sort.dir}`}
          onChange={(event) => {
            const [key, dir] = event.target.value.split(':')
            setSort({ key, dir })
          }}
        >
          <option value="date:desc">Most recent</option>
          <option value="severity:desc">Highest severity</option>
          {showType && <option value="type:asc">Disaster type</option>}
          <option value="place:asc">Location A–Z</option>
        </select>
      </label>
      <div className="table-wrap" style={{ maxHeight }}>
        <table className="data live-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort.key === column.key
                const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.key === 'severity' || column.key === 'date' ? 'col-wide' : undefined}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" className="th-sort" onClick={() => toggle(column.key)}>
                      {column.label}
                      <Icon size={12} aria-hidden="true" />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => {
              const type = getDisasterType(event.type)
              const Icon = type?.icon
              const selected = event.id === selectedId
              return (
                <tr key={event.id} className={selected ? 'row-selected' : undefined}>
                  {showType && (
                    <td>
                      <span className="type-cell" style={{ color: disasterVar(event.type) }}>
                        {Icon && <Icon size={14} aria-hidden="true" />}
                        <span>{type?.shortLabel}</span>
                      </span>
                    </td>
                  )}
                  <td className="wrap">
                    <button
                      type="button"
                      className="row-button"
                      onClick={() => onSelect?.(event)}
                      aria-pressed={selected}
                    >
                      {shortPlace(event)}
                    </button>
                    {event.sources.length > 1 && (
                      <span className="chip chip-xs">{event.sources.length} sources</span>
                    )}
                    <span className="live-meta">
                      {severityShort(event)} · {formatRelative(event.updated ?? event.date)}
                    </span>
                  </td>
                  <td className="col-wide">{severityShort(event)}</td>
                  <td className="col-wide" title={event.updated ?? event.date}>
                    {formatRelative(event.updated ?? event.date)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default LiveEventTable
