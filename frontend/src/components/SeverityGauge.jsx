import { useEffect, useRef, useState } from 'react'
import { severityMeta } from '../lib/format'

const RADIUS = 62
const CIRCUMFERENCE = Math.PI * RADIUS // half circle

/**
 * Animated half-circle severity gauge.
 *
 * The score animates from the previous value unless the user prefers reduced
 * motion, and the level is stated with an icon and a word as well as a colour.
 */
export function SeverityGauge({ score = 0, level = 'low', size = 180 }) {
  const meta = severityMeta(level)
  const Icon = meta.icon
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  const [animated, setAnimated] = useState(0)
  const frame = useRef()
  const previous = useRef(0)

  useEffect(() => {
    if (reduced) return undefined
    const from = previous.current
    const start = performance.now()
    const duration = 650
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      const value = from + (score - from) * eased
      previous.current = value
      setAnimated(value)
      if (progress < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [score, reduced])

  // Reduced motion renders the final value directly, with no animation state.
  const displayed = reduced ? score : animated
  const fraction = Math.max(0, Math.min(100, displayed)) / 100
  const height = size * 0.62

  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        width={size}
        height={height}
        viewBox="0 0 150 86"
        role="img"
        aria-label={`Severity ${meta.label}, score ${Math.round(score)} out of 100`}
      >
        <path
          d={`M 13 75 A ${RADIUS} ${RADIUS} 0 0 1 137 75`}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="13"
          strokeLinecap="round"
        />
        <path
          d={`M 13 75 A ${RADIUS} ${RADIUS} 0 0 1 137 75`}
          fill="none"
          stroke={`var(${meta.varName})`}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE}`}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
        <text
          x="75"
          y="64"
          textAnchor="middle"
          fontSize="30"
          fontWeight="700"
          fill="var(--text)"
        >
          {Math.round(displayed)}
        </text>
        <text x="75" y="78" textAnchor="middle" fontSize="9" fill="var(--text-muted)">
          of 100
        </text>
      </svg>
      <figcaption className={`chip ${meta.className}`} style={{ marginTop: 6 }}>
        <Icon size={14} aria-hidden="true" />
        {meta.label} severity
      </figcaption>
    </figure>
  )
}

export default SeverityGauge
