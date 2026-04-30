import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store.js'
import { useTheme } from '../theme.jsx'

export default function Profile() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const { pref, resolved, setPref } = useTheme()

  const themes = [
    { id: 'light',  label: 'Light',  hint: 'Always light' },
    { id: 'dark',   label: 'Dark',   hint: 'Always dark' },
    { id: 'system', label: 'System', hint: 'Match OS' },
  ]

  return (
    <div className="page" style={{ padding: '0 0 calc(2rem + var(--safe-bottom))' }}>
      <header style={S.header}>
        <button className="btn-ghost" style={S.back} onClick={() => nav(-1)}>‹</button>
        <h1 style={S.title}>Profile</h1>
      </header>

      <div style={{ padding: '0 1rem' }}>
        <div className="card" style={{ marginBottom: 14 }}>
          <p style={S.row}>
            <span style={S.label}>Name</span>
            <span>{user?.full_name || '—'}</span>
          </p>
          <p style={S.row}>
            <span style={S.label}>Email</span>
            <span>{user?.email}</span>
          </p>
          <p style={S.row}>
            <span style={S.label}>Role</span>
            <span>{user?.is_admin ? 'Admin' : 'Player'}</span>
          </p>
        </div>

        <p style={S.section}>Theme</p>
        <div className="card">
          <div style={S.themeRow}>
            {themes.map((t) => (
              <button
                key={t.id}
                style={{ ...S.themeBtn, ...(pref === t.id ? S.themeBtnActive : {}) }}
                onClick={() => setPref(t.id)}
              >
                <span style={S.themeLabel}>{t.label}</span>
                <span style={S.themeHint}>{t.hint}</span>
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
            Currently: {resolved}{pref === 'system' ? ' (from OS)' : ''}
          </p>
        </div>

        <button
          className="btn btn-danger"
          style={{ marginTop: 24, width: '100%' }}
          onClick={() => { clearAuth(); nav('/login', { replace: true }) }}
        >Sign out</button>
      </div>
    </div>
  )
}

const S = {
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '1rem 1rem 1rem' },
  back: { fontSize: 26, color: 'var(--text-secondary)', padding: '0 6px' },
  title: { fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text-primary)', margin: 0 },
  row: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, color: 'var(--text-primary)' },
  label: { color: 'var(--text-muted)' },
  section: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '14px 4px 8px' },
  themeRow: { display: 'flex', gap: 6 },
  themeBtn: {
    flex: 1, padding: '12px 8px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)', background: 'var(--surface-2)',
    display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center',
    color: 'var(--text-primary)',
  },
  themeBtnActive: { background: 'var(--green-600)', color: '#fff', borderColor: 'var(--green-500)' },
  themeLabel: { fontSize: 14, fontWeight: 600 },
  themeHint: { fontSize: 11, opacity: 0.8 },
}
