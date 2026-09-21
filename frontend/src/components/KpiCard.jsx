import { useEffect, useRef, useState } from 'react'

/**
 * KpiCard
 * Props:
 *   title       string
 *   value       string | number   — displayed large
 *   sub         string            — small line below value
 *   icon        ReactNode         — lucide-react icon element
 *   variant     'default' | 'accent' | 'danger'
 *   highlight   string[]          — tag pills below value
 */

function useCountUp(target, duration = 900) {
  const [display, setDisplay] = useState(0)
  const raw = typeof target === 'string' ? parseInt(target.replace(/,/g, ''), 10) : target
  const isNumber = !isNaN(raw) && typeof raw === 'number' && target !== ''

  useEffect(() => {
    if (!isNumber) return
    const start = performance.now()
    const tick = (now) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(raw * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [raw, duration, isNumber])

  if (!isNumber) return target
  return display.toLocaleString()
}

const VARIANTS = {
  default: {
    bg:     '#12131a',
    border: 'rgba(255,255,255,0.07)',
    hover:  'rgba(255,255,255,0.11)',
    iconBg: 'rgba(255,255,255,0.06)',
    iconColor: '#94a3b8',
    valColor:  '#f1f5f9',
  },
  accent: {
    bg:     'linear-gradient(145deg,rgba(239,68,68,0.10) 0%,rgba(18,19,26,1) 60%)',
    border: 'rgba(239,68,68,0.22)',
    hover:  'rgba(239,68,68,0.35)',
    iconBg: 'rgba(239,68,68,0.15)',
    iconColor: '#f87171',
    valColor:  '#f87171',
  },
  danger: {
    bg:     'linear-gradient(145deg,rgba(239,68,68,0.13) 0%,rgba(18,19,26,1) 60%)',
    border: 'rgba(239,68,68,0.3)',
    hover:  'rgba(239,68,68,0.45)',
    iconBg: 'rgba(239,68,68,0.18)',
    iconColor: '#ef4444',
    valColor:  '#ef4444',
    pulse:  true,
  },
}

export default function KpiCard({ title, value, sub, icon, variant = 'default', highlight, className = '' }) {
  const v = VARIANTS[variant] ?? VARIANTS.default
  const displayVal = useCountUp(value)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={`fade-up ${className} ${v.pulse ? 'pulse-danger' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: v.bg,
        border: `1px solid ${hovered ? v.hover : v.border}`,
        borderRadius: 16,
        padding: '22px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.15s',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hovered ? '0 8px 32px rgba(0,0,0,0.45)' : '0 2px 8px rgba(0,0,0,0.2)',
        cursor: 'default',
      }}
    >
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <p style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: '#475569',
          margin: 0,
        }}>
          {title}
        </p>
        {icon && (
          <span style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: v.iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: v.iconColor,
            flexShrink: 0,
          }}>
            {icon}
          </span>
        )}
      </div>

      {/* value */}
      <div>
        {value !== '' && (
          <p
            className="count-reveal"
            style={{
              fontSize: 34,
              fontWeight: 800,
              letterSpacing: '-1px',
              color: v.valColor,
              margin: 0,
              lineHeight: 1,
            }}
          >
            {displayVal}
          </p>
        )}
        {sub && (
          <p style={{ fontSize: 12, color: '#475569', margin: '6px 0 0', lineHeight: 1.4 }}>
            {sub}
          </p>
        )}
        {highlight && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
            {highlight.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 11,
                  padding: '3px 9px',
                  borderRadius: 99,
                  background: 'rgba(239,68,68,0.1)',
                  color: '#f87171',
                  border: '1px solid rgba(239,68,68,0.2)',
                  textTransform: 'capitalize',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
