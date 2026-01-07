import { useAuth } from '@/context/AuthContext'
import type { JSX } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'


/**
 * Impide acceder a rutas públicas (p.ej. /login) cuando ya se está autenticado.
 */
export default function PublicOnlyRoute(): JSX.Element {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Outlet />

  if (user) {
    type FromState = {
      from?: {
        pathname: string
        search?: string
        hash?: string
      }
    }

    const state = (location.state ?? null) as FromState | null
    const from = state?.from
    const redirectTo = from
      ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
      : '/'

    return <Navigate to={redirectTo} replace />
  }
  return <Outlet />
}