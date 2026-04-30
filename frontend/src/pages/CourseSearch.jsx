import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api.js'
import { useGPS } from '../hooks/useGPS.js'
import { useAuthStore, useRoundStore } from '../store.js'

const RADIUS_OPTIONS = [
  { label: '5 mi',  value: 8047  },
  { label: '10 mi', value: 16093 },
  { label: '25 mi', value: 40234 },
  { label: '50 mi', value: 80467 },
]
const TEE_COLOURS = ['white', 'yellow', 'red', 'blue', 'black', 'green']

export default function CourseSearch() {
  const { position, error: gpsError } = useGPS()
  const isAdmin = useAuthStore((s) => s.user?.is_admin)
  const setActiveRound = useRoundStore((s) => s.setActiveRound)
  const setHolesData = useRoundStore((s) => s.setHolesData)
  const nav = useNavigate()

  const [q, setQ] = useState('')
  const [radius, setRadius] = useState(16093)
  const [teeColour, setTeeColour] = useState('white')
  const [searchLat, setSearchLat] = useState(null)
  const [searchLng, setSearchLng] = useState(null)
  const [courses, setCourses] = useState([])
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [error, setError] = useState(null)

  // First-time GPS auto-search
  useEffect(() => {
    if (!position || hasSearched) return
    setSearchLat(position.lat); setSearchLng(position.lng)
    runSearch(position.lat, position.lng, radius)
    setHasSearched(true)
  }, [position])

  async function runSearch(lat, lng, rad) {
    setBusy(true); setError(null); setCourses([])
    try {
      const { data } = await api.get('/courses/search', { params: { lat, lng, radius_m: rad } })
      setCourses(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Search failed')
    } finally {
      setBusy(false)
    }
  }

  async function geocodeAndSearch() {
    if (!q.trim()) return
    setBusy(true); setError(null); setCourses([])
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
        { headers: { 'Accept-Language': navigator.language || 'en' } },
      )
      const results = await resp.json()
      if (!results.length) {
        setError('No matching place')
        setBusy(false)
        return
      }
      const lat = parseFloat(results[0].lat)
      const lng = parseFloat(results[0].lon)
      setSearchLat(lat); setSearchLng(lng)
      await runSearch(lat, lng, radius)
    } catch (err) {
      setError('Geocoding failed')
      setBusy(false)
    }
  }

  function useMyLocation() {
    if (!position) return
    setQ('')
    setSearchLat(position.lat); setSearchLng(position.lng)
    runSearch(position.lat, position.lng, radius)
  }

  async function play(course) {
    try {
      setImporting(course.osm_id || course.id)
      let courseId = course.id
      if (!course.id && course.osm_id) {
        const { data: imp } = await api.post(
          `/courses/import/${encodeURIComponent(course.osm_id)}`,
          null,
          { params: { lat: searchLat || course.lat, lng: searchLng || course.lng } },
        )
        courseId = imp.id
      }
      const { data: round } = await api.post('/rounds/', {
        course_id: courseId,
        tee_colour: teeColour,
      })
      const { data: holes } = await api.get(`/courses/${courseId}/holes`)
      setHolesData(holes)
      setActiveRound({ id: round.id, course_id: courseId, course_name: course.name, tee_colour: teeColour })
      nav(`/round/${round.id}`)
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to start round')
    } finally {
      setImporting(null)
    }
  }

  return (
    <div className="page" style={{ overflowY: 'auto', paddingBottom: 'calc(2rem + var(--safe-bottom))' }}>
      <header style={S.header}>
        <button style={S.back} onClick={() => nav('/')} aria-label="Back">‹</button>
        <h1 style={S.title}>Find a course</h1>
      </header>

      <div style={S.searchRow}>
        <input
          style={{ flex: 1 }}
          placeholder="City, postcode, or course name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && geocodeAndSearch()}
          autoCorrect="off"
        />
        <button className="btn" onClick={geocodeAndSearch} disabled={busy} style={{ padding: '0 14px' }}>
          {busy ? '…' : '🔍'}
        </button>
      </div>

      <div style={S.controlRow}>
        <span style={S.label}>Radius</span>
        <div style={S.pills}>
          {RADIUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              style={{ ...S.pill, ...(radius === o.value ? S.pillActive : {}) }}
              onClick={() => {
                setRadius(o.value)
                if (searchLat !== null) runSearch(searchLat, searchLng, o.value)
              }}
            >{o.label}</button>
          ))}
        </div>
      </div>

      <div style={S.controlRow}>
        <span style={S.label}>Tee</span>
        <div style={S.pills}>
          {TEE_COLOURS.map((c) => (
            <button
              key={c}
              style={{
                ...S.pill,
                ...(teeColour === c ? S.pillActive : {}),
                textTransform: 'capitalize',
              }}
              onClick={() => setTeeColour(c)}
            >{c}</button>
          ))}
        </div>
      </div>

      <div style={S.gpsRow}>
        <span style={S.muted}>
          {gpsError ? `⚠ ${gpsError}` : position ? `📍 GPS ±${position.accuracy}m` : '📍 Acquiring GPS…'}
        </span>
        {position && (
          <button className="btn-secondary btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={useMyLocation}>
            Use my location
          </button>
        )}
      </div>

      <div style={{ padding: '0 1rem' }}>
        {error && <p style={S.error}>{error}</p>}
        {!busy && courses.length === 0 && (searchLat !== null || position) && !error && (
          <p style={S.muted}>No courses found. Try a larger radius or a city name above.</p>
        )}
        {courses.map((c) => (
          <div key={c.id || c.osm_id} className="card" style={S.courseCard}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={S.courseName}>{c.name}</p>
              {(c.city || c.country) && (
                <p style={S.muted}>{[c.city, c.country].filter(Boolean).join(', ')}</p>
              )}
              <p style={S.muted}>
                {c.is_imported ? `✓ Saved · ${c.total_holes} holes · Par ${c.par}` : 'OSM · imports on Play'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {isAdmin && c.is_imported && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: '8px 12px', fontSize: 12 }}
                  onClick={() => nav(`/admin/courses/${c.id}/edit`)}
                  title="Edit holes"
                >Edit</button>
              )}
              <button
                className="btn"
                disabled={importing === (c.id || c.osm_id)}
                onClick={() => play(c)}
              >
                {importing === (c.id || c.osm_id) ? '…' : 'Play'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const S = {
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '1rem 1rem 0.5rem' },
  back: { fontSize: 28, color: 'var(--text-secondary)', lineHeight: 1, padding: '0 4px' },
  title: { fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text-primary)', margin: 0 },
  searchRow: { display: 'flex', gap: 8, padding: '0 1rem 10px' },
  controlRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '0 1rem 8px' },
  label: { fontSize: 12, color: 'var(--text-muted)', minWidth: 50 },
  pills: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  pill: {
    padding: '6px 12px', borderRadius: 99, fontSize: 12,
    border: '1px solid var(--border)', color: 'var(--text-muted)',
    background: 'transparent',
  },
  pillActive: { background: 'var(--surface-3)', color: 'var(--text-primary)', borderColor: 'var(--border-strong)' },
  gpsRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1rem 12px' },
  muted: { color: 'var(--text-muted)', fontSize: 13 },
  error: { color: 'var(--danger)', fontSize: 13, padding: '8px 0' },
  courseCard: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', marginBottom: 10 },
  courseName: { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' },
}
