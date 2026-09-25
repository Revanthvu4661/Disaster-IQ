import { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import {
  DEFAULT_SEVERITY_RULE,
  MAP_TYPES,
  SEVERITY_FILTERS,
  SORTS,
  UNRATED,
  eventHeadline,
  eventSubline,
  mapType,
  metaLine,
  severityMeta,
} from '../../lib/liveEvents'
import { formatNumber } from '../../lib/format'
import { useNow } from '../../hooks/useNow'
import { Skeleton } from '../ui'
import { SeverityPill, TypeIcon } from './parts'

const severityLabel = (id) => (id === UNRATED ? 'Not rated' : severityMeta(id)?.label)

/** Type and severity filters, opened from the funnel button. */
function FilterPanel({ id, types, onToggleType, severities, onToggleSeverity, rule }) {
  return (
    <div className="wm-filter" id={id} role="group" aria-label="Filter events">
      <fieldset>
        <legend>Type</legend>
        {MAP_TYPES.map((type) => (
          <label key={type.id} className="wm-check">
            <input type="checkbox" checked={types.has(type.id)} onChange={() => onToggleType(type.id)} />
            <TypeIcon type={type.id} size={18} decorative />
            {type.plural}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Severity</legend>
        {SEVERITY_FILTERS.map((level) => (
          <label key={level} className="wm-check">
            <input type="checkbox" checked={severities.has(level)} onChange={() => onToggleSeverity(level)} />
            <span className={`wm-pill wm-pill-${level}`}>{severityLabel(level)}</span>
          </label>
        ))}
      </fieldset>
      <p className="wm-filter-rule">
        <strong>How severity is set.</strong> {rule}
      </p>
    </div>
  )
}

/**
 * The "Live Events" side panel: live count of events inside the map view,
 * filters, sort, and one card per event. Every card is a button (the keyboard
 * path to each marker); arrow keys, Home and End move between cards.
 */
export function LiveEventsPanel({
  events,
  loading = false,
  failed = false,
  filteredOut = false,
  sort,
  onSortChange,
  types,
  onToggleType,
  severities,
  onToggleSeverity,
  selectedId,
  onSelect,
  onHover,
  rule = DEFAULT_SEVERITY_RULE,
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const listRef = useRef(null)
  const id = useId()
  const now = useNow()
  const filtersActive = types.size < MAP_TYPES.length || severities.size < SEVERITY_FILTERS.length

  // Keep the selected card in view when it is chosen on the map.
  useEffect(() => {
    if (!selectedId) return
    const rows = listRef.current?.querySelectorAll('[data-event-id]') ?? []
    const row = [...rows].find((element) => element.dataset.eventId === selectedId)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  const onListKey = (event) => {
    const buttons = [...(listRef.current?.querySelectorAll('button.wm-row') ?? [])]
    const index = buttons.indexOf(document.activeElement)
    if (index < 0) return
    const next = {
      ArrowDown: Math.min(buttons.length - 1, index + 1),
      ArrowUp: Math.max(0, index - 1),
      Home: 0,
      End: buttons.length - 1,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    buttons[next].focus()
  }

  return (
    <aside className="wm-panel" aria-labelledby={`${id}-title`}>
      <div className="wm-panel-head">
        <div>
          <h2 className="wm-panel-title" id={`${id}-title`}>
            Live Events
          </h2>
          <p className="wm-panel-count" aria-live="polite">
            {loading
              ? 'Loading…'
              : failed
                ? 'Live events unavailable'
                : `${formatNumber(events.length)} ${events.length === 1 ? 'event' : 'events'} in view`}
          </p>
        </div>
        <button
          type="button"
          className={`wm-icon-btn wm-filter-btn${filtersActive ? ' is-active' : ''}`}
          aria-expanded={filterOpen}
          aria-controls={filterOpen ? `${id}-filter` : undefined}
          aria-label={filtersActive ? 'Filters (some events hidden)' : 'Filters'}
          title="Filter by type and severity"
          onClick={() => setFilterOpen((open) => !open)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
        </button>
      </div>

      {filterOpen && (
        <FilterPanel
          id={`${id}-filter`}
          types={types}
          onToggleType={onToggleType}
          severities={severities}
          onToggleSeverity={onToggleSeverity}
          rule={rule}
        />
      )}

      <label className="wm-sort">
        <span>Sort by</span>
        <select value={sort} onChange={(event) => onSortChange(event.target.value)}>
          {SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <div className="wm-list-loading" role="status">
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
          <span className="visually-hidden">Loading live events</span>
        </div>
      ) : failed ? (
        <p className="wm-empty" role="status">
          Live events could not be loaded. Use Retry on the map or Refresh above.
        </p>
      ) : events.length === 0 ? (
        <p className="wm-empty" role="status">
          {filteredOut ? 'No events match the selected filters.' : 'No events in this view. Zoom out to see more.'}
        </p>
      ) : (
        <ul className="wm-list" ref={listRef} aria-label="Events in the map view" onKeyDown={onListKey}>
          {events.map((event) => {
            const selected = event.id === selectedId
            const subline = eventSubline(event)
            return (
              <li key={event.id}>
                <button
                  type="button"
                  className={`wm-row${selected ? ' is-selected' : ''}`}
                  data-event-id={event.id}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect?.(event)}
                  onMouseEnter={() => onHover?.(event.id)}
                  onMouseLeave={() => onHover?.(null)}
                  onFocus={() => onHover?.(event.id)}
                  onBlur={() => onHover?.(null)}
                >
                  <TypeIcon type={event.type} size={40} decorative />
                  <span className="wm-row-body">
                    <span className={`wm-type-label wm-text-${event.type}`}>{mapType(event.type)?.label}</span>
                    <span className="wm-row-place">{eventHeadline(event)}</span>
                    {subline && <span className="wm-row-sub">{subline}</span>}
                    <span className="wm-row-meta">
                      {metaLine(event, now)}
                      {event.sources.length > 1 && ` • ${event.sources.length} sources`}
                    </span>
                  </span>
                  <SeverityPill event={event} rule={rule} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

export default LiveEventsPanel
