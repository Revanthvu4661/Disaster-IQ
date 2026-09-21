import { useEffect, useRef, useState } from 'react'
import { SkeletonCard } from './ui'

/**
 * Renders children only once they are near the viewport.
 *
 * The dashboard's heatmaps and grouped charts add hundreds of SVG nodes each;
 * mounting them all on load pushed largest-contentful-paint and total blocking
 * time well past target on a throttled phone. Deferring them keeps the first
 * screen cheap without changing what the page eventually shows.
 *
 * Browsers without IntersectionObserver render immediately.
 */
export function Deferred({ children, height = 260, rootMargin = '320px' }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )

  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') return undefined
    const element = ref.current
    if (!element) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible, rootMargin])

  if (visible) return children

  // Placeholder of the same height, so deferring does not shift the layout.
  return (
    <div ref={ref} aria-hidden="true">
      <SkeletonCard height={height} lines={1} />
    </div>
  )
}

export default Deferred
