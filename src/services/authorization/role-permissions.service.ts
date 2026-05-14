import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver"
import { getDatabaseForUrl } from "@/services/firebase"
import type { AppRole } from "@/types/permissions"
import type {
  AuthorizationCatalogSnapshot,
  ManageableRoleDefinition,
  PermissionDefinition,
  PermissionId,
  RoleDefinition,
  RoleId,
  RoleScope,
  RoleSeed,
  UserAuthorizationAssignment,
} from "@/types/authorization"
import { get, ref, runTransaction, set, update, type Database } from "firebase/database"

const AUTHORIZATION_VERSION = 1

interface StoredPermissionDefinition extends PermissionDefinition {
  readonly version: number
}

interface StoredRoleDefinition extends RoleDefinition {
  readonly version: number
}

interface AuthorizationSeedResult {
  readonly recinto: RecintoKey
  readonly databaseUrl: string
  readonly permissionsSeeded: number
  readonly rolesSeeded: number
}

interface LegacyRoleMigrationResult {
  readonly recinto: RecintoKey
  readonly databaseUrl: string
  readonly usersMigrated: number
}

export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  { id: "dashboard_view", label: "Ver dashboard", description: "Permite acceder al dashboard principal.", category: "dashboard", system: true, active: true },
  { id: "profile_edit_self", label: "Editar perfil propio", description: "Permite editar el propio perfil.", category: "profile", system: true, active: true },
  { id: "meetings_view", label: "Ver actividades", description: "Permite acceder al listado y detalle de actividades.", category: "meetings", system: true, active: true },
  { id: "meetings_create", label: "Crear actividades", description: "Permite crear actividades o capacitaciones.", category: "meetings", system: true, active: true },
  { id: "meetings_attendance_view", label: "Ver asistencias", description: "Permite consultar la pantalla de asistencias.", category: "meetings", system: true, active: true },
  { id: "meetings_manage_owned", label: "Gestionar actividades propias", description: "Permite gestionar actividades creadas por el usuario o donde sea manager.", category: "meetings", system: true, active: true },
  { id: "meetings_manage_any", label: "Gestionar cualquier actividad", description: "Permite gestionar cualquier actividad sin restriccion por ownership.", category: "meetings", system: true, active: true },
  { id: "reports_view_team", label: "Ver reportes de equipo", description: "Permite acceder a reportes acotados al equipo o alcance del usuario.", category: "reports", system: true, active: true },
  { id: "reports_view_all", label: "Ver reportes globales", description: "Permite acceder a reportes globales de la organizacion.", category: "reports", system: true, active: true },
  { id: "surveys_respond", label: "Responder encuestas", description: "Permite responder encuestas asociadas a actividades.", category: "surveys", system: true, active: true },
  { id: "surveys_admin_view", label: "Administrar encuestas", description: "Permite ver el modulo administrativo de encuestas.", category: "surveys", system: true, active: true },
  { id: "surveys_create", label: "Crear encuestas", description: "Permite crear encuestas nuevas.", category: "surveys", system: true, active: true },
  { id: "surveys_edit", label: "Editar encuestas", description: "Permite editar y eliminar encuestas existentes.", category: "surveys", system: true, active: true },
  { id: "surveys_results_view", label: "Ver resultados de encuestas", description: "Permite consultar resultados analiticos de encuestas.", category: "surveys", system: true, active: true },
  { id: "departments_manage", label: "Administrar areas", description: "Permite administrar departamentos o areas.", category: "configuration", system: true, active: true },
  { id: "user_grouping_manage", label: "Administrar agrupaciones", description: "Permite administrar formas de agrupacion de usuarios.", category: "configuration", system: true, active: true },
  { id: "users_view", label: "Ver usuarios", description: "Permite consultar usuarios y su estado.", category: "users", system: true, active: true },
  { id: "users_activate", label: "Activar usuarios", description: "Permite activar usuarios en el sistema.", category: "users", system: true, active: true },
  { id: "users_deactivate", label: "Desactivar usuarios", description: "Permite desactivar usuarios en el sistema.", category: "users", system: true, active: true },
  { id: "users_assign_role", label: "Asignar roles a usuarios", description: "Permite cambiar el rol asignado a usuarios.", category: "users", system: true, active: true },
  { id: "roles_view", label: "Ver roles", description: "Permite consultar el catalogo de roles.", category: "roles", system: true, active: true },
  { id: "roles_manage", label: "Administrar roles", description: "Permite crear, editar y eliminar roles.", category: "roles", system: true, active: true },
] as const

