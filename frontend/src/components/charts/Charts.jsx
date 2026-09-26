/**
 * Recharts wrappers for the historical-impact pages, sharing one visual
 * language: one axis per chart, a single hue per series (the disaster type's
 * colour), recessive grid, 4 px rounded bar ends, 2 px lines, a tooltip on
 * every mark. Every chart sits inside a ChartCard that also offers the data
 * as a table.
 */

import { memo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCompact1 } from '../../lib/format'

const AXIS = {
  stroke: 'var(--border-strong)',
  tick: { fill: 'var(--text-muted)', fontSize: 11 },
  tickLine: false,
}

function TooltipCard({ active, payload, label, format, labelFormat }) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip-card">
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{labelFormat ? labelFormat(label, payload) : label}</p>
      {payload
        .filter((entry) => entry.value !== null && entry.value !== undefined)
        .map((entry) => (
          <p key={entry.dataKey ?? entry.name}>
            <span className="tooltip-swatch" style={{ background: entry.color }} aria-hidden="true" />
            {entry.name}: <span className="mono">{format ? format(entry.value) : entry.value}</span>
          </p>
        ))}
    </div>
  )
}

/** Shaded band marking the years before reliable recording. */
function CoverageBand({ from, to }) {
  if (from === undefined || to === undefined || from >= to) return null
  return (
    <ReferenceArea
      x1={from}
      x2={to}
      fill="var(--text-muted)"
      fillOpacity={0.08}
      stroke="none"
      ifOverflow="visible"
    />
  )
}

/**
 * Yearly values as bars, with an optional trailing moving average drawn as a
 * line on the same axis (same unit, so still one axis).
 */
function YearBarsBase({
  data = [],
  valueKey,
  valueLabel,
  color,
  height = 260,
  format = formatCompact1,
  average,
  shadeBefore,
}) {
  const first = data[0]?.year
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} stroke="var(--grid-line)" />
        <XAxis dataKey="year" type="number" domain={['dataMin - 1', 'dataMax + 1']} {...AXIS} />
        <YAxis {...AXIS} width={62} tickFormatter={format} />
        <Tooltip
          content={<TooltipCard format={format} />}
          cursor={{ fill: 'var(--surface-hover)' }}
        />
        {shadeBefore && <CoverageBand from={first} to={shadeBefore} />}
        <Bar dataKey={valueKey} name={valueLabel} fill={color} fillOpacity={average ? 0.55 : 1} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        {average && (
          <Line
            dataKey={average.key}
            name={average.label}
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Category bars (decades, months). `muted(row)` draws a bar lighter (e.g. a partial decade). */
function CategoryBarsBase({
  data = [],
  xKey,
  valueKey,
  valueLabel,
  color,
  height = 240,
  format = formatCompact1,
  muted,
  labelFormat,
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid-line)" />
        <XAxis dataKey={xKey} {...AXIS} interval="preserveStartEnd" minTickGap={4} />
        <YAxis {...AXIS} width={62} tickFormatter={format} />
        <Tooltip
          content={<TooltipCard format={format} labelFormat={labelFormat} />}
          cursor={{ fill: 'var(--surface-hover)' }}
        />
        <Bar dataKey={valueKey} name={valueLabel} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((row) => (
            <Cell
              key={row[xKey]}
              fill={color}
              fillOpacity={muted?.(row) ? 0.4 : 1}
              stroke={muted?.(row) ? color : undefined}
              strokeDasharray={muted?.(row) ? '3 2' : undefined}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Two series stacked on one axis (north/south hemisphere months). */
function StackedBarsBase({ data = [], xKey, series, height = 240, format = formatCompact1 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid-line)" />
        <XAxis dataKey={xKey} {...AXIS} interval={0} />
        <YAxis {...AXIS} width={62} tickFormatter={format} />
        <Tooltip content={<TooltipCard format={format} />} cursor={{ fill: 'var(--surface-hover)' }} />
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            stackId="stack"
            fill={item.color}
            fillOpacity={item.opacity ?? 1}
            stroke="var(--surface)"
            strokeWidth={index > 0 ? 2 : 0}
            radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

const logTicks = (min, max) => {
  const ticks = []
  for (let p = Math.floor(Math.log10(min)); p <= Math.ceil(Math.log10(max)); p += 1) ticks.push(10 ** p)
  return ticks
}

/** Log-log scatter of records. points: [[x, y, country, year], ...] */
function ScatterLogBase({ points = [], xLabel, yLabel, color, height = 280, formatX = formatCompact1, formatY = formatCompact1 }) {
  const data = points.map(([x, y, country, year]) => ({ x, y, country, year }))
  if (!data.length) return null
  const xs = data.map((d) => d.x)
  const ys = data.map((d) => d.y)
  const xTicks = logTicks(Math.min(...xs), Math.max(...xs))
  const yTicks = logTicks(Math.min(...ys), Math.max(...ys))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 12, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="var(--grid-line)" />
        <XAxis
          dataKey="x"
          type="number"
          scale="log"
          domain={[xTicks[0], xTicks[xTicks.length - 1]]}
          ticks={xTicks}
          tickFormatter={formatX}
          name={xLabel}
          {...AXIS}
          label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: 'var(--text-muted)', fontSize: 11 }}
        />
        <YAxis
          dataKey="y"
          type="number"
          scale="log"
          domain={[yTicks[0], yTicks[yTicks.length - 1]]}
          ticks={yTicks}
          tickFormatter={formatY}
          name={yLabel}
          width={62}
          {...AXIS}
        />
        <Tooltip
          cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const point = payload[0].payload
            return (
              <div className="tooltip-card">
                <p style={{ fontWeight: 600, marginBottom: 4 }}>
                  {point.country}, {point.year}
                </p>
                <p>
                  {xLabel}: <span className="mono">{formatX(point.x)}</span>
                </p>
                <p>
                  {yLabel}: <span className="mono">{formatY(point.y)}</span>
                </p>
              </div>
            )
          }}
        />
        <Scatter data={data} fill={color} fillOpacity={0.45} stroke={color} strokeOpacity={0.9} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

/**
 * Several series over one x axis on one 0–100 scale (the Pre-Prediction risk
 * trend). `bands` draws dashed guides at level cut-offs; `marker` a labelled
 * vertical line (for example where the weather forecast ends).
 */
function MultiLinesBase({ data = [], xKey, series, height = 280, format = (v) => v, labelFormat, bands = [], marker, domain = [0, 100] }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid-line)" />
        <XAxis dataKey={xKey} {...AXIS} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...AXIS} width={40} domain={domain} ticks={[0, 30, 60, 80, 100]} tickFormatter={format} />
        {bands.map((value) => (
          <ReferenceLine key={value} y={value} stroke="var(--border-strong)" strokeDasharray="3 4" ifOverflow="extendDomain" />
        ))}
        {marker && (
          <ReferenceLine
            x={marker.x}
            stroke="var(--text-muted)"
            strokeDasharray="2 3"
            label={{ value: marker.label, position: 'insideTopRight', fill: 'var(--text-muted)', fontSize: 11 }}
          />
        )}
        <Tooltip content={<TooltipCard format={format} labelFormat={labelFormat} />} cursor={{ stroke: 'var(--border-strong)' }} />
        {series.map((item) => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={item.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export const YearBars = memo(YearBarsBase)
export const MultiLines = memo(MultiLinesBase)
export const CategoryBars = memo(CategoryBarsBase)
export const StackedBars = memo(StackedBarsBase)
export const ScatterLog = memo(ScatterLogBase)
export { TooltipCard }
