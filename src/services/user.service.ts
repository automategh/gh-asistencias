import { equalTo, get, orderByChild, query, ref, update, type Database } from "firebase/database";
import type { UserProfile } from "@/types/user";

/**
 * Obtiene los usuarios con rol "Lider" desde Realtime Database.
 * Retorna un arreglo compacto con uid, name, email y role.
 */
export async function getUserLeaders(
    database: Database
) {
    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const usersRef = ref(database, "users");
    const leadersQuery = query(
        usersRef,
        orderByChild("role"),
        equalTo("Lider")
    )
    const snapshot = await get(leadersQuery);
    const values = snapshot.val() as Record<string, Partial<UserProfile>> | null;

    if (!values) return [];

    const leaders = Object.entries(values)
        .map(([uid, data]) => ({
            uid,
            name: String(data.name ?? ""),
            email: String(data.email ?? ""),
            role: String(data.role ?? ""),
        }))
        .filter((u) => u.role.toLowerCase() === "lider" && u.name.trim().length > 0);

    return leaders;
}

/**
 * Obtiene solo los nombres de usuarios con rol "Lider".
 */
export async function getLeaderNames(database: Database) {
    const leaders = await getUserLeaders(database);
    return leaders.map((u) => u.name);
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