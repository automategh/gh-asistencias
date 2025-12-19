import { useAuth } from '@/context/AuthContext'
import { getDatabaseForUrl } from '@/services/firebase'
import { get, ref } from 'firebase/database'
import { useEffect, useState, type JSX } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

/** BD seleccionada y persistida tras el login. */
interface SelectedDatabase {
    readonly url: string
    readonly key: string
}

/** Obtiene la BD seleccionada desde LocalStorage. */
function readSelectedDatabase(): SelectedDatabase | null {
    try {
        const raw = window.localStorage.getItem('selectedDatabase')
        if (!raw) return null
        const parsed = JSON.parse(raw) as SelectedDatabase
        return typeof parsed.url === 'string' && parsed.url.length > 0 ? parsed : null
    } catch {
        return null
    }
}

/**
 * Protección de rutas al estilo "middleware".
 * - Requiere sesión.
 * - Verifica perfil en RTDB (campo users/{uid}/identify).
 * - Si el perfil está incompleto, redirige a /configure-profile,
 *   excepto cuando ya estás en esa ruta (evita bucles).
 */
export default function ProtectedRoute(): JSX.Element {
    const { user, loading } = useAuth()
    const location = useLocation()
    const [profileComplete, setProfileComplete] = useState<boolean | null>(null)

    // DEPENDENCIAS ESTABLES: siempre dos valores (uid o null) y el booleano de ruta
    const uid: string | null = user?.uid ?? null
    const isOnProfileRoute: boolean = location.pathname.startsWith('/configure-profile')

    useEffect(() => {
        let cancelled = false

        async function checkProfile(): Promise<void> {
            // Espera tener usuario
            if (!uid) {
                setProfileComplete(null)
                return
            }

            // Ya en /configure-profile: no fuerces redirección
            if (isOnProfileRoute) {
                setProfileComplete(true)
                return
            }

            const selectedDatabase = readSelectedDatabase()
            if (!selectedDatabase) {
                setProfileComplete(false)
                return
            }

            const db = getDatabaseForUrl(selectedDatabase.url)
            if (!db) {
                setProfileComplete(false)
                return
            }

            const identifyRef = ref(db, `users/${uid}/identify`)
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
    }, [uid, isOnProfileRoute]) // Tamaño y orden constantes

    // Evita redirigir mientras se determina auth y perfil
    if (loading || profileComplete === null) {
        return <div className="p-4 text-sm text-gray-500">Cargando…</div>
    }

    if (!uid) {
        return <Navigate to="/login" replace state={{ from: location }} />
    }

    if (!isOnProfileRoute && profileComplete === false) {
        return <Navigate to="/configure-profile" />
    }

    return <Outlet />
}