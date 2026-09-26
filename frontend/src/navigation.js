import { Globe2, LayoutDashboard, LifeBuoy, ShieldCheck, Siren, Telescope } from 'lucide-react'
import { DISASTER_TYPES } from './config/disasterTypes'

/**
 * Primary navigation, in the fixed order of the information architecture:
 * Overview, the three disaster types, World Map, the Pre-Prediction outlook,
 * then the problem statement's
 * Level 2 (Disaster Risk Prediction) and Level 3 (Preparedness & Response
 * Recommendations), named in its own words. The disaster entries are generated from the shared
 * taxonomy, never listed here.
 */
export const NAV_ITEMS = [
  {
    to: '/',
    label: 'Overview',
    icon: LayoutDashboard,
    description: 'The three disasters compared',
    end: true,
    section: 'overview',
  },
  ...DISASTER_TYPES.map((type) => ({
    to: type.path,
    label: type.label,
    icon: type.icon,
    description: 'Historical impact, trends and geography',
    disasterId: type.id,
    section: 'disasters',
  })),
  { to: '/map', label: 'World Map', icon: Globe2, description: 'Live and historical events', section: 'map' },
  {
    to: '/pre-prediction',
    label: 'Pre-Prediction',
    icon: Telescope,
    description: 'Short-range outlook: history, season and live weather',
    section: 'pre-predict',
  },
  {
    to: '/risk',
    label: 'Disaster Risk Prediction',
    icon: ShieldCheck,
    description: 'Level 2: earthquake, flood and cyclone risk levels',
    section: 'predict',
  },
  {
    to: '/preparedness',
    label: 'Preparedness & Response Recommendations',
    icon: LifeBuoy,
    description: 'Level 3: preparedness actions and response resources',
    section: 'recommend',
  },
  {
    to: '/action-hub',
    label: 'Action Hub',
    icon: Siren,
    description: 'Assign tasks to responders and track readiness',
    section: 'act',
  },
]
