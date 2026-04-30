/**
 * Admin-only Hole Editor — point-and-line wizard.
 *
 * Flow per hole:
 *   1. Pick which hole to edit (1..18 strip)
 *   2. Tap the map once to set the tee
 *   3. Tap the map again to set the pin
 *   4. Adjust par + handicap index
 *   5. Save
 */
import L from 'leaflet'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import api from '../api.js'

const teeIcon = L.divIcon({ html: `<div style="width:14px;height:14px;border-radius:50%;background:#3a8f5a;border:2px solid #fff"></div>`, className: '', iconAnchor: [7,7] })
const pinIcon = L.divIcon({ html: `<div style="width:14px;height:14px;border-radius:50%;background:#d6b66a;border:2px solid #fff"></div>`, className: '', iconAnchor: [7,7] })

function MapTap({ onTap }) {
  useMapEvents({ click: (e) => onTap(e.latlng) })
  return null
}

function FocusOnHole({ hole, draftTee, draftPin }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const points = []
    const tee = draftTee || hole?.tee_geojson?.coordinates
    const pin = draftPin || hole?.pin_geojson?.coordinates
    const teeLatLng = draftTee ? [draftTee.lat, draftTee.lng]
      : hole?.tee_geojson?.coordinates ? [hole.tee_geojson.coordinates[1], hole.tee_geojson.coordinates[0]] : null
    const pinLatLng = draftPin ? [draftPin.lat, draftPin.lng]
      : hole?.pin_geojson?.coordinates ? [hole.pin_geojson.coordinates[1], hole.pin_geojson.coordinates[0]] : null
    if (teeLatLng) points.push(teeLatLng)
    if (pinLatLng) points.push(pinLatLng)
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points), { padding: [80, 80], maxZoom: 18 })
    else if (points.length === 1) map.setView(points[0], 17)
  }, [hole?.id, draftTee?.lat, draftPin?.lat])
  return null
}

