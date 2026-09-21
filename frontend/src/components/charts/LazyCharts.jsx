import { Suspense, lazy } from 'react'
import { Skeleton } from '../ui'

/**
 * Lazy chart wrappers.
 *
 * Recharts is the largest dependency in the bundle (~114 KB gzipped). Loading
 * it on the critical path delayed first paint on a throttled connection, so
 * each chart is split into its own chunk and swapped in behind a skeleton once
 * the data and the library have both arrived.
 */
const load = () => import('./Charts')

const CategoryBarChartLazy = lazy(() =>
  load().then((module) => ({ default: module.CategoryBarChart })),
)
const SimpleBarChartLazy = lazy(() =>
  load().then((module) => ({ default: module.SimpleBarChart })),
)
const GroupedBarChartLazy = lazy(() =>
  load().then((module) => ({ default: module.GroupedBarChart })),
)
const SimpleLineChartLazy = lazy(() =>
  load().then((module) => ({ default: module.SimpleLineChart })),
)

const withFallback = (Component) =>
  function LazyChart(props) {
    return (
      <Suspense fallback={<Skeleton height={props.height ?? 260} />}>
        <Component {...props} />
      </Suspense>
    )
  }

export const CategoryBarChart = withFallback(CategoryBarChartLazy)
export const SimpleBarChart = withFallback(SimpleBarChartLazy)
export const GroupedBarChart = withFallback(GroupedBarChartLazy)
export const SimpleLineChart = withFallback(SimpleLineChartLazy)
