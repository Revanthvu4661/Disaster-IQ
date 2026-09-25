import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, LifeBuoy, ShieldCheck } from 'lucide-react'
import { getDisasterType } from '../config/disasterTypes'

/**
 * The Analyze -> Predict -> Recommend chain as three linked steps, for one
 * hazard. The current step is marked with aria-current; the others are links,
 * so a reader can walk the chain from any of the three pages and stay on the
 * same hazard (`?type=` carries it).
 */
export function LevelChain({ current, hazard = 'flood' }) {
  const type = getDisasterType(hazard)
  const steps = [
    { id: 'analyze', level: 'Level 1 · Analytics', title: `${type.label} history`, to: type.path, icon: BarChart3,
      link: `See ${type.shortLabel.toLowerCase()} history` },
    { id: 'predict', level: 'Level 2 · Prediction', title: 'Disaster Risk Prediction',
      to: `/risk?type=${hazard}`, icon: ShieldCheck, link: `See ${type.shortLabel.toLowerCase()} risk prediction` },
    { id: 'recommend', level: 'Level 3 · Recommendation', title: 'Preparedness & Response',
      to: `/preparedness?type=${hazard}`, icon: LifeBuoy, link: 'See recommended preparedness and response' },
  ]
  return (
    <nav className="level-chain" aria-label="Analyze, predict, recommend" style={{ '--chain': `var(--dt-${hazard})`, '--chain-soft': `var(--dt-${hazard}-soft)` }}>
      <ol>
        {steps.map((step, index) => {
          const Icon = step.icon
          const here = step.id === current
          const body = (
            <>
              {/* Large "L1" numeral: shown instead of the icon by the disaster-page themes only. */}
              <span className="level-chain-badge" aria-hidden="true">
                L{index + 1}
              </span>
              <span className="level-chain-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="level-chain-text">
                <span className="level-chain-level">{step.level}</span>
                <span className="level-chain-title">{here ? step.title : step.link}</span>
              </span>
              {!here && <ArrowRight size={14} aria-hidden="true" className="level-chain-arrow" />}
            </>
          )
          return (
            <li key={step.id} className={here ? 'is-current' : undefined}>
              {here ? (
                <span className="level-chain-step" aria-current="step">
                  {body}
                </span>
              ) : (
                <Link className="level-chain-step" to={step.to}>
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default LevelChain