export default function HoleEditor() {
  const { courseId } = useParams()
  const nav = useNavigate()
  const [course, setCourse] = useState(null)
  const [holes, setHoles] = useState([])
  const [active, setActive] = useState(1)
  const [step, setStep] = useState('tee') // 'tee' | 'pin' | 'idle'
  const [draftTee, setDraftTee] = useState(null)
  const [draftPin, setDraftPin] = useState(null)
  const [par, setPar] = useState(4)
  const [hcp, setHcp] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const hole = useMemo(() => holes.find((h) => h.number === active), [holes, active])

  useEffect(() => {
    api.get(`/courses/${courseId}`).then(({ data }) => setCourse(data)).catch(() => {})
    api.get(`/courses/${courseId}/holes`).then(({ data }) => setHoles(data)).catch(() => {})
  }, [courseId])

  useEffect(() => {
    setDraftTee(null); setDraftPin(null)
    setStep('tee')
    setMsg(null)
    if (hole) {
      setPar(hole.par || 4)
      setHcp(hole.handicap_index ?? null)
    }
  }, [active, hole?.id])

  const center = useMemo(() => {
    if (course?.lat && course?.lng) return [course.lat, course.lng]
    if (hole?.tee_geojson?.coordinates) return [hole.tee_geojson.coordinates[1], hole.tee_geojson.coordinates[0]]
    return [40.0, -111.9]
  }, [course?.lat, hole?.id])

  function onTap(latlng) {
    if (step === 'tee') {
      setDraftTee({ lat: latlng.lat, lng: latlng.lng })
      setStep('pin')
      setMsg('Tee set — tap the pin location')
    } else if (step === 'pin') {
      setDraftPin({ lat: latlng.lat, lng: latlng.lng })
      setStep('idle')
      setMsg('Tee + pin set. Adjust par/HC then Save.')
    }
  }

  function reset() {
    setDraftTee(null); setDraftPin(null); setStep('tee'); setMsg(null)
  }

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const payload = { par, handicap_index: hcp }
      if (draftTee) { payload.tee_lat = draftTee.lat; payload.tee_lng = draftTee.lng }
      if (draftPin) { payload.pin_lat = draftPin.lat; payload.pin_lng = draftPin.lng }
      const { data } = await api.patch(`/courses/${courseId}/holes/${active}`, payload)
      setHoles((prev) => prev.map((h) => h.number === active ? data : h))
      setDraftTee(null); setDraftPin(null); setStep('tee')
      setMsg(`Hole ${active} saved.`)
    } catch (err) {
      setMsg(err.response?.data?.detail || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  // Display geometry — drafts override saved values
  const dispTee = draftTee
    ? [draftTee.lat, draftTee.lng]
    : hole?.tee_geojson ? [hole.tee_geojson.coordinates[1], hole.tee_geojson.coordinates[0]] : null
  const dispPin = draftPin
    ? [draftPin.lat, draftPin.lng]
    : hole?.pin_geojson ? [hole.pin_geojson.coordinates[1], hole.pin_geojson.coordinates[0]] : null

  return (
    <div className="page">
      <header style={S.header}>
        <button className="btn-ghost" style={S.back} onClick={() => nav('/courses')}>‹</button>
        <div>
          <h1 style={S.title}>Edit holes</h1>
          <p style={S.muted}>{course?.name || '…'}</p>
        </div>
      </header>

      <div style={S.holeStrip}>
        {holes.map((h) => (
          <button
            key={h.number}
            style={{ ...S.holeChip, ...(h.number === active ? S.holeChipActive : {}) }}
            onClick={() => setActive(h.number)}
          >{h.number}</button>
        ))}
      </div>

      <div style={S.stepBar}>
        <span style={S.muted}>
          {step === 'tee' && '1. Tap the map to set the tee'}
          {step === 'pin' && '2. Tap the map to set the pin'}
          {step === 'idle' && msg}
        </span>
        <button className="btn-secondary btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>Restart</button>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 380 }}>
        <MapContainer center={center} zoom={16} style={{ width: '100%', height: '100%' }} zoomControl>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapTap onTap={onTap} />
          <FocusOnHole hole={hole} draftTee={draftTee} draftPin={draftPin} />
          {dispTee && <Marker position={dispTee} icon={teeIcon} />}
          {dispPin && <Marker position={dispPin} icon={pinIcon} />}
          {dispTee && dispPin && (
            <Polyline positions={[dispTee, dispPin]} pathOptions={{ color: '#5cba7e', weight: 3, opacity: 0.7 }} />
          )}
        </MapContainer>
      </div>

      <div style={S.bottomPanel}>
        <div style={S.fieldRow}>
          <div>
            <label style={S.label}>Par</label>
            <div style={S.pills}>
              {[3, 4, 5].map((p) => (
                <button key={p}
                  style={{ ...S.pill, ...(par === p ? S.pillActive : {}) }}
                  onClick={() => setPar(p)}
                >{p}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={S.label}>HC index</label>
            <input
              type="number"
              min="1" max="18"
              style={{ width: 72 }}
              value={hcp ?? ''}
              onChange={(e) => setHcp(e.target.value === '' ? null : parseInt(e.target.value))}
            />
          </div>
        </div>
        <button className="btn" disabled={busy} onClick={save} style={{ width: '100%', marginTop: 12 }}>
          {busy ? 'Saving…' : `Save hole ${active}`}
        </button>
        {msg && <p style={S.msg}>{msg}</p>}
      </div>
    </div>
  )
}

const S = {
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '1rem 1rem 0.5rem' },
  back: { fontSize: 26, color: 'var(--text-secondary)', padding: '0 6px' },
  title: { fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-primary)', margin: 0 },
  muted: { fontSize: 12, color: 'var(--text-muted)', margin: 0 },
  holeStrip: {
    display: 'flex', gap: 6, overflowX: 'auto', padding: '4px 1rem 8px',
    background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
  },
  holeChip: {
    flex: '0 0 auto', minWidth: 36, padding: '6px 10px',
    border: '1px solid var(--border)', borderRadius: var_radius('sm'),
    background: 'var(--surface-1)', color: 'var(--text-secondary)', fontSize: 13,
  },
  holeChipActive: { background: 'var(--green-600)', color: '#fff', borderColor: 'var(--green-500)' },
  stepBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 1rem', background: 'var(--surface-1)' },
  bottomPanel: { padding: '12px 1rem calc(1rem + var(--safe-bottom))', background: 'var(--surface-1)', borderTop: '1px solid var(--border)' },
  fieldRow: { display: 'flex', gap: 16, alignItems: 'flex-end' },
  label: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 },
  pills: { display: 'flex', gap: 6 },
  pill: { padding: '6px 14px', borderRadius: 99, fontSize: 13, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-secondary)' },
  pillActive: { background: 'var(--green-600)', color: '#fff', borderColor: 'var(--green-500)' },
  msg: { fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 },
}

// Tiny helper since CSS var() doesn't expand inside JS object keys
function var_radius(size) {
  return size === 'sm' ? 'var(--radius-sm)' : 'var(--radius-md)'
}
