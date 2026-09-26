import { Suspense, lazy } from 'react'
import { Skeleton } from '../ui'

/**
 * Lazy chart wrappers.
 *
 * Recharts is the largest dependency in the bundle (~114 KB gzipped). Loading
 * it on the critical path delayed first paint on a throttled connection, so
 * the charts are split into their own chunk and swapped in behind a skeleton
 * once the data and the library have both arrived.
 */
const load = () => import('./Charts')

const lazyNamed = (name) => lazy(() => load().then((module) => ({ default: module[name] })))

const withFallback = (Component) =>
  function LazyChart(props) {
    return (
      <Suspense fallback={<Skeleton height={props.height ?? 260} />}>
        <Component {...props} />
      </Suspense>
    )
  }

export const YearBars = withFallback(lazyNamed('YearBars'))
export const CategoryBars = withFallback(lazyNamed('CategoryBars'))
export const StackedBars = withFallback(lazyNamed('StackedBars'))
export const ScatterLog = withFallback(lazyNamed('ScatterLog'))
export const MultiLines = withFallback(lazyNamed('MultiLines'))
