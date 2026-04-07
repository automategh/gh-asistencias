import { useAuth } from "@/context/AuthContext"
import type { AppRole } from "@/types/permissions"
import type { JSX, ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"

interface RoleRouteProps {
  readonly allowed: ReadonlyArray<AppRole>
  readonly children: ReactNode
}

/**
 * Protege una sección de la app por rol.
 * Debe usarse dentro de rutas ya protegidas por autenticación (ProtectedRoute).
 */
export function RoleRoute({ allowed, children }: RoleRouteProps): JSX.Element {
  const { role, loading, user } = useAuth()
  const location = useLocation()

  // Mientras se resuelve la sesión o el rol, no redirigimos todavía
  if (loading || (user && role === null)) {
    return <div className="p-4 text-sm text-muted-foreground">Verificando permisos…</div>
  }

  const currentRole = (role ?? "User") as AppRole

  if (!allowed.includes(currentRole)) {
    return <Navigate to="/" replace state={{ from: location }} />
  }

  return <>{children}</>
}

export default RoleRoute
