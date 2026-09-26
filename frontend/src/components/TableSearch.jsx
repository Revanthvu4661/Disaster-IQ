import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

/** Waits `delay` ms after the last keystroke, so a large table is not filtered on every key. */
function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/**
 * Client-side search over a list of rows: case-insensitive substring match
 * against the text `textOf(row)` returns. Returns the input's value and
 * setter, the filtered rows, and whether a filter is active.
 */
export function useTableSearch(rows, textOf, delay = 150) {
  const [query, setQuery] = useState('')
  const needle = useDeferredValue(useDebounced(query, delay)).trim().toLowerCase()
  const filtered = useMemo(
    () => (needle ? rows.filter((row) => textOf(row).toLowerCase().includes(needle)) : rows),
    // textOf is usually defined inline by the caller; rows and the query decide the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, needle],
  )
  return { query, setQuery, filtered, active: needle.length > 0, needle }
}

/** Plain text of a cell value for matching: strings and numbers only. */
export const plainText = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')

/**
 * The search input above a table or list, with a visually hidden label and a
 * "12 of 87 rows" count (announced politely) while a filter is active.
 */
export function TableSearch({ search, total, label, noun = 'rows' }) {
  const id = useId()
  return (
    <div className="table-search">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <span className="table-search-box">
        <Search size={14} aria-hidden="true" />
        <input
          id={id}
          type="search"
          className="input table-search-input"
          placeholder={label}
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          autoComplete="off"
        />
      </span>
      <span className="table-search-count text-xs muted" aria-live="polite">
        {search.active ? `${search.filtered.length.toLocaleString()} of ${total.toLocaleString()} ${noun}` : ''}
      </span>
    </div>
  )
}

/** Shown in place of the rows when the filter matches nothing. */
export function noResultsText(needle) {
  return `No results for “${needle}”.`
}

export default TableSearch
