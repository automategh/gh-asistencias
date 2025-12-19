
import './App.css'
import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'
import ProtectedRoute from './components/auth/protected-route'
import PublicOnlyRoute from './components/auth/public-route'
import { useAuth } from './context/AuthContext'
import ConfigurationProfilePage from './pages/configuration/ConfigurationPage'


function App() {
    return (
        <>
            


                <Routes>
                    <Route element={<ProtectedRoute />}>
                        <Route path="/" element={<Home />} />
                        <Route path="/configure-profile" element={<ConfigurationProfilePage />} />
                    </Route>
                    <Route element={<PublicOnlyRoute />}>
                        <Route path="/login" element={<LoginPage />} />
                    </Route>
                </Routes>

        </>
    )
}

function Home() {

    const { logout } = useAuth();

    return <h1 className="text-2xl font-bold">Bienvenido 
        <button onClick={logout}>Cerrar sesión</button>
    </h1>
}

export default App
