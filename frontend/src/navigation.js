import {
  BrainCircuit,
  Gauge,
  Info,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Radar,
} from 'lucide-react'

/** Single source of truth for routes, used by the shell and the palette. */
export const NAV_ITEMS = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Corpus overview',
    end: true,
  },
  { to: '/insights', label: 'Insights', icon: Lightbulb, description: 'Deep analytics' },
  { to: '/predict', label: 'Predict', icon: BrainCircuit, description: 'Classify a message' },
  { to: '/triage', label: 'Triage Inbox', icon: ListChecks, description: 'Batch triage' },
  { to: '/hazards', label: 'Live Hazards', icon: Radar, description: 'Open feeds' },
  { to: '/model', label: 'Model', icon: Gauge, description: 'Performance and card' },
  { to: '/about', label: 'About', icon: Info, description: 'Data and credits' },
]
