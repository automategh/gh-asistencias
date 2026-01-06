import { get, ref, type Database, update, query, orderByChild, startAt, endAt, limitToFirst, equalTo } from "firebase/database"
import type { AppRole, FeatureKey, PermissionsMap, RolePermissions, UserPermissions, RoleItem, AdminUserItem } from "@/types/permissions"
import { FEATURE_KEYS } from "@/types/permissions"

/**
 * Mapa de features con valor por defecto (false) para inicialización segura.
 * Útil cuando el rol aún no tiene todas las claves configuradas en RTDB.
 * Amplía este objeto conforme se agreguen nuevos módulos/acciones.
 */
export const DEFAULT_FEATURES: PermissionsMap = {
  viewDashboard: true,
  configureProfile: true,
  viewMeetingList: true,
  viewMeeting: true,
  createMeeting: false,
  manageAttendance: false,
  manageDepartments: false,
  manageTraining: false,
  managePermissions: false,
}

/** Normaliza un mapa parcial a booleanos estrictos */
function normalizeBooleanMap(input?: Partial<Record<string, boolean>>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!input) return out
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "boolean") out[k] = v
  }
  return out
}

/**
 * Verifica que la instancia de `Database` existe.
 * Lanza error descriptivo si es null.
 *
 * @param db Instancia de RTDB o null
 * @throws Error si `db` es null
 */
function assertDatabase(db: Database | null): asserts db is Database {
  if (!db) throw new Error("La base de datos no está disponible")
}

/**
 * Obtiene permisos del rol desde `roles/{role}/features`.
 * Si la rama no existe, devuelve `DEFAULT_FEATURES` como fallback.
 *
 * @param database Instancia RTDB (no null)
 * @param role Rol de la app
 * @returns Objeto con el rol y su mapa de features normalizado
 */
export async function getRolePermissions(database: Database | null, role: AppRole): Promise<RolePermissions> {
  assertDatabase(database)
  const snap = await get(ref(database, `roles/${role}/features`))
  const raw = (snap.exists() ? (snap.val() as Partial<Record<string, boolean>>) : undefined) ?? {}
  const features: PermissionsMap = { ...DEFAULT_FEATURES, ...normalizeBooleanMap(raw) }
  return { role, features }
}

/**
 * Obtiene overrides (personalizaciones) de permisos por usuario
 * desde `userPermissions/{uid}/features`.
 * Si la rama no existe, devuelve objeto vacío.
 *
 * @param database Instancia RTDB (no null)
 * @param uid UID del usuario
 * @returns Mapa parcial de features con overrides definidos para el usuario
 */
export async function getUserPermissions(database: Database | null, uid: string): Promise<UserPermissions> {
  assertDatabase(database)
  const snap = await get(ref(database, `userPermissions/${uid}/features`))
  const raw = (snap.exists() ? (snap.val() as Partial<Record<string, boolean>>) : undefined) ?? {}
  return { uid, features: normalizeBooleanMap(raw) }
}

/**
 * Determina si el usuario tiene acceso a una feature combinando:
 * - Permiso del rol (roles/{role}/features/{feature})
 * - Override del usuario (userPermissions/{uid}/features/{feature})
 * El override del usuario, si existe, sobrescribe el valor del rol.
 *
 * @param database Instancia RTDB (no null)
 * @param params Objeto con `uid`, `role` y `feature`
 * @returns `true` si la feature está permitida, `false` en caso contrario
 */
export async function hasFeatureAccess(
  database: Database | null,
  params: { uid: string; role: AppRole; feature: FeatureKey }
): Promise<boolean> {
  assertDatabase(database)
  const [rolePerms, userPerms] = await Promise.all([
    getRolePermissions(database, params.role),
    getUserPermissions(database, params.uid),
  ])
  const roleValue = rolePerms.features[params.feature] ?? false
  const override = userPerms.features[params.feature]
  return typeof override === "boolean" ? override : roleValue
}

/**
 * Actualiza el mapa de features para un rol (upsert).
 * Escribe bajo `roles/{role}/features/{feature}`.
 *
 * @param database Instancia RTDB (no null)
 * @param role Rol objetivo
 * @param changes Mapa parcial de features a actualizar (true/false)
 */
export async function upsertRoleFeatures(
  database: Database | null,
  role: AppRole,
  changes: Partial<PermissionsMap>,
): Promise<void> {
  assertDatabase(database)
  const updates: Record<string, boolean> = {}
  for (const [feature, value] of Object.entries(changes)) {
    if (typeof value === "boolean") {
      updates[`roles/${role}/features/${feature}`] = value
    }
  }
  if (Object.keys(updates).length === 0) return
  await update(ref(database), updates)
}

