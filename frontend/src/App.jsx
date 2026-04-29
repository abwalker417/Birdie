import { Routes, Route, Link } from "react-router-dom"
import Login from "./pages/Login"
import CourseSearch from "./pages/CourseSearch"
import ActiveRound from "./pages/ActiveRound"
import Scorecard from "./pages/Scorecard"
export default function App(){return <div className="page"><header className="topbar"><div><h1>Birdie</h1><p>Self-hosted golf tracker</p></div><nav><Link to="/">Login</Link><Link to="/courses">Courses</Link><Link to="/round">Round</Link><Link to="/scorecard">Scorecard</Link></nav></header><main className="content"><Routes><Route path="/" element={<Login />} /><Route path="/courses" element={<CourseSearch />} /><Route path="/round" element={<ActiveRound />} /><Route path="/scorecard" element={<Scorecard />} /></Routes></main></div>}
