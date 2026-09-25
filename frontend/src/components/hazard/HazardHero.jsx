/**
 * Decorative hero pieces for the three disaster-page themes.
 *
 *   earthquake  seismograph trace that draws itself once, fault-line cracks
 *   flood       water-level gauge with a slow wave crest, ripple rings
 *   cyclone     radar sweep over range rings, the spinning storm spiral
 *
 * Only the three readouts under each instrument carry data, and they come
 * from the page's own figures (records, span, one headline metric). The
 * drawings themselves are illustrations: hidden from assistive tech and never
 * scaled to a value. All motion lives in CSS and stops under
 * prefers-reduced-motion.
 */
import { GLYPHS } from '../map/eventIcons'

const PANEL_TITLE = {
  earthquake: ['Seismograph · display', 'REC'],
  flood: ['Water level · display', 'GAUGE'],
  cyclone: ['Storm radar · display', 'SCAN'],
}

/** The seismograph trace from the approved Earthquake preview. */
const TRACE =
  'M0 75 L40 75 L48 70 L56 80 L64 74 L90 75 L100 68 L108 84 L116 72 L140 75 L150 60 L158 92 L166 50 L174 104 L182 30 L190 128 L198 18 L206 138 L214 40 L222 110 L230 55 L238 96 L246 64 L254 86 L262 70 L272 80 L284 72 L296 78 L310 74 L330 76 L350 73 L362 79 L374 72 L390 75 L410 70 L418 82 L426 71 L440 76 L470 75 L518 75'

/** One wave period is 104 px; the path is two screens wide so it can scroll seamlessly. */
function wavePath(y, amplitude) {
  let d = `M-104 ${y}`
  for (let x = -104; x < 1040; x += 104) {
    d += ` q26 ${-amplitude} 52 0 t52 0`
  }
  return `${d} V160 H-104 Z`
}
const WAVE_FRONT = wavePath(58, 7)
const WAVE_BACK = wavePath(62, 5)

function Grid() {
  return (
    <g className="hz-grid">
      <path d="M0 37h518M0 75h518M0 113h518" />
      <path d="M65 0v150M130 0v150M195 0v150M260 0v150M325 0v150M390 0v150M455 0v150" />
    </g>
  )
}

function Seismograph() {
  return (
    <svg viewBox="0 0 518 150" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <Grid />
      <path className="hz-trace" d={TRACE} pathLength="1400" />
    </svg>
  )
}

function WaterGauge() {
  const ticks = Array.from({ length: 11 }, (_, index) => 10 + index * 13)
  return (
    <svg viewBox="0 0 518 150" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g className="hz-water">
        <path className="hz-wave hz-wave-back" d={WAVE_BACK} />
        <path className="hz-wave hz-wave-front" d={WAVE_FRONT} />
      </g>
      <g className="hz-ticks">
        {ticks.map((y, index) => (
          <path key={y} d={`M0 ${y}h${index % 5 === 0 ? 22 : 12}`} />
        ))}
      </g>
    </svg>
  )
}

/** Pie slice of the radar beam, from `start` to `end` degrees (0 = up, clockwise). */
function sector(start, end, r = 66, cx = 259, cy = 75) {
  const point = (deg) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`
  }
  return `M${cx} ${cy} L${point(start)} A${r} ${r} 0 0 1 ${point(end)} Z`
}

/** The beam trails behind its leading edge: six slices fading out over 60°. */
const BEAM = Array.from({ length: 6 }, (_, index) => ({
  d: sector(-60 + index * 10, -50 + index * 10),
  opacity: 0.06 + index * 0.08,
}))

function Radar() {
  return (
    <svg viewBox="0 0 518 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <Grid />
      <g className="hz-rings">
        <circle cx="259" cy="75" r="22" />
        <circle cx="259" cy="75" r="44" />
        <circle cx="259" cy="75" r="66" />
        <path d="M259 5v140M189 75h140" />
      </g>
      <g className="hz-sweep">
        {BEAM.map((slice) => (
          <path key={slice.d} d={slice.d} style={{ opacity: slice.opacity }} />
        ))}
        <path className="hz-sweep-edge" d="M259 75 L259 9" />
      </g>
    </svg>
  )
}

const INSTRUMENT = { earthquake: Seismograph, flood: WaterGauge, cyclone: Radar }

/**
 * The instrument panel beside the hero title, with three readouts under it.
 * `stats` is `[{ label, value, tone }]`; while the page loads it is empty and
 * the readouts show a dash.
 */
export function HazardPanel({ hazard, stats }) {
  const Instrument = INSTRUMENT[hazard]
  if (!Instrument) return null
  const [title, status] = PANEL_TITLE[hazard]
  const tiles = stats?.length ? stats : [{ label: 'Records' }, { label: 'Span' }, { label: '—' }]
  return (
    <section className="hz-panel" aria-label="Key figures">
      <div className="hz-panel-head" aria-hidden="true">
        <span>{title}</span>
        <span className="hz-panel-status">
          <span className="hz-blink">●</span> {status}
        </span>
      </div>
      <div className={`hz-panel-body hz-${hazard}-body`}>
        <Instrument />
      </div>
      <dl className="hz-readouts">
        {tiles.map((tile) => (
          <div key={tile.label} data-tone={tile.tone}>
            <dt>{tile.label}</dt>
            <dd>{tile.value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Faint background drawing behind the hero: fault cracks, current lines or wind streamlines. */
export function HazardBackdrop({ hazard }) {
  if (hazard === 'earthquake') {
    return (
      <svg className="hz-backdrop" viewBox="0 0 1440 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <path d="M0 250 L140 232 L190 262 L300 238 L360 280 L470 250 L520 300 L610 270" />
        <path d="M360 280 L380 330 L350 380" />
        <path d="M980 0 L1010 60 L990 110 L1050 160 L1030 220 L1100 270 L1080 330 L1140 380" />
        <path d="M1050 160 L1130 150 L1190 190 L1300 170 L1440 200" />
      </svg>
    )
  }
  if (hazard === 'flood') {
    return (
      <svg className="hz-backdrop" viewBox="0 0 1440 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <path d="M0 300 C180 270 320 330 520 300 S860 270 1040 305 S1300 330 1440 300" />
        <path d="M0 340 C200 315 360 365 560 340 S900 315 1080 345 S1320 365 1440 340" />
      </svg>
    )
  }
  if (hazard === 'cyclone') {
    return (
      <svg className="hz-backdrop" viewBox="0 0 1440 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <path d="M-40 90 C300 40 620 150 980 70 S1380 30 1480 60" />
        <path d="M-40 150 C320 100 640 210 1000 130 S1390 90 1480 120" />
        <path d="M-40 330 C300 290 700 370 1060 300 S1400 280 1480 300" />
      </svg>
    )
  }
  return null
}

/** Small motif around the header icon tile: ripple rings (flood) or the storm spiral (cyclone). */
export function TileMotif({ hazard }) {
  if (hazard === 'flood') {
    return (
      <span className="hz-ripples" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    )
  }
  if (hazard === 'cyclone') {
    // The same spiral as the World Map's cyclone marker: one symbol for "cyclone" across the app.
    return <span className="hz-spiral" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS.cyclone }} />
  }
  return null
}
