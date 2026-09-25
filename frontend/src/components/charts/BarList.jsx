import { memo } from 'react'

/**
 * Ranked horizontal bars drawn with HTML, not SVG.
 *
 * Every row is real text (label, value, secondary value), so the chart reads
 * correctly to a screen reader and never clips a label on a 360 px screen. The
 * bar itself is decorative. `segments` splits a bar into a solid and a soft
 * part (used for "inferred by keyword" vs "inferred by id range"); `hatched`
 * draws proxy data with a striped fill so it never looks like a labelled count.
 *
 * rows: [{ key, label, value, display, secondary, segments?: [{ value, tone }] }]
 */
function BarListBase({ rows, color, max, hatched = false, ariaLabel, labelWidth = '9.5rem' }) {
  const top = max ?? Math.max(...rows.map((row) => row.value), 0)
  return (
    <ul
      className={`barlist${hatched ? ' barlist-hatched' : ''}`}
      aria-label={ariaLabel}
      style={{ '--bar-color': color, '--barlist-label': labelWidth }}
    >
      {rows.map((row) => {
        const width = top > 0 ? (row.value / top) * 100 : 0
        return (
          <li key={row.key ?? row.label} className="barlist-row">
            <span className="barlist-label" title={row.title ?? row.label}>
              {row.icon}
              {row.label}
            </span>
            <span className="barlist-track" aria-hidden="true">
              {row.segments ? (
                row.segments.map((segment, index) => (
                  <span
                    key={index}
                    className={`barlist-fill barlist-fill-${segment.tone ?? 'solid'}`}
                    style={{
                      width: `${top > 0 ? (segment.value / top) * 100 : 0}%`,
                      background: segment.color,
                    }}
                  />
                ))
              ) : (
                <span
                  className="barlist-fill"
                  style={{ width: `${width}%`, background: row.color }}
                />
              )}
            </span>
            <span className="barlist-value">
              {row.display ?? row.value}
              {row.secondary && <span className="barlist-secondary">{row.secondary}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export const BarList = memo(BarListBase)
export default BarList
