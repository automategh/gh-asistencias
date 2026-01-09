import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import { get, ref } from 'firebase/database'
import { useEffect, useState, type JSX } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { findUserDatabaseByUid } from '@/services/user.discovery.service'


/**
 * Protección de rutas al estilo "middleware".
 * - Requiere sesión.
 * - Verifica perfil en RTDB (campo users/{uid}/identify).
 * - Si el perfil está incompleto, redirige a /configure-profile,
 *   excepto cuando ya estás en esa ruta (evita bucles).
 */
export default function ProtectedRoute(): JSX.Element {
    const { user, loading } = useAuth()
    const { database, availableDatabases, setSelectedDatabase } = useDatabase()
    const location = useLocation()
    const [profileComplete, setProfileComplete] = useState<boolean | null>(null)

    // DEPENDENCIAS ESTABLES: siempre dos valores (uid o null) y el booleano de ruta
    const uid: string | null = user?.uid ?? null
    // Ruta única de configuración de perfil
    const PROFILE_ROUTES: readonly string[] = ['/configure-profile']
    const isOnProfileRoute: boolean = PROFILE_ROUTES.some(prefix => location.pathname.startsWith(prefix))

    useEffect(() => {
        let cancelled = false

        async function checkProfile(): Promise<void> {
            // Espera tener usuario
            if (!uid) {
                setProfileComplete(null)
                return
            }

            // Ya en la ruta de configuración: no fuerces redirección
            if (isOnProfileRoute) {
                setProfileComplete(true)
                return
            }

            // 1) Si hay DB actual, intenta validar ahí
            if (database) {
                try {
                    const identifyRef = ref(database, `users/${uid}/identify`)
                    const snapshot = await get(identifyRef)
                    const isComplete = snapshot.exists()
                    if (!cancelled && isComplete) {
                        setProfileComplete(true)
                        return
                    }
                } catch {
                    // Ignorar y continuar al discovery multi-base
                }
            }

            // 2) Descubrir automáticamente en qué base está el usuario
            try {
                const candidates = availableDatabases.map(d => ({ url: d.url, key: d.key }))
                const found = await findUserDatabaseByUid(candidates, uid)
                if (!cancelled && found) {
                    setProfileComplete(true)
                    return
                }
            } catch {
                // Si falla, continuará abajo como incompleto
            }

            if (!cancelled) setProfileComplete(false)
        }

        checkProfile().catch(() => {
            if (!cancelled) setProfileComplete(false)
        })

        return () => {
            cancelled = true
        }
    }, [uid, isOnProfileRoute, database, availableDatabases, setSelectedDatabase]) // Tamaño y orden constantes

    // Evita redirigir mientras se determina auth y perfil
    if (loading) {
        console.log("Autenticando usuario...")
        return <div className="p-4 text-sm text-gray-500">Cargando…</div>
    }

    if (!isOnProfileRoute && profileComplete === false) {
        console.log("Perfil incompleto, redirigiendo a configuración...")
        // Redirige a la ruta de configuración de perfil
        return <Navigate to="/configure-profile" />
    }

    if (!uid) {
        console.log("Usuario no autenticado, redirigiendo a login...")
        return <Navigate to="/login" replace state={{ from: location }} />
    }

    return <Outlet />
}