/** Shared formatting helpers and the severity display language. */

import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from 'lucide-react'

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']

/** Severity never relies on colour alone: each level carries an icon and label. */
export const SEVERITY = {
  low: { label: 'Low', icon: ShieldCheck, varName: '--severity-low', className: 'sev-low' },
  medium: { label: 'Medium', icon: Info, varName: '--severity-medium', className: 'sev-medium' },
  high: { label: 'High', icon: AlertTriangle, varName: '--severity-high', className: 'sev-high' },
  critical: {
    label: 'Critical',
    icon: AlertOctagon,
    varName: '--severity-critical',
    className: 'sev-critical',
  },
}

export const severityMeta = (level) => SEVERITY[level] ?? SEVERITY.low

export const titleCase = (value = '') =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())

export const humanCategory = (value = '') => value.replace(/_/g, ' ')

export const formatNumber = (value) =>
  typeof value === 'number' ? value.toLocaleString() : '—'

export const formatPercent = (value, digits = 1) =>
  typeof value === 'number' ? `${(value * 100).toFixed(digits)}%` : '—'

export const formatDelta = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

/** Chart series colours, read from the design tokens. */
export const SERIES_VARS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
]

export const seriesColor = (index) => SERIES_VARS[index % SERIES_VARS.length]
