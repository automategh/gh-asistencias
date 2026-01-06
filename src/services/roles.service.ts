import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver"
import { getDatabaseForUrl } from "@/services/firebase"
import { get, ref, update, type Database } from "firebase/database"
import type { AppRole } from "@/types/permissions"
import type { CrossDbUserItem } from "@/types/user"

/**
 * Lista todos los usuarios desde todas las bases de datos disponibles.
 * Realiza una lectura completa de `users` en cada instancia y agrega metadatos
 * del recinto y la URL de la base de datos para permitir asignación de rol específica.
 */
export async function listAllUsersAcrossDatabases(): Promise<CrossDbUserItem[]> {
  const dbs = getAllAvailableDatabases()
  const results: CrossDbUserItem[] = []

  for (const dbInfo of dbs) {
    const database: Database | null = getDatabaseForUrl(dbInfo.url)
    if (!database) continue
    const snap = await get(ref(database, "users"))
    const val = snap.val() as Record<string, { name?: string; email?: string; role?: string | null }> | null
    if (!val) continue
    for (const [uid, u] of Object.entries(val)) {
      const name = String(u?.name ?? "").trim()
      const email = String(u?.email ?? "").trim()
      const role = (u?.role ?? null)
      if (!name || !email) continue
      results.push({
        uid,
        name,
        email,
        role,
        recinto: dbInfo.key as RecintoKey,
        databaseUrl: dbInfo.url,
      })
    }
  }

  // Ordenar por nombre para UX consistente
  results.sort((a, b) => a.name.localeCompare(b.name))
  return results
}

/**
 * Asigna un rol en la base de datos específica del usuario.
 * Escribe bajo `users/{uid}/role` en la instancia correspondiente.
 */
export async function assignRoleInUserDatabase(user: CrossDbUserItem, role: AppRole): Promise<void> {
  const db = getDatabaseForUrl(user.databaseUrl)
  if (!db) throw new Error("No se pudo resolver la base de datos de destino")
  await update(ref(db), { [`users/${user.uid}/role`]: role })
}

/**
 * Filtro utilitario en memoria para búsqueda y filtros de recinto/rol.
 */
export function filterUsers(
  users: ReadonlyArray<CrossDbUserItem>,
  opts: { searchText?: string; recinto?: RecintoKey | "ALL"; role?: AppRole | "ALL" }
): CrossDbUserItem[] {
  const search = (opts.searchText ?? "").trim().toLowerCase()
  const recintoFilter = opts.recinto ?? "ALL"
  const roleFilter = opts.role ?? "ALL"
  return users.filter((u) => {
    const matchesSearch = !search || u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search)
    const matchesRecinto = recintoFilter === "ALL" || u.recinto === recintoFilter
    const matchesRole = roleFilter === "ALL" || u.role === roleFilter
    return matchesSearch && matchesRecinto && matchesRole
  })
}
