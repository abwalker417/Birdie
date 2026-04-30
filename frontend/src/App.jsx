import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import CourseSearch from './pages/CourseSearch.jsx'
import ActiveRound from './pages/ActiveRound.jsx'
import Profile from './pages/Profile.jsx'
import HoleEditor from './pages/HoleEditor.jsx'
import { useAuthStore } from './store.js'

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

function RequireAdmin({ children }) {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  if (!user || !user.is_admin) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/courses" element={<RequireAuth><CourseSearch /></RequireAuth>} />
        <Route path="/round/:roundId" element={<RequireAuth><ActiveRound /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/admin/courses/:courseId/edit" element={<RequireAdmin><HoleEditor /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
