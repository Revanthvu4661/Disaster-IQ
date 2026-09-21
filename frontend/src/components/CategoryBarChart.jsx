import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const URGENT = new Set([
  'medical_help','search_and_rescue','water','food',
  'death','missing_people','floods','storm','earthquake','fire',
])

/* ── dark tooltip ──────────────────────────────────────────────────────── */
const DarkTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const { category, count } = payload[0].payload
  const isUrgent = URGENT.has(category)
  return (
    <div style={{
      background: '#0d0e14',
      border: `1px solid ${isUrgent ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      minWidth: 160,
    }}>
      <p style={{
        margin: 0,
        fontSize: 13,
        fontWeight: 600,
        color: '#f1f5f9',
        textTransform: 'capitalize',
        marginBottom: 4,
      }}>
        {category.replace(/_/g, ' ')}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: isUrgent ? '#ef4444' : '#f97316',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 13, color: isUrgent ? '#fca5a5' : '#fdba74', fontWeight: 500 }}>
          {count.toLocaleString()}
        </span>
        <span style={{ fontSize: 11, color: '#475569' }}>messages</span>
      </div>
      {isUrgent && (
        <p style={{ margin: '6px 0 0', fontSize: 10, color: '#ef4444', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          ⚡ Urgent category
        </p>
      )}
    </div>
  )
}

/* ── gradient def ─────────────────────────────────────────────────────── */
const GradientDefs = () => (
  <defs>
    <linearGradient id="barGradNormal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#f97316" stopOpacity={0.9} />
      <stop offset="100%" stopColor="#c2410c" stopOpacity={0.7} />
    </linearGradient>
    <linearGradient id="barGradUrgent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
      <stop offset="100%" stopColor="#991b1b" stopOpacity={0.8} />
    </linearGradient>
  </defs>
)

export default function CategoryBarChart({ data }) {
  if (!data?.length) return null

  return (
    <ResponsiveContainer width="100%" height={330}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 84 }}
        barSize={20}
        barCategoryGap="28%"
      >
        <GradientDefs />
        <XAxis
          dataKey="category"
          tick={{ fontSize: 10, fill: '#334155' }}
          tickLine={false}
          axisLine={false}
          angle={-42}
          textAnchor="end"
          interval={0}
          tickFormatter={(v) => v.replace(/_/g, ' ')}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#334155' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
          width={34}
        />
        <Tooltip
          content={<DarkTooltip />}
          cursor={{ fill: 'rgba(255,255,255,0.025)', radius: 4 }}
        />
        <Bar dataKey="count" radius={[5, 5, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
          {data.map((entry) => (
            <Cell
              key={entry.category}
              fill={URGENT.has(entry.category) ? 'url(#barGradUrgent)' : 'url(#barGradNormal)'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
