import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts'

const COLORS = { direct: '#ef4444', news: '#3b82f6', social: '#8b5cf6' }
const LABELS = { direct: 'Direct', news: 'News', social: 'Social' }

const DarkTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const { event, count } = payload[0].payload
  const color = COLORS[event] ?? '#94a3b8'
  return (
    <div style={{
      background: '#0d0e14',
      border: `1px solid rgba(255,255,255,0.08)`,
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      minWidth: 140,
    }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#f1f5f9', marginBottom: 4, textTransform: 'capitalize' }}>
        {LABELS[event] ?? event}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 13, color, fontWeight: 600 }}>{count.toLocaleString()}</span>
        <span style={{ fontSize: 11, color: '#475569' }}>messages</span>
      </div>
    </div>
  )
}

const GradientDefs = () => (
  <defs>
    <linearGradient id="volDirect" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.9} />
      <stop offset="100%" stopColor="#7f1d1d" stopOpacity={0.7} />
    </linearGradient>
    <linearGradient id="volNews" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
      <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.7} />
    </linearGradient>
    <linearGradient id="volSocial" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
      <stop offset="100%" stopColor="#4c1d95" stopOpacity={0.7} />
    </linearGradient>
  </defs>
)

const GRAD_IDS = { direct: 'url(#volDirect)', news: 'url(#volNews)', social: 'url(#volSocial)' }

export default function VolumeChart({ data }) {
  if (!data?.length) return null

  const enriched = data.map((d) => ({ ...d, label: LABELS[d.event] ?? d.event }))

  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={enriched} margin={{ top: 28, right: 8, left: 0, bottom: 4 }} barSize={52} barCategoryGap="35%">
        <GradientDefs />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: '#475569' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#334155' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
          width={32}
        />
        <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.025)', radius: 4 }} />
        <Bar dataKey="count" radius={[7, 7, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
          {enriched.map((entry) => (
            <Cell key={entry.event} fill={GRAD_IDS[entry.event] ?? '#f97316'} />
          ))}
          <LabelList
            dataKey="count"
            position="top"
            style={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
            formatter={(v) => v.toLocaleString()}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