export const LEGACY_ROLE_TO_ROLE_ID: Readonly<Record<AppRole, RoleId>> = {
  Admin: "admin",
  HR: "hr",
  Lider: "lider",
  Instructor: "instructor",
  User: "user",
}

const buildPermissionMap = (permissions: readonly PermissionId[]) => {
  return permissions.reduce<Partial<Record<PermissionId, boolean>>>((accumulator, permissionId) => {
    accumulator[permissionId] = true
    return accumulator
  }, {})
}

export const SYSTEM_ROLE_SEEDS: readonly RoleSeed[] = [
  {
    id: "admin",
    name: "Admin",
    displayName: "Administrador",
    description: "Acceso total a configuracion, roles, usuarios, reportes y operaciones globales.",
    scope: "global",
    syncKey: "system:admin",
    system: true,
    active: true,
    permissions: buildPermissionMap(PERMISSION_DEFINITIONS.map((permission) => permission.id)),
  },
  {
    id: "hr",
    name: "HR",
    displayName: "Talento Humano",
    description: "Gestion operativa de personas, reportes globales, encuestas y configuracion organizacional.",
    scope: "global",
    syncKey: "system:hr",
    system: true,
    active: true,
    permissions: buildPermissionMap([
      "dashboard_view",
      "profile_edit_self",
      "meetings_view",
      "meetings_create",
      "meetings_attendance_view",
      "meetings_manage_any",
      "reports_view_all",
      "surveys_respond",
      "surveys_admin_view",
      "surveys_create",
      "surveys_edit",
      "surveys_results_view",
      "departments_manage",
      "user_grouping_manage",
      "users_view",
      "users_activate",
      "users_deactivate",
      "users_assign_role",
      "roles_view",
    ]),
  },
  {
    id: "lider",
    name: "Lider",
    displayName: "Lider",
    description: "Gestion de actividades propias y acceso a reportes de su equipo.",
    scope: "global",
    syncKey: "system:lider",
    system: true,
    active: true,
    permissions: buildPermissionMap([
      "dashboard_view",
      "profile_edit_self",
      "meetings_view",
      "meetings_create",
      "meetings_attendance_view",
      "meetings_manage_owned",
      "reports_view_team",
      "surveys_respond",
    ]),
  },
  {
    id: "instructor",
    name: "Instructor",
    displayName: "Instructor",
    description: "Gestion de actividades propias y consulta de asistencias.",
    scope: "global",
    syncKey: "system:instructor",
    system: true,
    active: true,
    permissions: buildPermissionMap([
      "dashboard_view",
      "profile_edit_self",
      "meetings_view",
      "meetings_create",
      "meetings_attendance_view",
      "meetings_manage_owned",
      "surveys_respond",
    ]),
  },
  {
    id: "user",
    name: "User",
    displayName: "Usuario",
    description: "Acceso basico a perfil, actividades, check-in y respuesta de encuestas.",
    scope: "global",
    syncKey: "system:user",
    system: true,
    active: true,
    permissions: buildPermissionMap([
      "dashboard_view",
      "profile_edit_self",
      "meetings_view",
      "surveys_respond",
    ]),
  },
] as const

const SYSTEM_ROLE_IDS = new Set<RoleId>(SYSTEM_ROLE_SEEDS.map((role) => role.id))

