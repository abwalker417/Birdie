import L from 'leaflet'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import api from '../api.js'
import { useGPS } from '../hooks/useGPS.js'
import { useRoundStore } from '../store.js'

// Restore Leaflet's default marker icons (Vite breaks the asset URLs).
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

const teeIcon  = L.divIcon({ html: `<div style="width:12px;height:12px;border-radius:50%;background:#3a8f5a;border:2px solid #fff"></div>`, className: '', iconAnchor: [6,6] })
const pinIcon  = L.divIcon({ html: `<div style="width:14px;height:14px;border-radius:50%;background:#d6b66a;border:2px solid #fff;box-shadow:0 0 0 2px rgba(214,182,106,0.4)"></div>`, className: '', iconAnchor: [7,7] })
const playerIcon = L.divIcon({ html: `<div style="width:16px;height:16px;border-radius:50%;background:#4fa3e0;border:3px solid #fff;box-shadow:0 0 0 3px rgba(79,163,224,0.35)"></div>`, className: '', iconAnchor: [8,8] })
const shotIcon = (n) => L.divIcon({ html: `<div style="width:22px;height:22px;border-radius:50%;background:#1e4d30;border:2px solid #5cba7e;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:600">${n}</div>`, className: '', iconAnchor: [11,11] })

const TABS = [
  { id: 'map',   label: '🗺 Map' },
  { id: 'score', label: '📋 Score' },
  { id: 'shots', label: '🎯 Shots' },
]

const CLUBS = ['DR','3W','5W','3i','4i','5i','6i','7i','8i','9i','PW','GW','SW','LW','Putter','—']

function MapTap({ onTap }) {
  useMapEvents({ click: (e) => onTap(e.latlng) })
  return null
}

function MapFocuser({ mode, hole, holes, position }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    if (mode === 'focus' && hole) {
      const points = []
      if (hole.tee_geojson?.coordinates) points.push([hole.tee_geojson.coordinates[1], hole.tee_geojson.coordinates[0]])
      if (hole.pin_geojson?.coordinates) points.push([hole.pin_geojson.coordinates[1], hole.pin_geojson.coordinates[0]])
      if (position) points.push([position.lat, position.lng])
      if (points.length >= 2) map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 18 })
      else if (points.length === 1) map.setView(points[0], 17)
    } else if (mode === 'overview' && holes && holes.length) {
      const points = []
      for (const h of holes) {
        if (h.tee_geojson?.coordinates) points.push([h.tee_geojson.coordinates[1], h.tee_geojson.coordinates[0]])
        if (h.pin_geojson?.coordinates) points.push([h.pin_geojson.coordinates[1], h.pin_geojson.coordinates[0]])
      }
      if (points.length >= 2) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 })
    }
  }, [mode, hole?.id, holes?.length])
  return null
}

