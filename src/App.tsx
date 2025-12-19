
import './App.css'
import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'
import ProtectedRoute from './components/auth/protected-route'
import PublicOnlyRoute from './components/auth/public-route'


function App() {
    return (
        <>
            


                <Routes>
                    <Route element={<ProtectedRoute />}>
                        <Route path="/" element={<Home />} />
                    </Route>
                    <Route element={<PublicOnlyRoute />}>
                        <Route path="/login" element={<LoginPage />} />
                    </Route>
                    
                </Routes>

        </>
    )
}

function Home() {
    return <h1 className="text-2xl font-bold">Bienvenido</h1>
}

export default App
