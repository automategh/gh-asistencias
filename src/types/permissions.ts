/**
 * Tipos del módulo de permisos/roles.
 * Define las features (módulos/acciones) y los roles de la aplicación.
 * Evita any/unknown y documenta contratos claros.
 */

/** Roles permitidos en la app */
export type AppRole = "Admin" | "Lider" | "HR" | "Instructor" | "User"

/** Clave de feature dinámica leída desde BD.
 * Se permite `string` para que el catálogo de permisos pueda crecer sin cambios de código.
 * Para claves conocidas, usa `FEATURE_KEYS` como referencia de defaults.
 */
export type FeatureKey = string

/** Mapa de permisos por feature */
export type PermissionsMap = Readonly<Record<string, boolean>>

/** Definición de permisos para un rol */
export interface RolePermissions {
  readonly role: AppRole
  readonly features: PermissionsMap
}

/** Overrides de permisos por usuario */
export interface UserPermissions {
  readonly uid: string
  readonly features: Partial<PermissionsMap>
}

/** Lista de features disponibles (tipada)
 * Úsala para construir UIs sin duplicar claves y mantener consistencia.
 */
export const FEATURE_KEYS: readonly string[] = [
  "viewDashboard",
  "configureProfile",
  "viewMeetingList",
  "viewMeeting",
  "createMeeting",
  "manageAttendance",
  "manageDepartments",
  "manageTraining",
  "managePermissions",
] as const

/** Elemento de rol para administración
 * Representa un rol con su mapa de permisos totalmente normalizado.
 */
export interface RoleItem {
  readonly role: AppRole
  readonly features: PermissionsMap
}

/** Elemento de usuario para administración
 * Usuario con datos mínimos necesarios para asignación de rol y overrides.
 */
export interface AdminUserItem {
  readonly uid: string
  readonly name: string
  readonly email: string
  readonly role?: string | null
}
