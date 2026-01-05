
import './App.css'
import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'
import ProtectedRoute from './components/auth/protected-route'
import PublicOnlyRoute from './components/auth/public-route'
import ConfigurationProfilePage from './pages/configuration/ConfigurationPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import NewMeetPage from './pages/meets/NewMeetPage'
import MeetsPage from './pages/meets/MeetsPage'
import DetailMeetPage from './pages/meets/DetailMeetPage'
import AttendancePage from './pages/meets/AttendancePage'


function App() {
    return (
        <>
            <Routes>
                <Route element={<ProtectedRoute />}>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/configure-profile" element={<ConfigurationProfilePage />} />
                    <Route path="/new-meeting" element={<NewMeetPage />} />
                    <Route path="/meets" element={<MeetsPage />} />
                    <Route path="/meeting/:id" element={<DetailMeetPage />} />
                    <Route path="/attendance/:id" element={<AttendancePage />} />
                </Route>
                <Route element={<PublicOnlyRoute />}>
                    <Route path="/login" element={<LoginPage />} />
                </Route>
            </Routes>
        </>
    )
}


export default App
