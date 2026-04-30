/**
 * Smoothed geolocation hook — high-accuracy watchPosition with a
 * lightweight position smoother to reduce GPS jitter while walking.
 *
 * Returns { position: { lat, lng, accuracy }, error, supported }
 */
import { useEffect, useRef, useState } from 'react'

const SMOOTHING = 0.4 // 0 = no smoothing, 1 = no movement; 0.4 is a decent walking smooth

export function useGPS() {
  const [position, setPosition] = useState(null)
  const [error, setError] = useState(null)
  const [supported, setSupported] = useState(true)
  const smoothed = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setSupported(false)
      setError('GPS not supported by this browser')
      return
    }

    // Geolocation requires HTTPS or localhost in modern browsers.
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      setSupported(false)
      setError('GPS requires HTTPS — set up Cloudflare Tunnel or a self-signed cert.')
      return
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const fresh = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 0),
        }
        if (!smoothed.current) {
          smoothed.current = fresh
        } else {
          // Only smooth when accuracy is decent; otherwise trust the new reading.
          if (fresh.accuracy < 30) {
            smoothed.current = {
              lat: smoothed.current.lat * SMOOTHING + fresh.lat * (1 - SMOOTHING),
              lng: smoothed.current.lng * SMOOTHING + fresh.lng * (1 - SMOOTHING),
              accuracy: fresh.accuracy,
            }
          } else {
            smoothed.current = fresh
          }
        }
        setPosition({ ...smoothed.current })
        setError(null)
      },
      (err) => {
        setError(err.message || 'GPS error')
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 30000,
      },
    )

    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { position, error, supported }
}