const buildStoredPermission = (definition: PermissionDefinition): StoredPermissionDefinition => ({
  ...definition,
  version: AUTHORIZATION_VERSION,
})

const buildStoredRole = (seed: RoleSeed, nowIso: string): StoredRoleDefinition => ({
  ...seed,
  permissions: { ...seed.permissions },
  createdAt: nowIso,
  updatedAt: nowIso,
  version: AUTHORIZATION_VERSION,
})

const ensureDatabase = (database: Database | null): Database => {
  if (!database) {
    throw new Error("No se pudo resolver la base de datos de destino")
  }

  return database
}

const getRoleScope = (role: Pick<RoleDefinition, "id" | "system" | "scope">): RoleScope => {
  if (role.scope === "global" || role.system || SYSTEM_ROLE_IDS.has(role.id)) {
    return "global"
  }

  return "local"
}

const getRoleSyncKey = (role: Pick<RoleDefinition, "id" | "syncKey" | "scope" | "system">): string => {
  if (role.syncKey.trim().length > 0) {
    return role.syncKey
  }

  return getRoleScope(role) === "global" ? `system:${role.id}` : `local:${role.id}`
}

const normalizeRoleRecord = (role: StoredRoleDefinition): StoredRoleDefinition => ({
  ...role,
  scope: getRoleScope(role),
  syncKey: getRoleSyncKey(role),
  permissions: { ...role.permissions },
})

const listTargetDatabasesForRole = (role: Pick<RoleDefinition, "id" | "scope" | "system">, sourceDatabase: Database): Database[] => {
  if (getRoleScope(role) === "local") {
    return [sourceDatabase]
  }

  return getAllAvailableDatabases()
    .map((databaseInfo) => getDatabaseForUrl(databaseInfo.url))
    .filter((database): database is Database => database !== null)
}

const buildStoredRoleFromInput = (
  role: Omit<RoleDefinition, "createdAt" | "updatedAt"> & { readonly createdAt?: string },
  existingRole: StoredRoleDefinition | null,
  nowIso: string,
): StoredRoleDefinition => {
  const scope = getRoleScope(role)

  return {
    ...role,
    scope,
    syncKey: getRoleSyncKey({ ...role, scope }),
    createdAt: existingRole?.createdAt ?? role.createdAt ?? nowIso,
    updatedAt: nowIso,
    permissions: { ...role.permissions },
    version: AUTHORIZATION_VERSION,
  }
}

const hasAssignedUsersInDatabase = async (database: Database, roleId: RoleId): Promise<boolean> => {
  const usersSnapshot = await get(ref(database, "users"))
  const users = usersSnapshot.val() as Record<string, { roleId?: string | null }> | null

  if (!users) {
    return false
  }

  return Object.values(users).some((user) => user.roleId === roleId)
}

export const getLegacyRoleFromRoleId = (roleId: RoleId): AppRole => {
  const entry = Object.entries(LEGACY_ROLE_TO_ROLE_ID).find(([, value]) => value === roleId)
  return (entry?.[0] ?? "User") as AppRole
}

export const isGlobalRole = (role: Pick<RoleDefinition, "id" | "scope" | "system">): boolean => {
  return getRoleScope(role) === "global"
}