/**
 * Establece (o elimina) un override de feature para un usuario.
 * Cuando `value === null`, elimina la clave de override.
 * Escribe bajo `userPermissions/{uid}/features/{feature}`.
 *
 * @param database Instancia RTDB (no null)
 * @param uid UID del usuario
 * @param feature Feature a modificar
 * @param value true/false para set; null para delete
 */
export async function setUserFeatureOverride(
  database: Database | null,
  uid: string,
  feature: FeatureKey,
  value: boolean | null,
): Promise<void> {
  assertDatabase(database)
  const path = `userPermissions/${uid}/features/${feature}`
  if (value === null) {
    // update con null elimina la clave
    await update(ref(database), { [path]: null })
  } else {
    await update(ref(database), { [path]: value })
  }
}

/**
 * Crea un rol nuevo inicializando sus features con `DEFAULT_FEATURES`.
 * Realiza escritura en bloque bajo `roles/{role}/features/*`.
 *
 * @param database Instancia RTDB (no null)
 * @param role Rol a crear
 */
export async function createRole(
  database: Database | null,
  role: AppRole,
): Promise<void> {
  assertDatabase(database)
  const base: Record<string, boolean> = {}
  for (const [feature, value] of Object.entries(DEFAULT_FEATURES)) {
    base[`roles/${role}/features/${feature}`] = value
  }
  await update(ref(database), base)
}

/**
 * Asigna un rol a un usuario.
 * Escribe en `users/{uid}/role` en la BD activa.
 *
 * @param database Instancia RTDB (no null)
 * @param uid UID del usuario
 * @param role Rol a asignar
 */
export async function setUserRole(
  database: Database | null,
  uid: string,
  role: AppRole,
): Promise<void> {
  assertDatabase(database)
  await update(ref(database), { [`users/${uid}/role`]: role })
}

/**
 * Lista roles desde RTDB y normaliza con `DEFAULT_FEATURES`.
 *
 * @param database Instancia RTDB (no null)
 * @returns Array de roles con features normalizados y ordenados por nombre
 */
export async function listRoles(database: Database | null): Promise<RoleItem[]> {
  assertDatabase(database)
  const snap = await get(ref(database, "roles"))
  const val = snap.val() as Record<string, { features?: Partial<Record<string, boolean>> }> | null
  const roleList: RoleItem[] = val ? Object.entries(val).map(([role, obj]) => ({
    role: role as AppRole,
    features: { ...DEFAULT_FEATURES, ...normalizeBooleanMap(obj.features) },
  })) : []
  roleList.sort((a, b) => a.role.localeCompare(b.role))
  return roleList
}

/**
 * Lista usuarios con `name`, `email` y `role` (si existe), ordenados por nombre.
 * Ignora usuarios sin nombre o correo.
 *
 * @param database Instancia RTDB (no null)
 * @returns Array de usuarios para administración
 */