export default function ActiveRound() {
  const { roundId } = useParams()
  const nav = useNavigate()
  const { position } = useGPS()

  const {
    activeRound, holesData, setHolesData,
    currentHole, setCurrentHole,
    scores, setScore,
    shots, addShot, removeShot, setShots,
    clearRound,
  } = useRoundStore()

  const [tab, setTab] = useState('map')
  const [mapMode, setMapMode] = useState('focus')
  const [yardage, setYardage] = useState(null)
  const [clubModal, setClubModal] = useState(null)
  const [finishing, setFinishing] = useState(false)
  const [roundData, setRoundData] = useState(null)

  const hole = useMemo(() => holesData.find((h) => h.number === currentHole), [holesData, currentHole])
  const holeShots = shots[currentHole] || []

  // Hydrate round on cold load (refresh)
  useEffect(() => {
    api.get(`/rounds/${roundId}`).then(({ data }) => {
      setRoundData(data)
      for (const s of data.scores || []) {
        setScore(s.hole_number, {
          strokes: s.strokes,
          putts: s.putts,
          fairway_hit: s.fairway_hit,
          green_in_regulation: s.green_in_regulation,
        })
      }
      if (!holesData.length) {
        api.get(`/courses/${data.course_id}/holes`).then((h) => setHolesData(h.data))
      }
    }).catch(() => {})
  }, [roundId])

  // Hydrate shots when hole changes
  useEffect(() => {
    if (!currentHole) return
    api.get(`/shots/round/${roundId}/hole/${currentHole}`)
      .then(({ data }) => setShots(currentHole, data))
      .catch(() => {})
  }, [currentHole, roundId])

  // Live yardage
  useEffect(() => {
    if (!position || !hole) { setYardage(null); return }
    const courseId = roundData?.course_id || activeRound?.course_id
    if (!courseId) return
    api.get(`/courses/${courseId}/holes/${currentHole}/yardage`, {
      params: { lat: position.lat, lng: position.lng },
    }).then(({ data }) => setYardage(data.yards)).catch(() => setYardage(null))
  }, [position?.lat?.toFixed(4), position?.lng?.toFixed(4), currentHole, hole?.id])

  const promptShotAt = useCallback((latlng) => setClubModal(latlng), [])

  async function confirmShot(latlng, club) {
    setClubModal(null)
    try {
      const { data } = await api.post('/shots/', {
        round_id: parseInt(roundId),
        hole_number: currentHole,
        lat: latlng.lat,
        lng: latlng.lng,
        club: club || null,
        shot_type: holeShots.length === 0 ? 'tee' : 'fairway',
      })
      addShot(currentHole, data)
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to log shot')
    }
  }

  async function logGPSShot() {
    if (!position) return alert('No GPS position yet')
    promptShotAt({ lat: position.lat, lng: position.lng })
  }

  async function deleteShot(id) {
    try {
      await api.delete(`/shots/${id}`)
      removeShot(currentHole, id)
    } catch {
      alert('Could not delete that shot')
    }
  }

  async function finishRound() {
    if (!confirm('Finish and submit this round?')) return
    setFinishing(true)
    try {
      await api.post(`/rounds/${roundId}/finish`)
      clearRound()
      nav('/')
    } finally {
      setFinishing(false)
    }
  }

  const mapCenter = useMemo(() => {
    if (position) return [position.lat, position.lng]
    if (hole?.tee_geojson?.coordinates) {
      const c = hole.tee_geojson.coordinates
      return [c[1], c[0]]
    }
    if (holesData[0]?.tee_geojson?.coordinates) {
      const c = holesData[0].tee_geojson.coordinates
      return [c[1], c[0]]
    }
    return [40.0, -111.9]
  }, [position?.lat, hole?.id, holesData.length])

  const totalStrokes = Object.values(scores).reduce((s, h) => s + (h.strokes || 0), 0)
  const coursePar = holesData.reduce((s, h) => s + (h.par || 0), 0)
  const diff = totalStrokes - coursePar

  return (
    <div className="page">
      <div style={S.topBar}>
        <button className="btn-ghost" style={S.backBtn} onClick={() => nav('/')}>‹</button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <p style={S.courseName}>{activeRound?.course_name || roundData?.course_name || '—'}</p>
          <p style={S.scoreTotal}>
            {totalStrokes > 0
              ? `${totalStrokes} (${diff >= 0 ? '+' : ''}${diff})`
              : 'No strokes yet'}
          </p>
        </div>
        <button className="btn" style={{ padding: '7px 12px', fontSize: 13 }} onClick={finishRound} disabled={finishing}>
          {finishing ? '…' : 'Finish'}
        </button>
      </div>

      <div style={S.holeBar}>
        <button style={S.holeNav} disabled={currentHole <= 1} onClick={() => setCurrentHole(currentHole - 1)}>‹</button>
        <div style={S.holeInfo}>
          <span style={S.holeNum}>Hole {currentHole}</span>
          {hole && (
            <span style={S.holeMeta}>Par {hole.par}{hole.distance_yards ? ` · ${hole.distance_yards}y` : ''}</span>
          )}
          {yardage !== null && yardage !== undefined && (
            <span style={S.yardage}>{yardage}y to pin</span>
          )}
        </div>
        <button style={S.holeNav} disabled={currentHole >= (holesData.length || 18)} onClick={() => setCurrentHole(currentHole + 1)}>›</button>
      </div>

      <div style={S.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            style={{ ...S.tabBtn, ...(tab === t.id ? S.tabActive : {}) }}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'map' && (
        <div style={{ flex: 1, position: 'relative', minHeight: 400 }}>
          <MapContainer
            center={mapCenter}
            zoom={mapMode === 'focus' ? 17 : 15}
            style={{ width: '100%', height: '100%' }}
            zoomControl={false}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapTap onTap={promptShotAt} />
            <MapFocuser mode={mapMode} hole={hole} holes={holesData} position={position} />

            {position && (
              <>
                <Marker position={[position.lat, position.lng]} icon={playerIcon} />
                <Circle center={[position.lat, position.lng]} radius={position.accuracy || 5}
                  pathOptions={{ color: '#4fa3e0', fillOpacity: 0.08, weight: 1 }} />
              </>
            )}

            {mapMode === 'overview' && holesData.map((h) => (
              <span key={`ov-${h.id}`}>
                {h.tee_geojson && (
                  <Marker
                    position={[h.tee_geojson.coordinates[1], h.tee_geojson.coordinates[0]]}
                    icon={teeIcon}
                    eventHandlers={{ click: () => setCurrentHole(h.number) }}
                  >
                    <Popup>Hole {h.number} tee · Par {h.par}</Popup>
                  </Marker>
                )}
                {h.pin_geojson && (
                  <Marker
                    position={[h.pin_geojson.coordinates[1], h.pin_geojson.coordinates[0]]}
                    icon={pinIcon}
                    eventHandlers={{ click: () => setCurrentHole(h.number) }}
                  >
                    <Popup>Hole {h.number} pin</Popup>
                  </Marker>
                )}
                {h.hole_line_geojson && (
                  <Polyline
                    positions={h.hole_line_geojson.coordinates.map((c) => [c[1], c[0]])}
                    pathOptions={{
                      color: h.number === currentHole ? '#5cba7e' : '#3a8f5a',
                      weight: h.number === currentHole ? 3 : 1.5,
                      opacity: h.number === currentHole ? 0.9 : 0.45,
                    }}
                  />
                )}
              </span>
            ))}

            {mapMode === 'focus' && hole && (
              <>
                {hole.tee_geojson && (
                  <Marker position={[hole.tee_geojson.coordinates[1], hole.tee_geojson.coordinates[0]]} icon={teeIcon}>
                    <Popup>Tee — Hole {currentHole}</Popup>
                  </Marker>
                )}
                {hole.pin_geojson && (
                  <Marker position={[hole.pin_geojson.coordinates[1], hole.pin_geojson.coordinates[0]]} icon={pinIcon}>
                    <Popup>Pin — Par {hole.par}</Popup>
                  </Marker>
                )}
                {hole.hole_line_geojson && (
                  <Polyline
                    positions={hole.hole_line_geojson.coordinates.map((c) => [c[1], c[0]])}
                    pathOptions={{ color: '#5cba7e', weight: 3, opacity: 0.7 }}
                  />
                )}
              </>
            )}

            {holeShots.map((shot, i) => (
              <Marker key={shot.id} position={[shot.lat, shot.lng]} icon={shotIcon(i + 1)}>
                <Popup>
                  Shot {i + 1}{shot.club ? ` · ${shot.club}` : ''}
                  {shot.distance_yards ? ` · ${Math.round(shot.distance_yards)}y` : ''}
                </Popup>
              </Marker>
            ))}
            {holeShots.length >= 2 && (
              <Polyline
                positions={holeShots.map((s) => [s.lat, s.lng])}
                pathOptions={{ color: '#5cba7e', weight: 2, dashArray: '5,6', opacity: 0.7 }}
              />
            )}
          </MapContainer>

          {yardage !== null && yardage !== undefined && (
            <div style={S.yardageCard}>
              <p style={S.yardageNum}>{yardage}</p>
              <p style={S.yardageLabel}>yds to pin</p>
            </div>
          )}

          <div style={S.modeToggle}>
            <button
              style={{ ...S.modeBtn, ...(mapMode === 'overview' ? S.modeBtnActive : {}) }}
              onClick={() => setMapMode('overview')}
            >Overview</button>
            <button
              style={{ ...S.modeBtn, ...(mapMode === 'focus' ? S.modeBtnActive : {}) }}
              onClick={() => setMapMode('focus')}
            >Hole {currentHole}</button>
          </div>

          <div style={S.mapOverlay}>
            <button className="btn" onClick={logGPSShot} style={S.gpsBtn}>📍 Log shot here</button>
          </div>
          <p style={S.tapHint}>or tap the map to drop a shot</p>
        </div>
      )}

      {tab === 'score' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          <ScoreEntry
            holeNumber={currentHole}
            holePar={hole?.par || 4}
            score={scores[currentHole] || {}}
            onUpdate={(patch) => {
              const next = { ...(scores[currentHole] || {}), ...patch }
              setScore(currentHole, next)
              api.put(`/rounds/${roundId}/score`, {
                hole_number: currentHole,
                strokes: next.strokes ?? 0,
                putts: next.putts ?? null,
                fairway_hit: next.fairway_hit ?? null,
                green_in_regulation: next.green_in_regulation ?? null,
                penalty_strokes: next.penalty_strokes ?? 0,
              }).catch(() => {})
            }}
          />

          <div style={{ marginTop: '1.5rem' }}>
            <p style={S.sectionLabel}>Scorecard</p>
            <div style={S.scorecardGrid}>
              {holesData.map((h) => {
                const sc = scores[h.number]
                const d = sc?.strokes ? sc.strokes - h.par : null
                return (
                  <button
                    key={h.number}
                    style={{ ...S.scCell, ...(h.number === currentHole ? S.scCellActive : {}) }}
                    onClick={() => setCurrentHole(h.number)}
                  >
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.number}</span>
                    <span style={{
                      fontSize: 16, fontWeight: 600,
                      color: d === null ? 'var(--text-muted)'
                        : d < 0 ? 'var(--green-300)'
                        : d === 0 ? 'var(--text-primary)'
                        : 'var(--danger)',
                    }}>{sc?.strokes || '—'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'shots' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          <p style={S.sectionLabel}>Shots — Hole {currentHole}</p>
          {holeShots.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              No shots yet. Use the map to drop pins or tap “Log shot here”.
            </p>
          )}
          {holeShots.map((shot, i) => (
            <div key={shot.id} style={S.shotRow}>
              <div style={S.shotNum}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 500 }}>{shot.club || 'Unknown club'}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {shot.distance_yards ? `${Math.round(shot.distance_yards)} yards` : 'Distance TBD'}
                </p>
              </div>
              <button className="btn-ghost" style={{ color: 'var(--danger)', fontSize: 18 }} onClick={() => deleteShot(shot.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      {clubModal && (
        <ClubModal
          onSelect={(club) => confirmShot(clubModal, club)}
          onCancel={() => setClubModal(null)}
        />
      )}
    </div>
  )
}

function ScoreEntry({ holeNumber, holePar, score, onUpdate }) {
  const strokes = score.strokes || 0
  const labels = { '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey', '2': 'Dbl', '3': '+3' }
  return (
    <div className="card">
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Strokes — Hole {holeNumber} (Par {holePar})</p>
      <div style={SE.row}>
        <button style={SE.step} onClick={() => onUpdate({ strokes: Math.max(0, strokes - 1) })}>−</button>
        <span style={SE.strokeNum}>{strokes || '—'}</span>
        <button style={SE.step} onClick={() => onUpdate({ strokes: strokes + 1 })}>+</button>
      </div>
      <div style={SE.quickRow}>
        {[-2,-1,0,1,2,3].map((d) => {
          const s = holePar + d
          return (
            <button
              key={d}
              style={{ ...SE.quickBtn, ...(strokes === s ? SE.quickActive : {}) }}
              onClick={() => onUpdate({ strokes: s })}
            >
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{labels[d]}</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{s}</span>
            </button>
          )
        })}
      </div>
      <div style={SE.miniRow}>
        <span style={SE.miniLabel}>Putts</span>
        <div style={SE.mini}>
          {[0,1,2,3,4].map((n) => (
            <button key={n}
              style={{ ...SE.miniBtn, ...(score.putts === n ? SE.miniActive : {}) }}
              onClick={() => onUpdate({ putts: n })}
            >{n}</button>
          ))}
        </div>
      </div>
      {holePar > 3 && (
        <div style={SE.miniRow}>
          <span style={SE.miniLabel}>Fairway</span>
          <div style={SE.mini}>
            {[true,false].map((v) => (
              <button key={String(v)}
                style={{ ...SE.miniBtn, ...(score.fairway_hit === v ? SE.miniActive : {}), minWidth: 56 }}
                onClick={() => onUpdate({ fairway_hit: v })}
              >{v ? '✓ Yes' : '✗ No'}</button>
            ))}
          </div>
        </div>
      )}
      <div style={SE.miniRow}>
        <span style={SE.miniLabel}>GIR</span>
        <div style={SE.mini}>
          {[true,false].map((v) => (
            <button key={String(v)}
              style={{ ...SE.miniBtn, ...(score.green_in_regulation === v ? SE.miniActive : {}), minWidth: 56 }}
              onClick={() => onUpdate({ green_in_regulation: v })}
            >{v ? '✓ Yes' : '✗ No'}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ClubModal({ onSelect, onCancel }) {
  return (
    <div style={CM.overlay} onClick={onCancel}>
      <div style={CM.sheet} onClick={(e) => e.stopPropagation()}>
        <p style={CM.title}>Which club?</p>
        <div style={CM.grid}>
          {CLUBS.map((c) => (
            <button key={c} style={CM.clubBtn} onClick={() => onSelect(c === '—' ? null : c)}>{c}</button>
          ))}
        </div>
        <button className="btn-secondary btn" style={{ width: '100%' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

const S = {
  topBar: { display: 'flex', alignItems: 'center', padding: '0.75rem 0.75rem', gap: 6,
            background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' },
  backBtn: { fontSize: 26, color: 'var(--text-secondary)', padding: '0 6px', lineHeight: 1 },
  courseName: { fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  scoreTotal: { fontSize: 12, color: 'var(--gold-400)', margin: '2px 0 0' },
  holeBar: { display: 'flex', alignItems: 'center', padding: '8px 12px',
             background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' },
  holeNav: { fontSize: 26, color: 'var(--text-secondary)', padding: '0 10px', lineHeight: 1 },
  holeInfo: { flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 },
  holeNum: { fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-primary)' },
  holeMeta: { fontSize: 12, color: 'var(--text-muted)' },
  yardage: { fontSize: 14, fontWeight: 600, color: 'var(--gold-400)' },
  tabBar: { display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' },
  tabBtn: { flex: 1, padding: 10, fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 },
  tabActive: { color: 'var(--green-300)', borderBottom: '2px solid var(--green-400)' },
  yardageCard: {
    position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(10,30,18,0.92)', border: '1px solid var(--green-500)',
    borderRadius: 'var(--radius-lg)', padding: '8px 20px', textAlign: 'center', zIndex: 1000,
    pointerEvents: 'none',
  },
  yardageNum: { fontFamily: 'var(--font-display)', fontSize: 30, color: 'var(--gold-400)', lineHeight: 1, margin: 0 },
  yardageLabel: { fontSize: 10, color: '#cfd8d2', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '2px 0 0' },
  modeToggle: {
    position: 'absolute', top: 12, right: 12, display: 'flex',
    background: 'rgba(15,20,16,0.85)', borderRadius: 99,
    border: '1px solid var(--border)', overflow: 'hidden', zIndex: 1000,
  },
  modeBtn: { padding: '6px 12px', fontSize: 12, color: 'var(--text-secondary)' },
  modeBtnActive: { background: 'var(--green-600)', color: '#fff' },
  mapOverlay: { position: 'absolute', bottom: 56, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 1000, pointerEvents: 'none' },
  gpsBtn: { pointerEvents: 'auto', borderRadius: 99, padding: '12px 24px', boxShadow: '0 4px 18px rgba(0,0,0,0.4)' },
  tapHint: { position: 'absolute', bottom: 36, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.5)', zIndex: 1000, pointerEvents: 'none', margin: 0 },
  sectionLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 },
  scorecardGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 },
  scCell: { background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, border: '1px solid var(--border)' },
  scCellActive: { border: '1px solid var(--green-400)', background: 'var(--surface-3)' },
  shotRow: { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 8 },
  shotNum: { width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--green-300)', flexShrink: 0 },
}

const SE = {
  row: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 16 },
  step: { width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-3)', fontSize: 24, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  strokeNum: { fontFamily: 'var(--font-display)', fontSize: 52, color: 'var(--text-primary)', minWidth: 64, textAlign: 'center' },
  quickRow: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 16 },
  quickBtn: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: 'var(--text-primary)' },
  quickActive: { background: 'var(--surface-3)', border: '1px solid var(--green-500)' },
  miniRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 },
  miniLabel: { fontSize: 13, color: 'var(--text-muted)' },
  mini: { display: 'flex', gap: 6 },
  miniBtn: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 13, color: 'var(--text-secondary)' },
  miniActive: { background: 'var(--green-600)', border: '1px solid var(--green-500)', color: '#fff' },
}

const CM = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 2000 },
  sheet: { width: '100%', background: 'var(--surface-1)', borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0', padding: '1.25rem 1rem calc(1.25rem + var(--safe-bottom))' },
  title: { fontFamily: 'var(--font-display)', fontSize: 20, textAlign: 'center', marginBottom: '1rem', color: 'var(--text-primary)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: '1rem' },
  clubBtn: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 8px', fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' },
}
