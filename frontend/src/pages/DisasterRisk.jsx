import { ShieldCheck } from 'lucide-react'
import { DisasterHeader } from '../components/DisasterHeader'
import SourceBadge from '../components/SourceBadge'
import LevelChain from '../components/LevelChain'
import TypeSwitch from '../components/hazard/TypeSwitch'
import { disasterVar } from '../config/disasterTypes'
import { useHazard } from '../hooks/useHazard'
import { HazardMotif } from '../components/hazard/HazardHero'
import FloodRiskView from './risk/FloodRiskView'
import IndexRiskView from './risk/IndexRiskView'
import '../styles/hazard-themes.css'
import '../styles/level-themes.css'

const INFO = {
  earthquake: {
    definition:
      'How often damaging earthquakes have struck near each Indian state, from the USGS catalogue: a statistical index with four risk levels.',
    eyebrow: 'Level 2 · Prediction · Indian states',
    badges: <SourceBadge kind="index" source="usgs" />,
  },
  flood: {
    definition:
      'The probability that a flood is recorded in each district of India, from the last 30 days of rainfall and soil moisture, elevation, state and flood history: a trained model.',
    eyebrow: 'Level 2 · Prediction · Indian districts',
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
 * (a trained classifier, Indian districts) and the earthquake and cyclone
 * indices (catalogue statistics, Indian states). All three use the same four
 * risk levels, map and table, and each states its own method.
 *
 * The root's `data-hazard` follows the selector (not the route), so the
 * hazard theme (styles/hazard-themes.css, level-themes.css) changes with it.
 */
export default function DisasterRisk() {
  const [hazard, setHazard] = useHazard()
  const info = INFO[hazard]
  return (
    <div className="hazard-page level-page" data-hazard={hazard}>
      <div className="stack disaster-page" style={{ '--dt': disasterVar(hazard) }}>
        <DisasterHeader
          type={{ id: hazard, icon: ShieldCheck, label: 'Disaster Risk Prediction', definition: info.definition }}
          eyebrow={info.eyebrow}
          badges={info.badges}
          actions={null}
          panel={<HazardMotif hazard={hazard} />}
        />
        <TypeSwitch value={hazard} onChange={setHazard} />
        <LevelChain current="predict" hazard={hazard} />
        {hazard === 'flood' ? <FloodRiskView /> : <IndexRiskView key={hazard} hazard={hazard} />}
      </div>
    </div>
  )
}
