import { get, ref, update, type Database } from "firebase/database";
import type { UserProfile } from "@/types/user";
import { getAllAvailableDatabases } from "@/lib/firebase/databaseResolver";
import { getDatabaseForUrl } from "@/services/firebase";

/**
 * Obtiene los usuarios que pueden actuar como líder dentro de la organización.
 *
 * Criterios de liderazgo:
 * - Tener permisos de alcance de equipo en su rol (`reports_view_team` o `meetings_manage_owned`).
 * - Tener rol legado `Lider` (compatibilidad).
 * - Estar referenciado como `immediateBoss` por al menos un usuario.
 */
export async function getUserLeaders(
    database: Database
) {
    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const usersRef = ref(database, "users");
    const snapshot = await get(usersRef);
    const values = snapshot.val() as Record<string, Partial<UserProfile>> | null;

    if (!values) return [];

    const rolesSnapshot = await get(ref(database, "roles"));
    const roles = rolesSnapshot.val() as Record<string, {
        readonly permissions?: Partial<Record<string, boolean>> | null
    }> | null;

    const roleIdsWithTeamScope = new Set<string>(
        Object.entries(roles ?? {})
            .filter(([, role]) => {
                const permissions = role.permissions ?? null
                if (!permissions) {
                    return false
                }

                return permissions.reports_view_team === true || permissions.meetings_manage_owned === true
            })
            .map(([roleId]) => roleId.trim().toLowerCase()),
    )

    const referencedBossNames = new Set<string>(
        Object.values(values)
            .map((user) => (typeof user.immediateBoss === "string" ? user.immediateBoss.trim().toLowerCase() : ""))
            .filter((bossName) => bossName.length > 0),
    )

    const leaders = Object.entries(values)
        .map(([uid, data]) => ({
            uid,
            name: String(data.name ?? ""),
            email: String(data.email ?? ""),
            role: String(data.role ?? ""),
            roleId: String(data.roleId ?? ""),
            isLeader: typeof data.isLeader === "boolean" ? data.isLeader : null,
        }))
        .filter((userCandidate) => {
            const cleanName = userCandidate.name.trim()
            if (cleanName.length === 0) {
                return false
            }

            if (userCandidate.isLeader === true) {
                return true
            }

            if (userCandidate.isLeader === false) {
                return false
            }

            const normalizedRole = userCandidate.role.trim().toLowerCase()
            const normalizedRoleId = userCandidate.roleId.trim().toLowerCase()
            const hasLegacyLeaderRole = normalizedRole === "lider"
            const hasTeamScopedPermission = normalizedRoleId.length > 0 && roleIdsWithTeamScope.has(normalizedRoleId)
            const isReferencedAsBoss = referencedBossNames.has(cleanName.toLowerCase())

            return hasLegacyLeaderRole || hasTeamScopedPermission || isReferencedAsBoss
        })
        .sort((first, second) => first.name.localeCompare(second.name));

    return leaders;
}

/**
 * Obtiene solo los nombres de usuarios con rol "Lider".
 */
export async function getLeaderNames(database: Database) {
    const leaders = await getUserLeaders(database);
    const uniqueNames = Array.from(new Set(leaders.map((user) => user.name.trim())))
        .filter((name) => name.length > 0)
        .sort((first, second) => first.localeCompare(second))

    return uniqueNames;
}

/**
 * Representa un usuario simplificado para uso en vistas de reportes e indicadores.
 */
export interface ReportUserItem {
    readonly uid: string
    readonly name: string
    readonly email: string
    readonly department?: string | null
    readonly cargo?: string | null
    readonly immediateBoss?: string | null
}

/**
 * Obtiene usuarios para vistas de reportes.
 *
 * - Si se pasa `leaderName`, solo devuelve usuarios cuyo `immediateBoss`
 *   coincide (ignorando mayúsculas/minúsculas y espacios).
 * - Filtra usuarios sin nombre o email válidos.
 */
export async function getUsersForReports(
    database: Database,
    options?: { leaderName?: string | null },
): Promise<ReportUserItem[]> {
    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const usersRef = ref(database, "users");
    const snapshot = await get(usersRef);
    const raw = snapshot.val() as Record<string, Partial<UserProfile>> | null;

    if (!raw) {
        return [];
    }

    const normalizedLeader = typeof options?.leaderName === "string" && options.leaderName.trim().length > 0
        ? options.leaderName.trim().toLowerCase()
        : null;

    const items: ReportUserItem[] = [];

    for (const [uid, data] of Object.entries(raw)) {
        const name = typeof data.name === "string" ? data.name.trim() : "";
        const email = typeof data.email === "string" ? data.email.trim() : "";

        if (!name || !email) {
            continue;
        }

        if (normalizedLeader) {
            const bossRaw = typeof data.immediateBoss === "string" ? data.immediateBoss : null;
            const bossNormalized = bossRaw ? bossRaw.trim().toLowerCase() : "";
            if (!bossNormalized || bossNormalized !== normalizedLeader) {
                continue;
            }
        }

        items.push({
            uid,
            name,
            email,
            department: typeof data.department === "string" ? data.department : data.department ?? null,
            cargo: typeof data.cargo === "string" ? data.cargo : data.cargo ?? null,
            immediateBoss: typeof data.immediateBoss === "string" ? data.immediateBoss : data.immediateBoss ?? null,
        });
    }

    items.sort((first, second) => first.name.localeCompare(second.name));

    return items;
}

