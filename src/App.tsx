
import './App.css'
import { Routes, Route, Link, Navigate } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'


function App() {
    return (
        <>
            <header className="p-4 border-b">
                <nav className="flex gap-4">
                    <Link to="/">Inicio</Link>
                    <Link to="/login">Login</Link>
                </nav>
            </header>

            <main className="p-4">
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
        </>
    )
}

function Home() {
    return <h1 className="text-2xl font-bold">Bienvenido</h1>
}

export default App
