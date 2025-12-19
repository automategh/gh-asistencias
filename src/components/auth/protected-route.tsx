import { useAuth } from '@/context/AuthContext'
import type { JSX } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'


/**
 * Protección de rutas al estilo "middleware".
 * Si el usuario no está autenticado, redirige a /login preservando la ruta de origen.
 * Úsalo como elemento contenedor en las rutas que quieras proteger.
 */
export default function ProtectedRoute(): JSX.Element {
  const { user } = useAuth()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}