/**
 * Caché en memoria para resolver el cargo de usuarios durante una misma operación
 * (por ejemplo, al exportar el plan de formación a Excel).
 *
 * Clave: UID del usuario
 * Valor: cargo resuelto (cadena vacía cuando no existe o no está definido).
 */
export type UserCargoCache = Record<string, string>

/**
 * Caché por email para búsquedas de cargo en todas las bases de datos.
 * Clave: email normalizado (lowercase, sin espacios).
 * Valor: cargo resuelto (cadena vacía cuando no existe o no está definido).
 */
export type UserEmailCargoCache = Record<string, string>

/**
 * Carga un mapa uid -> cargo para todos los usuarios en la base de datos.
 *
 * Se utiliza en operaciones de reporte/exportación donde es preferible
 * resolver todos los cargos en una sola lectura a `users`.
 */
export async function loadUsersCargoMap(database: Database): Promise<UserCargoCache> {
    if (!database) {
        throw new Error("La base de datos no está disponible")
    }

    const usersRef = ref(database, "users")
    const snapshot = await get(usersRef)
    const values = snapshot.val() as Record<string, UserProfile> | null

    const result: UserCargoCache = {}
    if (!values) {
        return result
    }

    for (const [uid, data] of Object.entries(values)) {
        const cargo = typeof data.cargo === "string" ? data.cargo : ""
        result[uid] = cargo
    }

    return result
}

/**
 * Obtiene el perfil de usuario desde la base de datos por UID.
 * @param uid UID del usuario
 * @returns UserProfile o null si no existe
 */
export async function getUserProfile(uid: string, database: Database): Promise<UserProfile | null> {
    try {
        
        const userRef = ref(database, `users/${uid}`)
        const snapshot = await get(userRef)
        if (!snapshot.exists()) return null
        return snapshot.val() as UserProfile
    } catch (error) {
        console.error("Error al obtener perfil de usuario:", error)
        return null
    }
}

/**
 * Resuelve el cargo de un usuario desde Realtime Database utilizando un caché en memoria
 * para evitar lecturas repetidas del mismo UID.
 *
 * - Si el UID ya fue resuelto previamente, devuelve el valor desde `cache`.
 * - Si no, consulta el perfil con `getUserProfile`, extrae `cargo` y lo almacena en caché.
 * - Devuelve siempre una cadena (vacía cuando no hay cargo definido).
 */
export async function resolveUserCargo(
    uid: string,
    database: Database,
    cache: UserCargoCache,
): Promise<string> {
    if (!uid || !database) {
        return ""
    }

    const cached = cache[uid]
    if (cached !== undefined) {
        return cached
    }

    try {
        const profile = await getUserProfile(uid, database)
        const cargo = typeof profile?.cargo === "string" ? profile.cargo : ""
        cache[uid] = cargo
        return cargo
    } catch {
        cache[uid] = ""
        return ""
    }
}

/**
 * Busca el cargo de un usuario por email recorriendo todas las bases de datos
 * configuradas en la aplicación. Utiliza un caché en memoria para no repetir
 * escaneos por el mismo email durante una misma operación.
 */
export async function resolveCrossDbUserCargoByEmail(
    email: string | null | undefined,
    cache: UserEmailCargoCache,
): Promise<string> {
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : ""
    if (!normalizedEmail) {
        return ""
    }

    const cached = cache[normalizedEmail]
    if (cached !== undefined) {
        return cached
    }

    const databases = getAllAvailableDatabases()

    for (const dbInfo of databases) {
        const db = getDatabaseForUrl(dbInfo.url)
        if (!db) continue

        const usersRef = ref(db, "users")
        const snapshot = await get(usersRef)
        const values = snapshot.val() as Record<string, UserProfile> | null
        if (!values) continue

        for (const data of Object.values(values)) {
            const userEmail = typeof data.email === "string" ? data.email.trim().toLowerCase() : ""
            if (!userEmail || userEmail !== normalizedEmail) {
                continue
            }

            const cargo = typeof data.cargo === "string" ? data.cargo : ""
            cache[normalizedEmail] = cargo
            return cargo
        }
    }

    cache[normalizedEmail] = ""
    return ""
}

export async function updateUserProfile(database: Database, uid: string, profileData: Partial<UserProfile>) {
    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const userRef = ref(database, `users/${uid}`);
    await get(userRef); // Asegura que la referencia existe antes de actualizar

    await update(userRef, profileData);

    const updatedSnapshot = await get(userRef);
    return updatedSnapshot.val() as UserProfile;
}