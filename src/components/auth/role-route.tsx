import { useAuth } from "@/context/AuthContext"
import type { PermissionId } from "@/types/authorization"
import type { JSX, ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"

interface RoleRouteProps {
  readonly requireAny: ReadonlyArray<PermissionId>
  readonly children: ReactNode
}

/**
 * Protege una sección de la app por permisos.
 * Debe usarse dentro de rutas ya protegidas por autenticación (ProtectedRoute).
 */
export function RoleRoute({ requireAny, children }: RoleRouteProps): JSX.Element {
  const { roleId, loading, user, hasPermission } = useAuth()
  const location = useLocation()

  // Mientras se resuelve la sesión o el rol, no redirigimos todavía.
  if (loading || (user && roleId === null)) {
    return <div className="p-4 text-sm text-muted-foreground">Verificando permisos…</div>
  }

  if (requireAny.length === 0) {
    return <>{children}</>
  }

  const hasAccess = requireAny.some((permissionId) => hasPermission(permissionId))

  if (!hasAccess) {
    return <Navigate to="/" replace state={{ from: location }} />
  }

  return <>{children}</>
}

export default RoleRoute
