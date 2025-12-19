import { useAuth } from '@/context/AuthContext'
import type { JSX } from 'react'
import { Navigate, Outlet } from 'react-router-dom'


/**
 * Impide acceder a rutas públicas (p.ej. /login) cuando ya se está autenticado.
 */
export default function PublicOnlyRoute(): JSX.Element {
  const { user, loading } = useAuth()
  if (loading) return <Outlet />
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}