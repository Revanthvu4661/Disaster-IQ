import { useSearchParams } from 'react-router-dom'

export const HAZARDS = ['earthquake', 'flood', 'cyclone']

/**
 * The selected hazard for the Disaster Risk Prediction and Preparedness &
 * Response pages, kept in the URL (`?type=cyclone`) so the chain between the
 * three levels, and a shared link, stay on the same hazard. Defaults to flood.
 */
export function useHazard() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('type')
  const hazard = HAZARDS.includes(raw) ? raw : 'flood'
  const setHazard = (id) => setParams({ type: id }, { replace: true })
  return [hazard, setHazard]
}
