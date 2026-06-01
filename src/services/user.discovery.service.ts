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

interface DiscoverableUserProfile {
    readonly identify?: string | null
    readonly department?: string | null
    readonly immediateBoss?: string | null
    readonly cargo?: string | null
    readonly companyName?: string | null
    readonly signatureUrl?: string | null
}

function isProfileComplete(profile: DiscoverableUserProfile | null): boolean {
    if (!profile) {
        return false
    }

    const worksAtHeroica = !profile.companyName || profile.companyName.trim().length === 0

    return [
        profile.identify,
        profile.department,
        profile.signatureUrl,
        profile.cargo,
        worksAtHeroica ? profile.immediateBoss : "ok",
    ].every((value) => typeof value === 'string' && value.trim().length > 0)
}

/**
 * Busca en qué base de datos existe el perfil completo del usuario.
 * Retorna la primera coincidencia encontrada o null si no existe en ninguna.
 */
export async function findUserDatabaseByUid(
    candidates: readonly DbDescriptor[],
    uid: string
): Promise<FoundDb | null> {
    for (const c of candidates) {
        const db = getDatabaseForUrl(c.url)
        if (!db) continue
        const exists = await userProfileIsComplete(db, uid)
        if (exists) return { url: c.url, key: c.key }
    }
    return null
}

async function userProfileIsComplete(database: Database, uid: string): Promise<boolean> {
    const profileRef = ref(database, `users/${uid}`)
    const snapshot = await get(profileRef)
    const data = snapshot.val() as DiscoverableUserProfile | null
    return isProfileComplete(data)
}
