/** Small shared primitives: skeletons, states, page headers. */

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'

export function Skeleton({ height = 16, width = '100%', style }) {
  return (
    <div
      className="skeleton"
      style={{ height, width, ...style }}
      aria-hidden="true"
      data-testid="skeleton"
    />
  )
}

export function SkeletonCard({ lines = 3, height = 200 }) {
  return (
    <div className="card" aria-busy="true">
      <Skeleton height={14} width="38%" />
      <div style={{ height: 12 }} />
      <Skeleton height={height} />
      <div style={{ height: 12 }} />
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} style={{ marginTop: 8 }}>
          <Skeleton height={10} width={`${90 - index * 15}%`} />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ message, onRetry, compact = false }) {
  return (
    <div
      className="card"
      role="alert"
      style={{
        borderColor: 'color-mix(in srgb, var(--severity-critical) 45%, transparent)',
        padding: compact ? 'var(--space-3)' : 'var(--space-4)',
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <AlertTriangle size={16} color="var(--severity-critical)" aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 180 }}>
          <p style={{ fontWeight: 600 }}>Could not load this data</p>
          <p className="text-sm secondary">{message}</p>
        </div>
        {onRetry && (
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            <RefreshCw size={13} aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

export function EmptyState({ message, icon: Icon = Inbox, children }) {
  return (
    <div className="empty-state">
      <Icon size={22} aria-hidden="true" />
      <p>{message}</p>
      {children}
    </div>
  )
}

export function PageHeader({ title, description, actions }) {
  return (
    <header className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div style={{ minWidth: 240, flex: 1 }}>
        <h1>{title}</h1>
        {description && (
          <p className="text-sm secondary" style={{ marginTop: 4, maxWidth: '68ch' }}>
            {description}
          </p>
        )}
      </div>
      {actions}
    </header>
  )
}
