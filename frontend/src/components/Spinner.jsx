export default function Spinner({ size = 'md', label }) {
  const px = size === 'sm' ? 16 : size === 'lg' ? 40 : 24
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 0' }}>
      <svg
        width={px} height={px}
        viewBox="0 0 24 24" fill="none"
        style={{ animation: 'spin 0.9s linear infinite', color: '#ef4444' }}
      >
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.15" />
        <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label && <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>{label}</p>}
    </div>
  )
}
