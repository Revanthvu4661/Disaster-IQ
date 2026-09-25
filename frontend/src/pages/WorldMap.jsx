import { Suspense, lazy, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { History, Radio } from 'lucide-react'
import { downSources, isIncomplete, useLiveEvents } from '../hooks/useLive'
import LiveEventMap, { DEFAULT_MAP_SETTINGS } from '../components/live/LiveEventMap'
import LiveEventsPanel from '../components/live/LiveEventsPanel'
import SourceStrip from '../components/live/SourceStrip'
import { ErrorState, PageHeader, Skeleton } from '../components/ui'
import { formatNumber } from '../lib/format'
import {
  DEFAULT_SEVERITY_RULE,
  MAP_TYPE_IDS,
  SEVERITY_FILTERS,
  filterEvents,
  inBounds,
  sortEvents,
} from '../lib/liveEvents'
import '../styles/worldmap.css'

const HistoricalLayer = lazy(() => import('../components/history/HistoricalLayer'))

const MODES = [
  { id: 'live', label: 'Live now', icon: Radio },
  { id: 'historical', label: 'Historical', icon: History },
]

/** Live / Historical switch. The two views never share a map, so a pin is always one or the other. */
function ModeSwitch({ mode, onChange }) {
  return (
    <div className="seg seg-mode" role="group" aria-label="Map mode">
      {MODES.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            className="seg-btn"
            aria-pressed={mode === item.id}
            onClick={() => onChange(item.id)}
          >
            <Icon size={14} aria-hidden="true" />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export default function WorldMap() {
  const [mode, setMode] = useState('live')
  const header = (
    <PageHeader
      title="World Map"
      description={
        mode === 'live'
          ? 'Current earthquakes, floods and cyclones worldwide, merged from USGS, GDACS and NASA EONET. Where two sources report the same event, both readings are kept.'
          : 'Past disasters by decade: USGS earthquakes (M6+) and NOAA IBTrACS cyclones at their exact positions, and EM-DAT flood records by country.'
      }
      actions={<ModeSwitch mode={mode} onChange={setMode} />}
    />
  )
  return (
    <div className="stack">
      {header}
      {mode === 'live' ? (
        <LiveMap />
      ) : (
        <div className="wm-historical">
          <Suspense fallback={<Skeleton height={520} />}>
            <HistoricalLayer />
          </Suspense>
        </div>
      )}
    </div>
  )
}

const TYPE_SET = () => new Set(MAP_TYPE_IDS)
const SEVERITY_SET = () => new Set(SEVERITY_FILTERS)

/** Adds or removes one value from a Set held in state. */
const toggleIn = (setter) => (value) =>
  setter((current) => {
    const next = new Set(current)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  })

/**
 * Sizes the map row to fill the window below the page header and status
 * strip (at least 520 px). Below 900 px the CSS takes over (map 60vh, list below).
 */
function useFillViewport() {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY
      element.style.setProperty('--wm-fill', `${Math.max(520, window.innerHeight - top - 16)}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return ref
}

/** Layers-menu note per type: its count, or which feed is missing. */
function typeNote(layer) {
  if (!layer) return null
  if (layer.status === 'unavailable') return 'unavailable'
  if (isIncomplete(layer)) {
    return layer.count === 0 ? `${downSources(layer).join(', ')} down` : `${formatNumber(layer.count)}+ · incomplete`
  }
  return formatNumber(layer.count)
}

function LiveMap() {
  const [nonce, setNonce] = useState(0)
  const { data, error, loading, reload } = useLiveEvents(undefined, { refreshNonce: nonce })
  const [types, setTypes] = useState(TYPE_SET)
  const [severities, setSeverities] = useState(SEVERITY_SET)
  const [settings, setSettings] = useState(DEFAULT_MAP_SETTINGS)
  const [sort, setSort] = useState('recent')
  const [bounds, setBounds] = useState(null)
  const [selected, setSelected] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [focus, setFocus] = useState(null)
  const rowRef = useFillViewport()

  const events = data?.events
  // One memoised list for the map, so hovering, sorting or panning never rebuilds markers.
  const onMap = useMemo(() => filterEvents(events ?? [], { types, severities }), [events, types, severities])
  const inView = useMemo(() => onMap.filter((event) => inBounds(bounds, event)), [onMap, bounds])
  const rows = useMemo(() => sortEvents(inView, sort), [inView, sort])
  const typeNotes = useMemo(
    () => Object.fromEntries(MAP_TYPE_IDS.map((id) => [id, typeNote(data?.layers?.[id])])),
    [data],
  )
  const rule = data?.severity_rule ?? DEFAULT_SEVERITY_RULE

  const onBoundsChange = useCallback((next) => setBounds(next), [])
  const onMarkerSelect = useCallback((event) => setSelected(event.id), [])
  const selectFromList = useCallback((event) => {
    setSelected(event.id)
    setFocus({ latitude: event.latitude, longitude: event.longitude, id: event.id })
  }, [])

  return (
    <div className="wm">
      <SourceStrip
        sources={data?.sources}
        fetchedAt={data?.fetched_at}
        loading={loading}
        onRefresh={() => setNonce((value) => value + 1)}
      />
      <section className="wm-main" ref={rowRef} aria-label="Live map and event list">
        <div className="wm-map-col">
          {loading && !data ? (
            <div className="wm-map-state" role="status">
              <Skeleton height="100%" />
              <span className="map-state-label">Loading live events…</span>
            </div>
          ) : error && !data ? (
            <div className="wm-map-state map-state-error">
              <ErrorState message={error} onRetry={reload} />
            </div>
          ) : (
            <LiveEventMap
              events={onMap}
              selectedId={selected}
              hoverId={hovered}
              onSelect={onMarkerSelect}
              onBoundsChange={onBoundsChange}
              focus={focus}
              fitKey={data?.fetched_at ?? 'initial'}
              settings={settings}
              onSettingsChange={setSettings}
              types={types}
              onToggleType={toggleIn(setTypes)}
              typeNotes={typeNotes}
              rule={rule}
            />
          )}
        </div>
        <LiveEventsPanel
          events={rows}
          loading={loading && !data}
          failed={Boolean(error) && !data}
          filteredOut={Boolean(events?.length) && onMap.length === 0}
          sort={sort}
          onSortChange={setSort}
          types={types}
          onToggleType={toggleIn(setTypes)}
          severities={severities}
          onToggleSeverity={toggleIn(setSeverities)}
          selectedId={selected}
          onSelect={selectFromList}
          onHover={setHovered}
          rule={rule}
        />
      </section>
    </div>
  )
}
