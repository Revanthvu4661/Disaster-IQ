import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

const ToastContext = createContext(null)
const DEFAULT_DURATION = 6000

const ICONS = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (message, { type = 'info', duration = DEFAULT_DURATION } = {}) => {
      counter.current += 1
      const id = counter.current
      setToasts((current) => [...current, { id, message, type }])
      if (duration > 0) window.setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({
      push,
      dismiss,
      error: (message, options) => push(message, { ...options, type: 'error' }),
      success: (message, options) => push(message, { ...options, type: 'success' }),
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type] ?? Info
          return (
            <div
              key={toast.id}
              className={`toast toast-${toast.type}`}
              role={toast.type === 'error' ? 'alert' : 'status'}
            >
              <Icon size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ flex: 1 }}>{toast.message}</span>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 24, height: 24 }}
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside a ToastProvider')
  return context
}