export async function listUsers(database: Database | null): Promise<AdminUserItem[]> {
  assertDatabase(database)
  const snap = await get(ref(database, "users"))
  const val = snap.val() as Record<string, { name?: string; email?: string; role?: string | null } | undefined> | null
  const list: AdminUserItem[] = []
  if (val) {
    for (const [uid, u] of Object.entries(val)) {
      const name = String(u?.name ?? "")
      const email = String(u?.email ?? "")
      const role = (u?.role ?? null)
      if (name && email) list.push({ uid, name, email, role })
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  return list
}

/** Lista las features disponibles desde RTDB (`/features`).
 * Si el catálogo no existe, retorna los valores de `FEATURE_KEYS` como fallback.
 * Filtra por el tipo `FeatureKey` para evitar claves no reconocidas.
 *
 * Estructura esperada en RTDB:
 * {
 *   "features": {
 *     "viewDashboard": true,
 *     "createMeeting": true,
 *     ...
 *   }
 * }
 */
export async function listAvailableFeatures(database: Database | null): Promise<ReadonlyArray<FeatureKey>> {
  assertDatabase(database)
  const snap = await get(ref(database, "features"))
  if (!snap.exists()) return FEATURE_KEYS
  const obj = snap.val() as Record<string, unknown>
  const keys = Object.keys(obj) as FeatureKey[]
  return keys.length > 0 ? keys : FEATURE_KEYS
}

/** Actualiza el catálogo de features (`/features`) con los cambios indicados.
 * Solo acepta claves presentes en `FEATURE_KEYS` para mantener tipado y coherencia.
 *
 * @param database Instancia RTDB
 * @param changes Mapa parcial feature->boolean para activar/desactivar en el catálogo
 */
export async function upsertFeatureCatalog(
  database: Database | null,
  changes: Partial<Record<FeatureKey, boolean>>,
): Promise<void> {
  assertDatabase(database)
  const updates: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(changes)) {
    if (typeof v === "boolean" && k.trim().length > 0) {
      updates[`features/${k}`] = v
    }
  }
  if (Object.keys(updates).length === 0) return
  await update(ref(database), updates)
}

/** Elimina una clave del catálogo de features ('/features/<key>' = null).
 * Nota: no limpia automáticamente los roles; se recomienda revisar 'roles/<role>/features/<key>' aparte.
 *
 * @param database Instancia RTDB
 * @param key Clave del feature
 */
export async function deleteFeatureKey(
  database: Database | null,
  key: FeatureKey,
): Promise<void> {
  assertDatabase(database)
  const path = `features/${key}`
  await update(ref(database), { [path]: null })
}

/** Elimina una clave de todos los roles (roles/<role>/features/<key> = null) */
export async function removeFeatureFromAllRoles(
  database: Database | null,
  key: string,
): Promise<void> {
  assertDatabase(database)
  const snap = await get(ref(database, "roles"))
  const val = snap.val() as Record<string, { features?: Record<string, boolean> }> | null
  const updates: Record<string, null> = {}
  if (val) {
    for (const role of Object.keys(val)) {
      updates[`roles/${role}/features/${key}`] = null
    }
  }
  if (Object.keys(updates).length === 0) return
  await update(ref(database), updates as unknown as Record<string, unknown>)
}

/** Lista usuarios con paginación básica.
 * Modos soportados:
 * - Búsqueda por prefijo de nombre: orderByChild('name'), startAt(text), endAt(text + '\uf8ff')
 * - Filtro por rol: orderByChild('role'), equalTo(role)
 * Limit: por defecto 25.
 */
export async function listUsersPaged(
  database: Database | null,
  opts: { searchText?: string; roleFilter?: AppRole | "ALL"; limit?: number },
): Promise<AdminUserItem[]> {
  assertDatabase(database)
  const limit = Math.max(1, Math.min(200, opts.limit ?? 25))
  const search = (opts.searchText ?? "").trim()
  const roleFilter = opts.roleFilter ?? "ALL"

  // Dos estrategias según parámetros
  if (search) {
    // Prefijo de nombre
    const endPrefix = search + "\uf8ff"
    const qUsers = query(ref(database, "users"), orderByChild("name"), startAt(search), endAt(endPrefix), limitToFirst(limit))
    const snap = await get(qUsers)
    const val = snap.val() as Record<string, { name?: string; email?: string; role?: string | null }> | null
    const list: AdminUserItem[] = val ? Object.entries(val).map(([uid, u]) => ({
      uid,
      name: String(u.name ?? ""),
      email: String(u.email ?? ""),
      role: (u.role ?? null),
    })) : []
    return roleFilter === "ALL" ? list : list.filter((u) => u.role === roleFilter)
  }

  if (roleFilter !== "ALL") {
    // Filtrar por rol en servidor
    const qUsers = query(ref(database, "users"), orderByChild("role"), equalTo(roleFilter), limitToFirst(limit))
    const snap = await get(qUsers)
    const val = snap.val() as Record<string, { name?: string; email?: string; role?: string | null }> | null
    const list: AdminUserItem[] = val ? Object.entries(val).map(([uid, u]) => ({
      uid,
      name: String(u.name ?? ""),
      email: String(u.email ?? ""),
      role: (u.role ?? null),
    })) : []
    return list
  }

  // Sin filtro: primeros 'limit' por nombre
  const qUsers = query(ref(database, "users"), orderByChild("name"), limitToFirst(limit))
  const snap = await get(qUsers)
  const val = snap.val() as Record<string, { name?: string; email?: string; role?: string | null }> | null
  const list: AdminUserItem[] = val ? Object.entries(val).map(([uid, u]) => ({
    uid,
    name: String(u.name ?? ""),
    email: String(u.email ?? ""),
    role: (u.role ?? null),
  })) : []
  return list
}
