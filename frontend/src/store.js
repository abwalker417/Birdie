/**
 * Lightweight Zustand store for the active round + auth state.
 * Auth token + user are mirrored into localStorage by the auth pages.
 */
import { create } from 'zustand'

export const useAuthStore = create((set) => ({
  token: localStorage.getItem('birdie-token') || null,
  user: (() => {
    try { return JSON.parse(localStorage.getItem('birdie-user') || 'null') } catch { return null }
  })(),
  setAuth: (token, user) => {
    localStorage.setItem('birdie-token', token)
    localStorage.setItem('birdie-user', JSON.stringify(user))
    set({ token, user })
  },
  clearAuth: () => {
    localStorage.removeItem('birdie-token')
    localStorage.removeItem('birdie-user')
    set({ token: null, user: null })
  },
}))

export const useRoundStore = create((set) => ({
  activeRound: null,    // { id, course_id, course_name, tee_colour }
  holesData: [],        // [{ id, number, par, tee_geojson, pin_geojson, ... }]
  currentHole: 1,
  scores: {},           // { [holeNumber]: { strokes, putts, fairway_hit, green_in_regulation } }
  shots: {},            // { [holeNumber]: [shot, ...] }

  setActiveRound: (r) => set({ activeRound: r, currentHole: 1, scores: {}, shots: {} }),
  setHolesData:   (h) => set({ holesData: h }),
  setCurrentHole: (n) => set({ currentHole: n }),
  setScore: (n, patch) => set((s) => ({ scores: { ...s.scores, [n]: { ...(s.scores[n] || {}), ...patch } } })),
  addShot:    (n, shot) => set((s) => ({ shots: { ...s.shots, [n]: [...(s.shots[n] || []), shot] } })),
  removeShot: (n, id)   => set((s) => ({ shots: { ...s.shots, [n]: (s.shots[n] || []).filter((x) => x.id !== id) } })),
  setShots:   (n, list) => set((s) => ({ shots: { ...s.shots, [n]: list } })),
  clearRound: () => set({ activeRound: null, holesData: [], currentHole: 1, scores: {}, shots: {} }),
}))
