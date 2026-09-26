import { useEffect, useState } from 'react'

/**
 * Marks the section chip whose block is in view (aria-current), so the chip
 * bar doubles as a "you are here" marker. Without IntersectionObserver the
 * chips simply stay plain links. Pass `enabled` only once the sections are
 * in the DOM; toggling it re-observes them.
 */
export function useSectionInView(ids, enabled) {
  const [current, setCurrent] = useState(ids[0])
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return undefined
    const visible = new Map()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting))
        const first = ids.find((id) => visible.get(id))
        if (first) setCurrent(first)
      },
      { rootMargin: '-90px 0px -55% 0px' },
    )
    ids.forEach((id) => {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    })
    return () => observer.disconnect()
  }, [ids, enabled])
  return current
}

export default useSectionInView
