import { memo, useMemo, useState } from 'react'
import { humanCategory } from '../../lib/format'

const LABEL_ROTATION = -50
const HEADER_HEIGHT = 96 // room for the rotated column labels
const LABEL_MAX_CHARS = 16

/**
 * Accessible SVG heatmap.
 *
 * Each cell is focusable, announces its value through `aria-label`, and shows
 * its value in the live caption on hover or focus, so the chart is usable
 * without a mouse and without relying on colour intensity alone.
 */
function HeatmapBase({
  rows,
  columns,
  values,
  rowLabel = 'Row',
  columnLabel = 'Column',
  formatValue = (value) => value.toLocaleString(),
  cellSize = 26,
  labelWidth = 104,
  colorFrom = 'var(--series-1)',
}) {
  const [hovered, setHovered] = useState(null)
  const sameAxes = rows === columns || rows.join('|') === columns.join('|')

  const max = useMemo(() => {
    let highest = 0
    values.forEach((row, rowIndex) =>
      row.forEach((value, columnIndex) => {
        if (sameAxes && rowIndex === columnIndex) return // the diagonal is the total
        if (value > highest) highest = value
      }),
    )
    return highest || 1
  }, [values, sameAxes])

  const gridWidth = columns.length * cellSize
  const width = labelWidth + gridWidth + 96 // trailing space for rotated labels
  const height = HEADER_HEIGHT + rows.length * cellSize + 8

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMin meet"
        role="img"
        aria-label={`Heatmap of ${rowLabel} against ${columnLabel}`}
        style={{ minWidth: Math.min(width, 560), maxWidth: '100%' }}
      >
        {columns.map((column, columnIndex) => {
          const x = labelWidth + columnIndex * cellSize + cellSize / 2
          const y = HEADER_HEIGHT - 10
          return (
            <text
              key={column}
              x={x}
              y={y}
              transform={`rotate(${LABEL_ROTATION} ${x} ${y})`}
              textAnchor="start"
              fontSize="10"
              fill="var(--text-muted)"
            >
              {humanCategory(column).slice(0, LABEL_MAX_CHARS)}
            </text>
          )
        })}

        {rows.map((row, rowIndex) => {
          const y = HEADER_HEIGHT + rowIndex * cellSize
          return (
            <g key={row}>
              <text
                x={labelWidth - 8}
                y={y + cellSize / 2 + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-secondary)"
              >
                {humanCategory(row).slice(0, LABEL_MAX_CHARS)}
              </text>
              {columns.map((column, columnIndex) => {
                const value = values[rowIndex]?.[columnIndex] ?? 0
                const isDiagonal = sameAxes && rowIndex === columnIndex
                const intensity = isDiagonal ? 0 : Math.min(1, value / max)
                const active =
                  hovered && hovered.row === rowIndex && hovered.column === columnIndex
                return (
                  <rect
                    key={column}
                    className="heatmap-cell"
                    x={labelWidth + columnIndex * cellSize}
                    y={y}
                    width={cellSize - 2}
                    height={cellSize - 2}
                    rx="3"
                    tabIndex={0}
                    role="img"
                    fill={
                      isDiagonal
                        ? 'var(--surface-2)'
                        : `color-mix(in srgb, ${colorFrom} ${Math.round(
                            6 + intensity * 94,
                          )}%, var(--surface-2))`
                    }
                    stroke={active ? 'var(--text)' : undefined}
                    strokeWidth={active ? 2 : undefined}
                    aria-label={`${humanCategory(row)} and ${humanCategory(
                      column,
                    )}: ${formatValue(value)}`}
                    onMouseEnter={() => setHovered({ row: rowIndex, column: columnIndex, value })}
                    onFocus={() => setHovered({ row: rowIndex, column: columnIndex, value })}
                    onMouseLeave={() => setHovered(null)}
                    onBlur={() => setHovered(null)}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>

      <p className="text-xs secondary" style={{ marginTop: 8, minHeight: 20 }} aria-live="polite">
        {hovered
          ? `${humanCategory(rows[hovered.row])} and ${humanCategory(
              columns[hovered.column],
            )}: ${formatValue(hovered.value)}`
          : `Hover or tab through the grid to read values. Darkest cell = ${formatValue(max)}.`}
      </p>
    </div>
  )
}

export const Heatmap = memo(HeatmapBase)
export default Heatmap
