import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach the JWT to every request if we have one stored.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('birdie-token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401, clear the stale token so the app boots back to the login screen.
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('birdie-token')
      localStorage.removeItem('birdie-user')
      if (!location.pathname.startsWith('/login')) {
        location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

export default api
