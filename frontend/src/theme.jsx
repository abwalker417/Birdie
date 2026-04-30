/**
 * Theme provider — light / dark / system.
 *
 * The boot script in index.html sets `<html data-theme>` BEFORE React
 * mounts so we never flash the wrong colours. This provider keeps that in
 * sync at runtime, exposes the current preference, and listens for OS
 * theme changes when the user picked "system".
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ThemeCtx = createContext({
  pref: 'system',
  resolved: 'dark',
  setPref: () => {},
})

const STORAGE_KEY = 'birdie-theme'

function resolve(pref) {
  if (pref === 'light' || pref === 'dark') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [pref, setPrefState] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || 'system'
  })
  const [resolved, setResolved] = useState(() => resolve(pref))

  // Apply to <html> so CSS variables flip
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    document.documentElement.dataset.themePref = pref
  }, [resolved, pref])

  // Listen for OS theme changes when on "system"
  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const setPref = (next) => {
    localStorage.setItem(STORAGE_KEY, next)
    setPrefState(next)
    setResolved(resolve(next))
  }

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved])
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  return useContext(ThemeCtx)
}
