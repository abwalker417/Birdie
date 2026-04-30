import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api.js'
import { useAuthStore, useRoundStore } from '../store.js'

export default function Home() {
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const setActiveRound = useRoundStore((s) => s.setActiveRound)
  const setHolesData = useRoundStore((s) => s.setHolesData)
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const nav = useNavigate()

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/rounds/')
      setRounds(data)
      setError(null)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load rounds')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function resumeRound(r) {
    try {
      const { data: holes } = await api.get(`/courses/${r.course_id}/holes`)
      setHolesData(holes)
      setActiveRound({ id: r.id, course_id: r.course_id, course_name: r.course_name, tee_colour: r.tee_colour })
      nav(`/round/${r.id}`)
    } catch (err) {
      alert('Could not resume that round')
    }
  }

  async function deleteRound(r) {
    if (!confirm(`Delete round at ${r.course_name}? This cannot be undone.`)) return
    try {
      await api.delete(`/rounds/${r.id}`)
      setRounds((rs) => rs.filter((x) => x.id !== r.id))
    } catch (err) {
      alert(err.response?.data?.detail || 'Delete failed')
    }
  }

  function logout() {
    clearAuth()
    nav('/login', { replace: true })
  }

  return (
    <div className="page" style={{ padding: '0 0 calc(2rem + var(--safe-bottom))' }}>
      <header style={S.header}>
        <div>
          <h1 style={S.title}>Birdie</h1>
          <p style={S.subtitle}>
            Welcome{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
            {user?.is_admin ? ' · Admin' : ''}
          </p>
        </div>
        <button className="btn-ghost" onClick={() => nav('/profile')} aria-label="Profile">⚙</button>
      </header>

      <div style={S.actionRow}>
        <button className="btn" onClick={() => nav('/courses')} style={{ flex: 1 }}>
          ⛳ Start a round
        </button>
        <button className="btn btn-secondary" onClick={logout}>Sign out</button>
      </div>

      <section style={{ padding: '0 1rem' }}>
        <h2 style={S.sectionTitle}>Your rounds</h2>

        {loading && <p style={S.muted}>Loading…</p>}
        {error && <p style={S.error}>{error}</p>}
        {!loading && rounds.length === 0 && (
          <p style={S.muted}>No rounds yet — start one above.</p>
        )}

        {rounds.map((r) => {
          const dateStr = new Date(r.started_at).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
          })
          const diff = r.score_to_par
          const diffStr = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`)
          const diffColour = diff < 0 ? 'var(--green-300)' : diff > 0 ? 'var(--danger)' : 'var(--text-secondary)'
          return (
            <div key={r.id} className="card" style={S.roundCard}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={S.roundName}>{r.course_name}</p>
                <p style={S.roundMeta}>
                  {dateStr} · {r.is_complete ? 'Final' : 'In progress'}
                  {r.total_strokes > 0 && ` · ${r.total_strokes} strokes`}
                </p>
              </div>
              {r.total_strokes > 0 && (
                <div style={{ textAlign: 'right', marginRight: 12 }}>
                  <p style={{ ...S.scoreNum, color: diffColour }}>{diffStr}</p>
                  <p style={S.muted}>vs par {r.course_par}</p>
                </div>
              )}
              <div style={S.roundActions}>
                {!r.is_complete && (
                  <button className="btn-ghost" style={S.iconBtn} onClick={() => resumeRound(r)} title="Resume">▶</button>
                )}
                <button className="btn-ghost" style={{ ...S.iconBtn, color: 'var(--danger)' }} onClick={() => deleteRound(r)} title="Delete round">🗑</button>
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

const S = {
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '1.25rem 1rem 0.5rem',
  },
  title: { fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text-primary)', margin: 0 },
  subtitle: { color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' },
  actionRow: { display: 'flex', gap: 10, padding: '0 1rem 1rem' },
  sectionTitle: {
    fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: '0.08em', marginTop: 14, marginBottom: 10,
  },
  muted: { color: 'var(--text-muted)', fontSize: 13 },
  error: { color: 'var(--danger)', fontSize: 13 },
  roundCard: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 14px', marginBottom: 10,
  },
  roundName: { fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' },
  roundMeta: { fontSize: 12, color: 'var(--text-muted)', marginTop: 2 },
  scoreNum: { fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600 },
  roundActions: { display: 'flex', gap: 4 },
  iconBtn: {
    width: 36, height: 36, borderRadius: '50%',
    background: 'var(--surface-2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16,
  },
}
