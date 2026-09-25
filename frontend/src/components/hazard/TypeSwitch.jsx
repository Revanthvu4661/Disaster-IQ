import { DISASTER_TYPES, disasterVar } from '../../config/disasterTypes'

/**
 * The hazard selector at the top of the Level 2 and Level 3 pages: Earthquake,
 * Flood, Cyclone/Hurricane, in the app's disaster colours.
 */
export function TypeSwitch({ value, onChange, label = 'Disaster type' }) {
  return (
    <div className="type-switch" role="group" aria-label={label}>
      {DISASTER_TYPES.map((type) => {
        const Icon = type.icon
        return (
          <button
            key={type.id}
            type="button"
            className="type-switch-btn"
            aria-pressed={value === type.id}
            onClick={() => onChange(type.id)}
            style={{ '--tab-color': disasterVar(type.id) }}
          >
            <Icon size={16} aria-hidden="true" />
            {type.label}
          </button>
        )
      })}
    </div>
  )
}

export default TypeSwitch
