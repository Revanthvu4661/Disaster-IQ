import { useMemo } from 'react'

/**
 * Two heatmaps drawn as SVG, in the disaster type's own colour. Darker means
 * more events. Colour is never the only cue: every cell has a text title with
 * its count, the SVG has a summary label, and each card offers the numbers as a
 * data table.
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Cell opacity from a count: none for zero, then a square-root ramp so single events stay visible. */
export function shade(value, max) {
  if (!value || !max) return 0
  return 0.2 + 0.8 * Math.sqrt(value / max)
}

function Legend({ color, max, unit }) {
  const steps = [0.2, 0.4, 0.6, 0.8, 1]
  return (
    <div className="heatmap-legend" aria-hidden="true">
      <span>None</span>
      <span className="heatmap-swatch" style={{ background: 'var(--surface-hover)' }} />
      {steps.map((step) => (
        <span key={step} className="heatmap-swatch" style={{ background: color, opacity: step }} />
      ))}
      <span>
        {max} {unit} or more in a cell
      </span>
    </div>
  )
}

/**
 * Years across, months down. `matrix[yearIndex][monthIndex]` holds counts.
 * With many years the cells are thin, so labels appear every decade.
 */
export function YearMonthHeatmap({ years, matrix, color, unit, ariaLabel }) {
  const max = useMemo(() => Math.max(1, ...matrix.flat()), [matrix])
  const cellWidth = years.length > 60 ? 8 : 16
  const cellHeight = 16
  const left = 34
  const top = 6
  const width = left + years.length * cellWidth
  const height = top + 12 * cellHeight + 18
  const every = years.length > 60 ? 10 : years.length > 25 ? 5 : 1
  return (
    <div className="heatmap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMinYMin meet">
        {MONTH_NAMES.map((name, month) => (
          <text key={name} x={left - 6} y={top + month * cellHeight + 12} textAnchor="end" className="heatmap-label">
            {name}
          </text>
        ))}
        {years.map((year, index) =>
          MONTH_NAMES.map((name, month) => {
            const count = matrix[index][month]
            return (
              <rect
                key={`${year}-${month}`}
                x={left + index * cellWidth}
                y={top + month * cellHeight}
                width={cellWidth - 1}
                height={cellHeight - 1}
                rx={1.5}
                fill={count ? color : 'var(--surface-hover)'}
                fillOpacity={count ? shade(count, max) : 1}
              >
                <title>{`${name} ${year}: ${count} ${unit}`}</title>
              </rect>
            )
          }),
        )}
        {years.map((year, index) =>
          year % every === 0 || index === 0 ? (
            <text key={`tick-${year}`} x={left + index * cellWidth} y={height - 4} className="heatmap-label">
              {year}
            </text>
          ) : null,
        )}
      </svg>
      <Legend color={color} max={max} unit={unit} />
    </div>
  )
}

const DAY_MS = 86_400_000

/**
 * One year as a calendar: a column per week, a row per weekday (Monday first).
 * `counts` maps day of year (1-366) to a count.
 */
export function CalendarHeatmap({ year, counts, color, unit, ariaLabel }) {
  const max = Math.max(1, ...Object.values(counts))
  const start = Date.UTC(year, 0, 1)
  const days = (Date.UTC(year + 1, 0, 1) - start) / DAY_MS
  const lead = (new Date(start).getUTCDay() + 6) % 7 // Monday = 0
  const weeks = Math.ceil((lead + days) / 7)
  const cell = 14
  const left = 28
  const top = 16
  const width = left + weeks * cell
  const height = top + 7 * cell + 4
  const cells = []
  const monthStarts = []
  for (let doy = 1; doy <= days; doy += 1) {
    const date = new Date(start + (doy - 1) * DAY_MS)
    const position = lead + doy - 1
    const week = Math.floor(position / 7)
    const row = position % 7
    const count = counts[doy] ?? 0
    if (date.getUTCDate() === 1) monthStarts.push({ week, label: MONTH_NAMES[date.getUTCMonth()] })
    cells.push({ doy, week, row, count, label: `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${year}` })
  }
  return (
    <div className="heatmap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMinYMin meet">
        {['Mon', 'Wed', 'Fri'].map((name, index) => (
          <text key={name} x={left - 6} y={top + index * 2 * cell + 11} textAnchor="end" className="heatmap-label">
            {name}
          </text>
        ))}
        {monthStarts.map(({ week, label }) => (
          <text key={label} x={left + week * cell} y={11} className="heatmap-label">
            {label}
          </text>
        ))}
        {cells.map((c) => (
          <rect
            key={c.doy}
            x={left + c.week * cell}
            y={top + c.row * cell}
            width={cell - 2}
            height={cell - 2}
            rx={2}
            fill={c.count ? color : 'var(--surface-hover)'}
            fillOpacity={c.count ? shade(c.count, max) : 1}
            stroke={c.count === max ? 'var(--text-primary)' : undefined}
            strokeWidth={c.count === max ? 1.5 : undefined}
          >
            <title>{`${c.label}: ${c.count} ${unit}`}</title>
          </rect>
        ))}
      </svg>
      <Legend color={color} max={max} unit={unit} />
    </div>
  )
}