export async function ensureAuthorizationCatalog(database: Database): Promise<AuthorizationCatalogSnapshot> {
  const nowIso = new Date().toISOString()

  await Promise.all([
    ...PERMISSION_DEFINITIONS.map(async (definition) => {
      const permissionRef = ref(database, `permissionDefinitions/${definition.id}`)
      await runTransaction(permissionRef, (currentValue: StoredPermissionDefinition | null) => {
        if (currentValue) {
          return {
            ...currentValue,
            label: currentValue.label || definition.label,
            description: currentValue.description || definition.description,
            category: currentValue.category || definition.category,
            system: currentValue.system ?? definition.system,
            active: currentValue.active ?? definition.active,
            version: AUTHORIZATION_VERSION,
          }
        }

        return buildStoredPermission(definition)
      })
    }),
    ...SYSTEM_ROLE_SEEDS.map(async (seed) => {
      const roleRef = ref(database, `roles/${seed.id}`)
      await runTransaction(roleRef, (currentValue: StoredRoleDefinition | null) => {
        if (currentValue) {
          return {
            ...currentValue,
            displayName: currentValue.displayName || seed.displayName,
            description: currentValue.description || seed.description,
            scope: currentValue.scope ?? seed.scope,
            syncKey: currentValue.syncKey || seed.syncKey,
            system: currentValue.system ?? seed.system,
            active: currentValue.active ?? seed.active,
            permissions: {
              ...seed.permissions,
              ...currentValue.permissions,
            },
            updatedAt: currentValue.updatedAt || nowIso,
            createdAt: currentValue.createdAt || nowIso,
            version: AUTHORIZATION_VERSION,
          }
        }

        return buildStoredRole(seed, nowIso)
      })
    }),
  ])

  return getAuthorizationCatalog(database)
}

export async function ensureAuthorizationCatalogAcrossDatabases(): Promise<AuthorizationSeedResult[]> {
  const databases = getAllAvailableDatabases()
  const results: AuthorizationSeedResult[] = []

  for (const databaseInfo of databases) {
    const database = ensureDatabase(getDatabaseForUrl(databaseInfo.url))
    const snapshot = await ensureAuthorizationCatalog(database)
    results.push({
      recinto: databaseInfo.key,
      databaseUrl: databaseInfo.url,
      permissionsSeeded: snapshot.permissions.length,
      rolesSeeded: snapshot.roles.length,
    })
  }

  return results
}

export async function getAuthorizationCatalog(database: Database): Promise<AuthorizationCatalogSnapshot> {
  const [permissionsSnapshot, rolesSnapshot] = await Promise.all([
    get(ref(database, "permissionDefinitions")),
    get(ref(database, "roles")),
  ])

  const permissionDefinitions = permissionsSnapshot.val() as Record<string, StoredPermissionDefinition> | null
  const roleDefinitions = rolesSnapshot.val() as Record<string, StoredRoleDefinition> | null

  const permissions = permissionDefinitions
    ? Object.values(permissionDefinitions).sort((first, second) => first.label.localeCompare(second.label, "es-ES"))
    : []

  const roles = roleDefinitions
    ? Object.values(roleDefinitions)
        .map((role) => normalizeRoleRecord(role))
        .sort((first, second) => first.displayName.localeCompare(second.displayName, "es-ES"))
    : []

  return { permissions, roles }
}

export async function listRoles(database: Database): Promise<RoleDefinition[]> {
  const snapshot = await get(ref(database, "roles"))
  const roleDefinitions = snapshot.val() as Record<string, StoredRoleDefinition> | null

  if (!roleDefinitions) {
    return []
  }

  return Object.values(roleDefinitions)
    .map((role) => normalizeRoleRecord(role))
    .sort((first, second) => first.displayName.localeCompare(second.displayName, "es-ES"))
}

export async function listRolesAcrossDatabases(): Promise<ManageableRoleDefinition[]> {
  const databases = getAllAvailableDatabases()
  const aggregatedRoles = new Map<string, ManageableRoleDefinition>()

  for (const databaseInfo of databases) {
    const database = getDatabaseForUrl(databaseInfo.url)
    if (!database) {
      continue
    }

    const roles = await listRoles(database)

    for (const role of roles) {
      const key = isGlobalRole(role) ? role.syncKey : `${databaseInfo.key}:${role.id}`
      const existingRole = aggregatedRoles.get(key)

      if (existingRole) {
        aggregatedRoles.set(key, {
          ...existingRole,
          availableInDatabaseUrls: [...existingRole.availableInDatabaseUrls, databaseInfo.url],
          availableInRecintos: [...existingRole.availableInRecintos, databaseInfo.key],
        })
        continue
      }

      aggregatedRoles.set(key, {
        ...role,
        sourceDatabaseUrl: databaseInfo.url,
        sourceRecinto: databaseInfo.key,
        availableInDatabaseUrls: [databaseInfo.url],
        availableInRecintos: [databaseInfo.key],
      })
    }
  }

  return Array.from(aggregatedRoles.values()).sort((first, second) => {
    if (first.scope !== second.scope) {
      return first.scope === "global" ? -1 : 1
    }

    return first.displayName.localeCompare(second.displayName, "es-ES")
  })
}

