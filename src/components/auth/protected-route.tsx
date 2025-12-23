import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import { get, ref } from 'firebase/database'
import { useEffect, useState, type JSX } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'


/**
 * Protección de rutas al estilo "middleware".
 * - Requiere sesión.
 * - Verifica perfil en RTDB (campo users/{uid}/identify).
 * - Si el perfil está incompleto, redirige a /configure-profile,
 *   excepto cuando ya estás en esa ruta (evita bucles).
 */
export default function ProtectedRoute(): JSX.Element {
    const { user, loading } = useAuth()
    const { database } = useDatabase()
    const location = useLocation()
    const [profileComplete, setProfileComplete] = useState<boolean | null>(null)

    // DEPENDENCIAS ESTABLES: siempre dos valores (uid o null) y el booleano de ruta
    const uid: string | null = user?.uid ?? null
    // Ruta única de configuración de perfil
    const PROFILE_ROUTES: readonly string[] = ['/configure-profile']
    const isOnProfileRoute: boolean = PROFILE_ROUTES.some(prefix => location.pathname.startsWith(prefix))

    useEffect(() => {
        if (!database) {
            throw new Error('la database no está disponible ')
        }

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

            // Verifica en la base de datos si el perfil está completo
            if (!database) {
                setProfileComplete(false)
                return
            }

            const identifyRef = ref(database, `users/${uid}/identify`)
            const snapshot = await get(identifyRef)
            const isComplete = snapshot.exists()

            if (!cancelled) {
                setProfileComplete(prev => (prev === isComplete ? prev : isComplete))
            }
        }

        checkProfile().catch(() => {
            if (!cancelled) setProfileComplete(false)
        })

        return () => {
            cancelled = true
        }
    }, [uid, isOnProfileRoute, database]) // Tamaño y orden constantes

    // Evita redirigir mientras se determina auth y perfil
    if (loading && profileComplete === null) {
        return <div className="p-4 text-sm text-gray-500">Cargando…</div>
    }

    if (!uid) {
        return <Navigate to="/login" replace state={{ from: location }} />
    }

    if (!isOnProfileRoute && profileComplete === false) {
        // Redirige a la ruta de configuración de perfil
        return <Navigate to="/configure-profile" />
    }

    return <Outlet />
}