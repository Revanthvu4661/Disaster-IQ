/** Recharts wrappers sharing one visual language and accessible labels. */

import { memo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { humanCategory, seriesColor, titleCase } from '../../lib/format'

const AXIS = { stroke: 'var(--border-strong)', tick: { fill: 'var(--text-muted)', fontSize: 11 } }

function TooltipCard({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip-card">
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{titleCase(String(label ?? ''))}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey ?? entry.name} style={{ color: entry.color }}>
          {titleCase(String(entry.name))}:{' '}
          <span className="mono">
            {formatter ? formatter(entry.value) : entry.value?.toLocaleString?.() ?? entry.value}
          </span>
        </p>
      ))}
    </div>
  )
}

/** Horizontal category bars. Clicking a bar drills down. */
function CategoryBarChartBase({ data = [], onSelect, selected, height = 380 }) {
  const rows = data.map((row) => ({ ...row, label: humanCategory(row.category) }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="var(--grid-line)" />
        <XAxis type="number" {...AXIS} />
        <YAxis
          type="category"
          dataKey="label"
          width={118}
          interval={0}
          {...AXIS}
          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
        />
        <Tooltip content={<TooltipCard />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Bar
          dataKey="count"
          name="messages"
          radius={[0, 4, 4, 0]}
          onClick={onSelect ? (entry) => onSelect(entry.category) : undefined}
          cursor={onSelect ? 'pointer' : 'default'}
          isAnimationActive={false}
        >
          {rows.map((row) => (
            <Cell
              key={row.category}
              fill={
                selected === row.category
                  ? 'var(--accent)'
                  : row.is_urgent
                    ? 'var(--severity-high)'
                    : 'var(--series-1)'
              }
              opacity={selected && selected !== row.category ? 0.45 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Vertical bars for simple count series. */
function SimpleBarChartBase({
  data = [],
  xKey,
  yKey = 'count',
  height = 260,
  color = 'var(--series-1)',
  colorBy,
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid-line)" />
        <XAxis dataKey={xKey} {...AXIS} interval={0} angle={-12} textAnchor="end" height={54} />
        <YAxis {...AXIS} width={46} />
        <Tooltip content={<TooltipCard />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Bar dataKey={yKey} name="messages" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((row, index) => (
            <Cell key={row[xKey] ?? index} fill={colorBy ? colorBy(row, index) : color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Grouped bars: one group per event, one bar per category share. */
function GroupedBarChartBase({ rows = [], categories = [], height = 320 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid-line)" />
        <XAxis dataKey="event" {...AXIS} height={48} interval={0} angle={-12} textAnchor="end" />
        <YAxis
          {...AXIS}
          width={46}
          tickFormatter={(value) => `${Math.round(value * 100)}%`}
        />
        <Tooltip
          content={<TooltipCard formatter={(value) => `${(value * 100).toFixed(1)}%`} />}
          cursor={{ fill: 'var(--surface-hover)' }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}
          formatter={(value) => humanCategory(value)}
        />
        {categories.map((category, index) => (
          <Bar
            key={category}
            dataKey={category}
            name={category}
            fill={seriesColor(index)}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Line chart used for PR curves and threshold sweeps. */
function SimpleLineChartBase({
  data = [],
  xKey,
  lines = [],
  height = 260,
  xLabel,
  yLabel,
  domain = [0, 1],
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="var(--grid-line)" />
        <XAxis
          dataKey={xKey}
          {...AXIS}
          domain={domain}
          type="number"
          label={
            xLabel
              ? { value: xLabel, position: 'insideBottom', offset: -8, fill: 'var(--text-muted)', fontSize: 11 }
              : undefined
          }
        />
        <YAxis
          {...AXIS}
          width={46}
          domain={[0, 1]}
          label={
            yLabel
              ? { value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }
              : undefined
          }
        />
        <Tooltip content={<TooltipCard formatter={(value) => Number(value).toFixed(3)} />} />
        {lines.map((line, index) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color ?? seriesColor(index)}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export const CategoryBarChart = memo(CategoryBarChartBase)
export const SimpleBarChart = memo(SimpleBarChartBase)
export const GroupedBarChart = memo(GroupedBarChartBase)
export const SimpleLineChart = memo(SimpleLineChartBase)
export { TooltipCard }
