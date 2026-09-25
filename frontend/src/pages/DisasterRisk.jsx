import { ShieldCheck } from 'lucide-react'
import { DisasterHeader } from '../components/DisasterHeader'
import SourceBadge from '../components/SourceBadge'
import LevelChain from '../components/LevelChain'
import TypeSwitch from '../components/hazard/TypeSwitch'
import { disasterVar } from '../config/disasterTypes'
import { useHazard } from '../hooks/useHazard'
import FloodRiskView from './risk/FloodRiskView'
import IndexRiskView from './risk/IndexRiskView'

const INFO = {
  earthquake: {
    definition:
      'How often damaging earthquakes have struck near each Indian state, from the USGS catalogue: a statistical index with four risk levels.',
    eyebrow: 'Level 2 · Prediction · Indian states',
    badges: <SourceBadge kind="index" source="usgs" />,
  },
  flood: {
    definition:
      'The probability that a flood is recorded in each district of Kerala, from the last 30 days of rainfall and soil moisture, elevation and flood history: a trained model.',
    eyebrow: 'Level 2 · Prediction · Kerala districts',
    badges: (
      <>
        <SourceBadge kind="model" source={['ifi', 'nasa_power']} />
        <SourceBadge source={['elevation', 'census2011']} />
      </>
    ),
  },
  cyclone: {
    definition:
      'How often hurricane- and tropical-storm-strength cyclones have passed near each Indian state, from NOAA IBTrACS tracks: a statistical index with four risk levels.',
    eyebrow: 'Level 2 · Prediction · Indian states',
    badges: <SourceBadge kind="index" source="ibtracs" />,
  },
}

/**
 * Level 2 for all three hazards. The selector switches between the flood model
 * (a trained classifier, Kerala districts) and the earthquake and cyclone
 * indices (catalogue statistics, Indian states). All three use the same four
 * risk levels, map and table, and each states its own method.
 */
export default function DisasterRisk() {
  const [hazard, setHazard] = useHazard()
  const info = INFO[hazard]
  return (
    <div className="stack disaster-page" style={{ '--dt': disasterVar(hazard) }}>
      <DisasterHeader
        type={{ id: hazard, icon: ShieldCheck, label: 'Disaster Risk Prediction', definition: info.definition }}
        eyebrow={info.eyebrow}
        badges={info.badges}
        actions={null}
      />
      <TypeSwitch value={hazard} onChange={setHazard} />
      <LevelChain current="predict" hazard={hazard} />
      {hazard === 'flood' ? <FloodRiskView /> : <IndexRiskView key={hazard} hazard={hazard} />}
    </div>
  )
}
