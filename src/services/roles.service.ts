import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver"
import { getDatabaseForUrl } from "@/services/firebase"
import { get, ref, update, type Database } from "firebase/database"

import type { CrossDbUserItem } from "@/types/user"
import type { AppRole } from "@/types/permissions"

/**
 * Lista todos los usuarios desde todas las bases de datos disponibles.
 *
 * - Lee el nodo `users` de cada instancia configurada.
 * - Normaliza nombre, correo, rol y estado activo.
 * - Adjunta metadatos de recinto (key) y `databaseUrl` para futuras operaciones.
 * - Devuelve la lista ordenada alfabéticamente por nombre para mejor UX.
 */
export async function listAllUsersAcrossDatabases(): Promise<CrossDbUserItem[]> {
  const dbs = getAllAvailableDatabases()
  const results: CrossDbUserItem[] = []

  for (const dbInfo of dbs) {
    const database: Database | null = getDatabaseForUrl(dbInfo.url)
    if (!database) continue
    const snap = await get(ref(database, "users"))
    const val = snap.val() as Record<string, { name?: string; email?: string; role?: string | null; active?: boolean | null; department?: string | null }> | null
    if (!val) continue
    for (const [uid, u] of Object.entries(val)) {
      const name = String(u?.name ?? "").trim()
      const email = String(u?.email ?? "").trim()
      const role = (u?.role ?? null)
      const active = (u?.active ?? null)
      const department = (u?.department ?? null)
      if (!name || !email) continue
      results.push({
        uid,
        name,
        email,
        role,
        active,
        department,
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
 * Asigna un rol de aplicación a un usuario en su base de datos de origen.
 *
 * Escribe bajo `users/{uid}/role` en la instancia correspondiente, usando
 * la `databaseUrl` incluida en el `CrossDbUserItem`.
 */
export async function assignRoleInUserDatabase(user: CrossDbUserItem, role: AppRole): Promise<void> {
  const db = getDatabaseForUrl(user.databaseUrl)
  if (!db) throw new Error("No se pudo resolver la base de datos de destino")
  await update(ref(db), { [`users/${user.uid}/role`]: role })
}

/**
 * Activa a un usuario en su base de datos específica.
 *
 * Escribe `users/{uid}/active = true` en la instancia correspondiente,
 * respetando siempre la BD indicada por `user.databaseUrl`.
 */
export async function activateUserInUserDatabase(user: CrossDbUserItem): Promise<void> {
  const db = getDatabaseForUrl(user.databaseUrl)
  if (!db) throw new Error("No se pudo resolver la base de datos de destino")
  await update(ref(db), { [`users/${user.uid}/active`]: true })
}

/**
 * Desactiva a un usuario en su base de datos específica.
 *
 * Escribe `users/{uid}/active = false` en la instancia correspondiente,
 * respetando siempre la BD indicada por `user.databaseUrl`.
 */
export async function deactivateUserInUserDatabase(user: CrossDbUserItem): Promise<void> {
  const db = getDatabaseForUrl(user.databaseUrl)
  if (!db) throw new Error("No se pudo resolver la base de datos de destino")
  await update(ref(db), { [`users/${user.uid}/active`]: false })
}

/**
 * Filtro utilitario en memoria para trabajar con listados de usuarios cruzados.
 *
 * Permite combinar búsqueda por texto (nombre/correo) con filtros de recinto,
 * rol y estado activo/inactivo sin reconsultar la base de datos.
 */
export function filterUsers(
  users: ReadonlyArray<CrossDbUserItem>,
  opts: { searchText?: string; recinto?: RecintoKey | "ALL"; role?: AppRole | "ALL"; active?: boolean | "ALL" }
): CrossDbUserItem[] {
  const search = (opts.searchText ?? "").trim().toLowerCase()
  const recintoFilter = opts.recinto ?? "ALL"
  const roleFilter = opts.role ?? "ALL"
  const activeFilter = opts.active ?? "ALL"
  return users.filter((u) => {
    const matchesSearch = !search || u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search)
    const matchesRecinto = recintoFilter === "ALL" || u.recinto === recintoFilter
    const matchesRole = roleFilter === "ALL" || u.role === roleFilter
    const matchesActive = activeFilter === "ALL" || (!!u.active === activeFilter)
    return matchesSearch && matchesRecinto && matchesRole && matchesActive
  })
}
