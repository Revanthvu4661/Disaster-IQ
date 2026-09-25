import { CircleSlash } from 'lucide-react'

/**
 * Metrics the brief asks for that the sources do not contain, each with the
 * reason. Shown where a reader would expect the number, instead of a zero or
 * an estimate.
 */
export function UnavailableList({ items, title = 'Not in the data' }) {
  if (!items?.length) return null
  return (
    <div className="unavailable">
      <p className="field-label">{title}</p>
      <ul>
        {items.map((item) => (
          <li key={item.metric}>
            <CircleSlash size={14} aria-hidden="true" />
            <span>
              <strong>{item.metric}:</strong> {item.reason}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default UnavailableList
