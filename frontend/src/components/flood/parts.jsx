import { formatProbability, levelLabel } from '../../lib/risk'

/** A risk level as a coloured pill; the text always names the level. */
export function RiskPill({ level, probability, compact = false }) {
  return (
    <span className={`risk-pill risk-${level}`}>
      <span className="risk-dot" aria-hidden="true" />
      {levelLabel(level)}
      {typeof probability === 'number' && !compact && (
        <span className="risk-pill-prob">{formatProbability(probability)}</span>
      )}
    </span>
  )
}

/** Latest 30 days, or a back-test month replayed through the 1981-2012 model. */
export function ScenarioSwitch({ scenarios, value, onChange, label = 'Scenario' }) {
  return (
    <div className="seg seg-wrap" role="group" aria-label={label}>
      {scenarios.map((item) => (
        <button
          key={item.id}
          type="button"
          className="seg-btn"
          aria-pressed={value === item.id}
          onClick={() => onChange(item.id)}
          title={item.detail}
        >
          {item.kind === 'current' ? 'Latest 30 days' : `${item.label}${item.expect === 'quiet' ? ' (quiet)' : ''}`}
        </button>
      ))}
    </div>
  )
}

/**
 * Each feature's contribution to the log-odds, as bars either side of a
 * centre line: right raises the risk, left lowers it. The number and the words
 * carry the meaning; the bar is decorative.
 */
export function FactorBars({ factors, format }) {
  const max = Math.max(...factors.map((f) => Math.abs(f.contribution)), 0.01)
  return (
    <ul className="factor-bars" aria-label="Contribution of each input to the risk">
      {factors.map((factor) => {
        const width = (Math.abs(factor.contribution) / max) * 50
        const raises = factor.contribution > 0
        return (
          <li key={factor.key} className="factor-row">
            <span className="factor-label">
              <strong>{factor.label}</strong>
              <span className="factor-value">{format(factor)}</span>
            </span>
            <span className="factor-track" aria-hidden="true">
              <span className="factor-axis" />
              <span
                className={`factor-fill ${raises ? 'factor-up' : 'factor-down'}`}
                style={raises ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
              />
            </span>
            <span className={`factor-effect ${raises ? 'factor-up-text' : 'factor-down-text'}`}>
              {raises ? '+' : '−'}
              {Math.abs(factor.contribution).toFixed(2)} {raises ? 'raises' : 'lowers'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Feature value in words, for tables and the factor bars. */
export function formatFeature(key, value) {
  if (typeof value !== 'number') return '—'
  switch (key) {
    case 'rain_pct_normal':
      return `${Math.round(value)}% of normal`
    case 'max_3day_rain_mm':
      return `${Math.round(value)} mm`
    case 'soil_wetness_before':
      return value.toFixed(2)
    case 'elevation_m':
      return `${Math.round(value)} m`
    case 'prior_flood_rate':
      return `${Math.round(value * 100)}% of past seasons`
    default:
      return String(value)
  }
}
