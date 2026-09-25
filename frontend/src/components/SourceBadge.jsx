import { useId, useState } from 'react'
import { Calculator, Database, Info, Sigma, Sparkles } from 'lucide-react'
import { SOURCES } from '../config/sources'

const KIND_LABEL = { model: 'Model estimate', index: 'Statistical index', formula: 'Formula estimate' }

/**
 * The one data-provenance badge used on every card and chart.
 *
 *   historical  Names the source(s): OWID / EM-DAT, USGS, NOAA IBTrACS, NASA POWER...
 *               `source` is one id or a list of ids from config/sources.js.
 *   live        Live feed: USGS / GDACS / NASA EONET, fetched in the last 10 min.
 *   model       A prediction from the Level 2 flood model; `source` names its inputs.
 *   index       A Level 2 statistical hazard index from a historical catalogue (not a trained model).
 *   formula     A Level 3 planning estimate from a documented formula.
 *
 * `note` renders an info toggle that discloses how the figure was produced.
 * It is a button (not a hover title) so it works on touch and with a keyboard.
 */
export function SourceBadge({ kind = 'historical', source, detail, note }) {
  const [open, setOpen] = useState(false)
  const noteId = useId()
  const ids = source ? [source].flat() : []
  const isLive = kind === 'live'
  const names = ids.map((id) => SOURCES[id]?.short ?? id).join(' · ')
  const label = isLive
    ? 'Live feed'
    : KIND_LABEL[kind]
      ? `${KIND_LABEL[kind]}${names ? ` · ${names}` : ''}`
      : names || 'Historical data'
  const disclosure = note ?? (isLive ? null : ids.map((id) => SOURCES[id]?.long).filter(Boolean).join(' '))
  const Icon = kind === 'model' ? Sparkles : kind === 'index' ? Sigma : kind === 'formula' ? Calculator : Database

  return (
    <span className={`source-badge source-badge-${isLive ? 'live' : kind}`}>
      <span className="source-badge-pill">
        {isLive ? <span className="live-dot" aria-hidden="true" /> : <Icon size={12} aria-hidden="true" />}
        <span>
          {!isLive && <span className="visually-hidden">Source: </span>}
          {label}
          {detail && <span className="source-badge-detail">: {detail}</span>}
        </span>
      </span>
      {disclosure && (
        <>
          <button
            type="button"
            className="source-badge-info"
            aria-expanded={open}
            aria-controls={noteId}
            aria-label={`About the source: ${label}`}
            onClick={() => setOpen((value) => !value)}
          >
            <Info size={13} aria-hidden="true" />
          </button>
          <span id={noteId} role="note" className="source-badge-note" hidden={!open}>
            {disclosure}
          </span>
        </>
      )}
    </span>
  )
}

export default SourceBadge
