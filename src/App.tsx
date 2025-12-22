
import './App.css'
import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'
import ProtectedRoute from './components/auth/protected-route'
import PublicOnlyRoute from './components/auth/public-route'
import ConfigurationProfilePage from './pages/configuration/ConfigurationPage'
import DashboardPage from './pages/dashboard/DashboardPage'


function App() {
    return (
        <>



            <Routes>
                <Route element={<ProtectedRoute />}>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/configure-profile" element={<ConfigurationProfilePage />} />
                </Route>
                <Route element={<PublicOnlyRoute />}>
                    <Route path="/login" element={<LoginPage />} />
                </Route>
            </Routes>

        </>
    )
}


export default App
