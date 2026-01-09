import { get, ref, type Database } from 'firebase/database'
import { getDatabaseForUrl } from '@/services/firebase'
import { type RecintoKey } from '@/lib/firebase/databaseResolver'

export interface DbDescriptor {
    readonly url: string
    readonly key: RecintoKey
}

export interface FoundDb {
    readonly url: string
    readonly key: RecintoKey
}

/**
 * Busca en qué base de datos existe el perfil del usuario (users/{uid}/identify).
 * Retorna la primera coincidencia encontrada o null si no existe en ninguna.
 */
export async function findUserDatabaseByUid(
    candidates: readonly DbDescriptor[],
    uid: string
): Promise<FoundDb | null> {
    for (const c of candidates) {
        const db = getDatabaseForUrl(c.url)
        if (!db) continue
        const exists = await userIdentifyExists(db, uid)
        if (exists) return { url: c.url, key: c.key }
    }
    return null
}

async function userIdentifyExists(database: Database, uid: string): Promise<boolean> {
    const identifyRef = ref(database, `users/${uid}/identify`)
    const snapshot = await get(identifyRef)
    return snapshot.exists()
}
