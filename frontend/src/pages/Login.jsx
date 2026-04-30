import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api.js'
import { useAuthStore } from '../store.js'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const setAuth = useAuthStore((s) => s.setAuth)
  const nav = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register'
      const body = mode === 'login'
        ? { email, password }
        : { email, password, full_name: fullName }
      const { data } = await api.post(path, body)
      setAuth(data.access_token, data.user)
      nav('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page" style={S.wrap}>
      <div style={S.brand}>
        <div style={S.logo}>⛳</div>
        <h1 style={S.title}>Birdie</h1>
        <p style={S.subtitle}>Self-hosted golf tracker</p>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <div style={S.tabs}>
          <button
            style={{ ...S.tab, ...(mode === 'login' ? S.tabActive : {}) }}
            onClick={() => setMode('login')}
            type="button"
          >Sign in</button>
          <button
            style={{ ...S.tab, ...(mode === 'register' ? S.tabActive : {}) }}
            onClick={() => setMode('register')}
            type="button"
          >Create account</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div className="input-row">
              <label>Full name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}
          <div className="input-row">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="input-row">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && (
            <p style={S.error}>{error}</p>
          )}

          <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {mode === 'register' && (
          <p style={S.hint}>The first registered user automatically becomes the admin.</p>
        )}
      </div>
    </div>
  )
}

const S = {
  wrap: { padding: '2rem 1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100dvh' },
  brand: { textAlign: 'center', marginBottom: 28 },
  logo: { fontSize: 48, marginBottom: 6 },
  title: { fontFamily: 'var(--font-display)', fontSize: 36, color: 'var(--text-primary)', margin: 0 },
  subtitle: { color: 'var(--text-muted)', marginTop: 4, fontSize: 14 },
  tabs: { display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--border)' },
  tab: { flex: 1, padding: '10px 8px', fontSize: 14, color: 'var(--text-muted)', borderBottom: '2px solid transparent' },
  tabActive: { color: 'var(--green-300)', borderBottom: '2px solid var(--green-500)' },
  error: { color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' },
  hint: { fontSize: 12, color: 'var(--text-muted)', marginTop: 14, textAlign: 'center' },
}
