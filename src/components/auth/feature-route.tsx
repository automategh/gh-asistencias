import { Navigate, Outlet } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"
import { useDatabase } from "@/context/DatabaseContext"
import { useEffect, useState } from "react"
import type { AppRole, FeatureKey } from "@/types/permissions"
import { hasFeatureAccess } from "@/services/permissions.service"

/**
 * FeatureRoute
 * Protege rutas hijas según permisos por feature en la base de datos actual.
 * - Usa el rol del usuario y su uid para resolver permisos.
 * - Si no tiene acceso, redirige a `redirectTo`.
 */
export default function FeatureRoute({
  feature,
  redirectTo = "/",
}: {
  feature: FeatureKey
  redirectTo?: string
}) {
  const { user, role, loading: authLoading } = useAuth()
  const { database, databaseUrl } = useDatabase()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      // Esperar resolución de auth y DB antes de decidir
      if (authLoading || !database || !user?.uid || !role) {
        if (!cancelled) setAllowed(null)
        return
      }
      const ok = await hasFeatureAccess(database, { uid: user.uid, role: role as AppRole, feature })
      console.log(`FeatureRoute: feature='${feature}' allowed=${ok} uid='${user.uid}' role='${role}' db='${databaseUrl ?? "unknown"}'`)
      if (!cancelled) setAllowed(ok)
    }
    check()
    .catch(() => {
      setAllowed(false)
      console.error("Error verificando permisos de feature")
    })
    return () => { cancelled = true }
  }, [database, databaseUrl, user?.uid, role, feature, authLoading])

  if (allowed === null) {
    return null
  }
  if (!allowed) {
    return <Navigate to={redirectTo} replace />
  }
  return <Outlet />
}
