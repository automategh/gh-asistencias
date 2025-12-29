
import './App.css'
import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'
import ProtectedRoute from './components/auth/protected-route'
import PublicOnlyRoute from './components/auth/public-route'
import ConfigurationProfilePage from './pages/configuration/ConfigurationPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import NewMeetPage from './pages/meets/NewMeetPage'
import MeetsPage from './pages/meets/MeetsPage'


function App() {
    return (
        <>



            <Routes>
                <Route element={<ProtectedRoute />}>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/configure-profile" element={<ConfigurationProfilePage />} />
                    <Route path="/new-meeting" element={<NewMeetPage />} />
                    <Route path="/meets" element={<MeetsPage />} />
                </Route>
                <Route element={<PublicOnlyRoute />}>
                    <Route path="/login" element={<LoginPage />} />
                </Route>
            </Routes>

        </>
    )
}


export default App