export async function upsertRole(database: Database, role: Omit<RoleDefinition, "createdAt" | "updatedAt"> & { readonly createdAt?: string }): Promise<RoleDefinition> {
  const nowIso = new Date().toISOString()
  const targetDatabases = listTargetDatabasesForRole(role, database)
  let primaryRole: StoredRoleDefinition | null = null

  for (const targetDatabase of targetDatabases) {
    const existingSnapshot = await get(ref(targetDatabase, `roles/${role.id}`))
    const existingRole = existingSnapshot.val() as StoredRoleDefinition | null
    const nextRole = buildStoredRoleFromInput(role, existingRole, nowIso)
    await set(ref(targetDatabase, `roles/${role.id}`), nextRole)

    if (!primaryRole) {
      primaryRole = nextRole
    }
  }

  if (!primaryRole) {
    throw new Error("No fue posible persistir el rol")
  }

  return primaryRole
}

export async function deleteRole(database: Database, roleId: RoleId): Promise<void> {
  const roleSnapshot = await get(ref(database, `roles/${roleId}`))
  const role = roleSnapshot.val() as StoredRoleDefinition | null

  if (!role) {
    return
  }

  if (role.system) {
    throw new Error("No es posible eliminar un rol del sistema")
  }

  const targetDatabases = listTargetDatabasesForRole(role, database)

  for (const targetDatabase of targetDatabases) {
    if (await hasAssignedUsersInDatabase(targetDatabase, roleId)) {
      throw new Error("No es posible eliminar un rol asignado a usuarios")
    }
  }

  await Promise.all(targetDatabases.map((targetDatabase) => set(ref(targetDatabase, `roles/${roleId}`), null)))
}

export async function assignRoleIdToUser(database: Database, userId: string, assignment: UserAuthorizationAssignment): Promise<void> {
  await update(ref(database), {
    [`users/${userId}/roleId`]: assignment.roleId,
    [`users/${userId}/role`]: assignment.legacyRole,
  })
}

export async function migrateLegacyRolesToRoleIds(database: Database): Promise<number> {
  const snapshot = await get(ref(database, "users"))
  const users = snapshot.val() as Record<string, { role?: string | null; roleId?: string | null }> | null

  if (!users) {
    return 0
  }

  const updates: Record<string, string> = {}

  for (const [userId, user] of Object.entries(users)) {
    if (typeof user.roleId === "string" && user.roleId.trim().length > 0) {
      continue
    }

    const legacyRole = (user.role ?? "User") as AppRole
    updates[`users/${userId}/roleId`] = LEGACY_ROLE_TO_ROLE_ID[legacyRole] ?? "user"
  }

  const updateEntries = Object.entries(updates)
  if (updateEntries.length === 0) {
    return 0
  }

  await update(ref(database), updates)
  return updateEntries.length
}

export async function migrateLegacyRolesToRoleIdsAcrossDatabases(): Promise<LegacyRoleMigrationResult[]> {
  const databases = getAllAvailableDatabases()
  const results: LegacyRoleMigrationResult[] = []

  for (const databaseInfo of databases) {
    const database = ensureDatabase(getDatabaseForUrl(databaseInfo.url))
    const usersMigrated = await migrateLegacyRolesToRoleIds(database)

    results.push({
      recinto: databaseInfo.key,
      databaseUrl: databaseInfo.url,
      usersMigrated,
    })
  }

  return results
}
