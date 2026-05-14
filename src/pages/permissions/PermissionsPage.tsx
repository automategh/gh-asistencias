import Layout from "@/components/layouts/layout"
import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver"
import {
  deleteRole,
  ensureAuthorizationCatalogAcrossDatabases,
  getAuthorizationCatalog,
  getLegacyRoleFromRoleId,
  isGlobalRole,
  listRolesAcrossDatabases,
  upsertRole,
} from "@/services/authorization/role-permissions.service"
import { getDatabaseForUrl } from "@/services/firebase"
import {
  activateUserInUserDatabase,
  assignRoleInUserDatabase,
  deactivateUserInUserDatabase,
  filterUsers,
  listAllUsersAcrossDatabases,
  setUserLeaderInUserDatabase,
} from "@/services/roles.service"
import type {
  ManageableRoleDefinition,
  PermissionDefinition,
  PermissionId,
  PermissionMap,
  RoleScope,
} from "@/types/authorization"
import type { CrossDbUserItem } from "@/types/user"
import { ChevronRight, PencilLine, Plus, ShieldCheck, Trash2, Users } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

interface RoleDraftState {
  readonly originalRoleId: string | null
  readonly id: string
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly scope: RoleScope
  readonly sourceRecinto: RecintoKey
  readonly syncKey: string
  readonly system: boolean
  readonly active: boolean
  readonly createdAt?: string
  readonly permissions: PermissionMap
}

const EMPTY_PERMISSION_MAP: PermissionMap = {}

const createRoleIdFromLabel = (value: string): string => {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const buildRoleSyncKey = (roleId: string, scope: RoleScope, recinto: RecintoKey): string => {
  return scope === "global" ? `custom:${roleId}` : `local:${recinto}:${roleId}`
}

const buildEmptyDraft = (recinto: RecintoKey): RoleDraftState => ({
  originalRoleId: null,
  id: "",
  name: "",
  displayName: "",
  description: "",
  scope: "global",
  sourceRecinto: recinto,
  syncKey: "",
  system: false,
  active: true,
  permissions: EMPTY_PERMISSION_MAP,
})

const buildDraftFromRole = (role: ManageableRoleDefinition): RoleDraftState => ({
  originalRoleId: role.id,
  id: role.id,
  name: role.name,
  displayName: role.displayName,
  description: role.description,
  scope: role.scope,
  sourceRecinto: role.sourceRecinto,
  syncKey: role.syncKey,
  system: role.system,
  active: role.active,
  createdAt: role.createdAt,
  permissions: { ...role.permissions },
})

const getDepartmentLabel = (user: CrossDbUserItem): string => {
  const departmentRaw = (user.department ?? "").trim()
  return departmentRaw.length > 0 ? departmentRaw : "Sin departamento"
}

const isLeaderRoleId = (roleId: string): boolean => roleId.trim().toLowerCase() === "lider"

/**
 * Pagina de gestion de permisos y roles.
 *
 * - Muestra el catalogo real de roles entre bases de datos.
 * - Permite crear, editar y eliminar roles usando el servicio de autorizacion.
 * - Mantiene la administracion de usuarios y la asignacion de roles desde el catalogo.
 */
export default function PermissionsPage() {
  const [allUsers, setAllUsers] = useState<CrossDbUserItem[]>([])
  const [visibleUsers, setVisibleUsers] = useState<CrossDbUserItem[]>([])
  const [roleDefinitions, setRoleDefinitions] = useState<ManageableRoleDefinition[]>([])
  const [permissionDefinitions, setPermissionDefinitions] = useState<PermissionDefinition[]>([])
  const [searchText, setSearchText] = useState<string>("")
  const [roleFilter, setRoleFilter] = useState<string | "ALL">("ALL")
  const [recintoFilter, setRecintoFilter] = useState<RecintoKey | "ALL">("ALL")
  const [activeFilter, setActiveFilter] = useState<boolean | "ALL">("ALL")
  const [loading, setLoading] = useState<boolean>(true)
  const [savingRole, setSavingRole] = useState<boolean>(false)
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [roleEditorError, setRoleEditorError] = useState<string | null>(null)
  const [roleDraft, setRoleDraft] = useState<RoleDraftState | null>(null)
  const [activating, setActivating] = useState<Record<string, boolean>>({})
  const [activatingDepartment, setActivatingDepartment] = useState<Record<string, boolean>>({})
  const [updatingLeader, setUpdatingLeader] = useState<Record<string, boolean>>({})

  const availableRecintos = useMemo(() => getAllAvailableDatabases(), [])
  const fallbackRecinto = availableRecintos[0]?.key ?? "corporativo"
  const authorizationDatabaseUrl = availableRecintos[0]?.url ?? null
  const fieldClassName = "w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] appearance-none focus:ring-2 focus:ring-primary-container"
  const textareaClassName = "w-full min-h-24 resize-y bg-white border-none rounded-xl py-3 px-4 text-sm font-medium text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"

  const roleDefinitionById = useMemo(() => {
    return roleDefinitions.reduce<Record<string, ManageableRoleDefinition>>((accumulator, role) => {
      accumulator[role.id] = role
      return accumulator
    }, {})
  }, [roleDefinitions])

  const permissionsByCategory = useMemo(() => {
    return permissionDefinitions.reduce<Record<string, PermissionDefinition[]>>((accumulator, permission) => {
      if (!accumulator[permission.category]) {
        accumulator[permission.category] = []
      }
      accumulator[permission.category].push(permission)
      return accumulator
    }, {})
  }, [permissionDefinitions])

  const inactiveGroupsByDepartment = useMemo(() => {
    const groups: Record<string, CrossDbUserItem[]> = {}
    visibleUsers.forEach((user) => {
      if (user.active) {
        return
      }
      const department = getDepartmentLabel(user)
      if (!groups[department]) {
        groups[department] = []
      }
      groups[department].push(user)
    })
    return groups
  }, [visibleUsers])

  const loadCatalogData = useCallback(async (): Promise<void> => {
    if (!authorizationDatabaseUrl) {
      throw new Error("No fue posible resolver una base de datos para el catalogo de roles")
    }

    const authorizationDatabase = getDatabaseForUrl(authorizationDatabaseUrl)
    if (!authorizationDatabase) {
      throw new Error("No fue posible obtener la instancia principal de base de datos")
    }

    await ensureAuthorizationCatalogAcrossDatabases()

    const [catalogSnapshot, roles] = await Promise.all([
      getAuthorizationCatalog(authorizationDatabase),
      listRolesAcrossDatabases(),
    ])

    setPermissionDefinitions(catalogSnapshot.permissions)
    setRoleDefinitions(roles)
  }, [authorizationDatabaseUrl])

  useEffect(() => {
    let cancelled = false

    async function loadInitialData(): Promise<void> {
      try {
        setLoading(true)
        setError(null)

        await loadCatalogData()
        const users = await listAllUsersAcrossDatabases()

        if (!cancelled) {
          setAllUsers(users)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No fue posible cargar la pagina de permisos")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadInitialData().catch(() => setError("No fue posible cargar la pagina de permisos"))

    return () => {
      cancelled = true
    }
  }, [loadCatalogData])

  useEffect(() => {
    setVisibleUsers(filterUsers(allUsers, {
      searchText,
      recinto: recintoFilter,
      roleId: roleFilter,
      active: activeFilter,
    }))
  }, [allUsers, searchText, recintoFilter, roleFilter, activeFilter])

  const resolveUserRoleId = (user: CrossDbUserItem): string => {
    return user.roleId ?? "user"
  }

  const resolveUserRoleLabel = (user: CrossDbUserItem): string => {
    const roleId = resolveUserRoleId(user)
    return roleDefinitionById[roleId]?.displayName ?? user.role ?? "Usuario"
  }

  const openCreateRole = (): void => {
    setRoleEditorError(null)
    setRoleDraft(buildEmptyDraft(fallbackRecinto))
  }

  const openEditRole = (role: ManageableRoleDefinition): void => {
    setRoleEditorError(null)
    setRoleDraft(buildDraftFromRole(role))
  }

  const closeRoleEditor = (): void => {
    setRoleEditorError(null)
    setRoleDraft(null)
  }

  const handleRoleDisplayNameChange = (value: string): void => {
    setRoleDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }

      const nextDisplayName = value
      if (currentDraft.originalRoleId) {
        return {
          ...currentDraft,
          displayName: nextDisplayName,
          name: nextDisplayName,
        }
      }

      const nextRoleId = createRoleIdFromLabel(nextDisplayName)
      return {
        ...currentDraft,
        id: nextRoleId,
        name: nextDisplayName,
        displayName: nextDisplayName,
        syncKey: nextRoleId ? buildRoleSyncKey(nextRoleId, currentDraft.scope, currentDraft.sourceRecinto) : "",
      }
    })
  }

  const handleRoleScopeChange = (scope: RoleScope): void => {
    setRoleDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }

      return {
        ...currentDraft,
        scope,
        syncKey: currentDraft.id ? buildRoleSyncKey(currentDraft.id, scope, currentDraft.sourceRecinto) : "",
      }
    })
  }

  const handleRoleRecintoChange = (recinto: RecintoKey): void => {
    setRoleDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }

      return {
        ...currentDraft,
        sourceRecinto: recinto,
        syncKey: currentDraft.id ? buildRoleSyncKey(currentDraft.id, currentDraft.scope, recinto) : "",
      }
    })
  }

  const togglePermission = (permissionId: PermissionId): void => {
    setRoleDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }

      const isEnabled = currentDraft.permissions[permissionId] === true
      const nextPermissions: PermissionMap = { ...currentDraft.permissions }

      if (isEnabled) {
        delete nextPermissions[permissionId]
      } else {
        nextPermissions[permissionId] = true
      }

      return {
        ...currentDraft,
        permissions: nextPermissions,
      }
    })
  }

  const saveRole = async (): Promise<void> => {
    if (!roleDraft) {
      return
    }

    const roleId = roleDraft.originalRoleId ?? roleDraft.id
    const displayName = roleDraft.displayName.trim()
    const description = roleDraft.description.trim()

    if (!roleId) {
      setRoleEditorError("El rol necesita un identificador valido. Cambia el nombre para generarlo automaticamente.")
      return
    }

    if (!displayName) {
      setRoleEditorError("Debes ingresar un nombre visible para el rol.")
      return
    }

    const targetDatabaseUrl = roleDraft.scope === "global"
      ? authorizationDatabaseUrl
      : availableRecintos.find((recinto) => recinto.key === roleDraft.sourceRecinto)?.url ?? null

    const targetDatabase = getDatabaseForUrl(targetDatabaseUrl)
    if (!targetDatabase) {
      setRoleEditorError("No fue posible resolver la base de datos para guardar el rol.")
      return
    }

    try {
      setSavingRole(true)
      setRoleEditorError(null)

      await upsertRole(targetDatabase, {
        id: roleId,
        name: roleDraft.name.trim() || displayName,
        displayName,
        description,
        scope: roleDraft.scope,
        syncKey: roleDraft.system ? roleDraft.syncKey : buildRoleSyncKey(roleId, roleDraft.scope, roleDraft.sourceRecinto),
        system: roleDraft.system,
        active: roleDraft.active,
        permissions: roleDraft.permissions,
        createdAt: roleDraft.createdAt,
      })

      await loadCatalogData()
      setRoleDraft(null)
    } catch (err) {
      setRoleEditorError(err instanceof Error ? err.message : "No fue posible guardar el rol")
    } finally {
      setSavingRole(false)
    }
  }

  const removeRole = async (role: ManageableRoleDefinition): Promise<void> => {
    const targetDatabase = getDatabaseForUrl(role.sourceDatabaseUrl)
    if (!targetDatabase) {
      setRoleEditorError("No fue posible resolver la base de datos del rol a eliminar.")
      return
    }

    try {
      setDeletingRoleId(role.id)
      setRoleEditorError(null)
      await deleteRole(targetDatabase, role.id)
      await loadCatalogData()

      if (roleDraft?.originalRoleId === role.id) {
        setRoleDraft(null)
      }
    } catch (err) {
      setRoleEditorError(err instanceof Error ? err.message : "No fue posible eliminar el rol")
    } finally {
      setDeletingRoleId(null)
    }
  }

  const assignRole = async (user: CrossDbUserItem, roleId: string): Promise<void> => {
    const selectedRole = roleDefinitionById[roleId]
    if (!selectedRole) {
      return
    }

    const currentRoleId = resolveUserRoleId(user)
    const shouldEnableLeader = isLeaderRoleId(selectedRole.id)
    const shouldDisableLeader = isLeaderRoleId(currentRoleId) && !shouldEnableLeader

    await assignRoleInUserDatabase(user, selectedRole)

    if (shouldEnableLeader) {
      await setUserLeaderInUserDatabase(user, true)
    }

    if (shouldDisableLeader) {
      await setUserLeaderInUserDatabase(user, false)
    }

    const legacyRole = getLegacyRoleFromRoleId(selectedRole.id)

    setAllUsers((previousUsers) => previousUsers.map((currentUser) => {
      const isTargetUser = currentUser.uid === user.uid && currentUser.databaseUrl === user.databaseUrl
      if (!isTargetUser) {
        return currentUser
      }

      return {
        ...currentUser,
        roleId: selectedRole.id,
        role: legacyRole,
        isLeader: shouldEnableLeader ? true : shouldDisableLeader ? false : currentUser.isLeader,
      }
    }))
  }

  const activateUser = async (user: CrossDbUserItem): Promise<void> => {
    const key = `${user.databaseUrl}-${user.uid}`
    setActivating((previousValue) => ({ ...previousValue, [key]: true }))

    try {
      await activateUserInUserDatabase(user)
      setAllUsers((previousUsers) => previousUsers.map((currentUser) => {
        const isTargetUser = currentUser.uid === user.uid && currentUser.databaseUrl === user.databaseUrl
        return isTargetUser ? { ...currentUser, active: true } : currentUser
      }))
    } catch (err) {
      console.error("No fue posible activar el usuario:", err)
    } finally {
      setActivating((previousValue) => ({ ...previousValue, [key]: false }))
    }
  }

  const deactivateUser = async (user: CrossDbUserItem): Promise<void> => {
    const key = `${user.databaseUrl}-${user.uid}`
    setActivating((previousValue) => ({ ...previousValue, [key]: true }))

    try {
      await deactivateUserInUserDatabase(user)
      setAllUsers((previousUsers) => previousUsers.map((currentUser) => {
        const isTargetUser = currentUser.uid === user.uid && currentUser.databaseUrl === user.databaseUrl
        return isTargetUser ? { ...currentUser, active: false } : currentUser
      }))
    } catch (err) {
      console.error("No fue posible desactivar el usuario:", err)
    } finally {
      setActivating((previousValue) => ({ ...previousValue, [key]: false }))
    }
  }

  const toggleUserLeader = async (user: CrossDbUserItem, nextIsLeader: boolean): Promise<void> => {
    const key = `${user.databaseUrl}-${user.uid}`
    setUpdatingLeader((previousValue) => ({ ...previousValue, [key]: true }))

    try {
      await setUserLeaderInUserDatabase(user, nextIsLeader)
      setAllUsers((previousUsers) => previousUsers.map((currentUser) => {
        const isTargetUser = currentUser.uid === user.uid && currentUser.databaseUrl === user.databaseUrl
        return isTargetUser ? { ...currentUser, isLeader: nextIsLeader } : currentUser
      }))
    } catch (err) {
      console.error("No fue posible actualizar la bandera de líder:", err)
    } finally {
      setUpdatingLeader((previousValue) => ({ ...previousValue, [key]: false }))
    }
  }

  const activateDepartment = async (department: string): Promise<void> => {
    const usersInDepartment = visibleUsers.filter((user) => !user.active && getDepartmentLabel(user) === department)
    if (usersInDepartment.length === 0) {
      return
    }

    setActivatingDepartment((previousValue) => ({ ...previousValue, [department]: true }))
    try {
      for (const user of usersInDepartment) {
        await activateUser(user)
      }
    } finally {
      setActivatingDepartment((previousValue) => ({ ...previousValue, [department]: false }))
    }
  }

  const renderRoleOptions = () => {
    return roleDefinitions.map((role) => (
      <option key={`${role.scope}-${role.id}-${role.sourceRecinto}`} value={role.id}>{role.displayName}</option>
    ))
  }

  return (
    <Layout>
      <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
        <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs border-b border-[#edeeed]">
          <nav className="px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto">
            <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
              <span>Configuracion</span>
              <ChevronRight className="w-4 h-4" />
              <span>Permisos</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[#191c1c] flex items-center gap-3">
              <ShieldCheck className="w-7 h-7 text-[#1b3022]" />
              Catalogo de Roles y Usuarios
            </h1>
            <p className="text-sm text-[#5f6560] mt-1">Administra roles sincronizados, permisos y asignaciones de usuario desde una sola vista.</p>
          </nav>
        </header>

        <div className="px-4 md:px-12 py-10 space-y-10 max-w-7xl mx-auto">
          {loading && (
            <div className="bg-white rounded-2xl p-6 text-sm text-[#5f6560] shadow-[0_20px_20px_rgba(25,28,28,0.04)]">
              Cargando catalogo de autorizacion...
            </div>
          )}
          {error && (
            <div className="bg-[#fff6f5] border border-[#f0c7c2] rounded-2xl p-6 text-sm text-[#8c1d18] shadow-[0_20px_20px_rgba(25,28,28,0.04)]">
              {error}
            </div>
          )}
          <section className="grid gap-6 xl:grid-cols-[1.15fr_1.85fr]">
            <article className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden">
              <div className="p-8 border-b border-[#edeeed] flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-[#191c1c]">Roles</h2>
                  <p className="text-sm text-[#5f6560] mt-1">Edita permisos y define si un rol es global o local.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl bg-[#1b3022] px-4 py-3 text-sm font-semibold text-white hover:bg-[#243c2d] transition-colors"
                    onClick={openCreateRole}
                  >
                    <Plus className="h-4 w-4" />
                    Nuevo rol
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-3 max-h-216 overflow-y-auto">
                {roleDefinitions.map((role) => (
                  <div key={`${role.scope}-${role.id}-${role.sourceRecinto}`} className="rounded-2xl border border-[#edeeed] bg-[#fcfcfb] p-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-bold text-[#191c1c]">{role.displayName}</h3>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${isGlobalRole(role) ? "bg-[#d0e9d4] text-[#1b3022]" : "bg-[#ffe4c2] text-[#8b4c00]"}`}>
                            {isGlobalRole(role) ? "Global" : `Local: ${role.sourceRecinto}`}
                          </span>
                          {role.system && (
                            <span className="rounded-full bg-[#e8eef9] px-3 py-1 text-[11px] font-semibold text-[#24406f]">Sistema</span>
                          )}
                        </div>
                        <p className="text-sm text-[#5f6560]">{role.description || "Sin descripcion"}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-[#5f6560]">
                          <span>Id: <span className="font-semibold text-[#191c1c]">{role.id}</span></span>
                          <span>Permisos: <span className="font-semibold text-[#191c1c]">{Object.keys(role.permissions).length}</span></span>
                          <span>Disponible en: <span className="font-semibold text-[#191c1c]">{role.availableInRecintos.join(", ")}</span></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-xl border border-[#d8ddd9] px-3 py-2 text-sm font-semibold text-[#191c1c] hover:bg-white"
                          onClick={() => openEditRole(role)}
                        >
                          <PencilLine className="h-4 w-4" />
                          Editar
                        </button>
                        {!role.system && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-xl border border-[#f0c7c2] px-3 py-2 text-sm font-semibold text-[#8c1d18] hover:bg-[#fff6f5]"
                            disabled={deletingRoleId === role.id}
                            onClick={() => removeRole(role)}
                          >
                            <Trash2 className="h-4 w-4" />
                            {deletingRoleId === role.id ? "Eliminando..." : "Eliminar"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden">
              <div className="p-8 border-b border-[#edeeed] flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-[#191c1c]">Editor de rol</h2>
                  <p className="text-sm text-[#5f6560] mt-1">Configura metadata, alcance y permisos del rol seleccionado.</p>
                </div>
                {roleDraft && (
                  <button
                    type="button"
                    className="rounded-xl border border-[#d8ddd9] px-4 py-2 text-sm font-semibold text-[#191c1c] hover:bg-[#f7f8f7]"
                    onClick={closeRoleEditor}
                  >
                    Cerrar
                  </button>
                )}
              </div>

              <div className="p-8 space-y-6 max-h-216 overflow-y-auto">
                {!roleDraft ? (
                  <div className="rounded-2xl border border-dashed border-[#d8ddd9] bg-[#fcfcfb] p-10 text-center">
                    <ShieldCheck className="mx-auto h-10 w-10 text-[#5f6560]" />
                    <h3 className="mt-4 text-lg font-bold text-[#191c1c]">Selecciona o crea un rol</h3>
                    <p className="mt-2 text-sm text-[#5f6560]">Desde aqui podras editar los permisos y guardar cambios sincronizados para roles globales.</p>
                  </div>
                ) : (
                  <>
                    {roleEditorError && (
                      <div className="rounded-2xl border border-[#f0c7c2] bg-[#fff6f5] px-4 py-3 text-sm text-[#8c1d18]">
                        {roleEditorError}
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Nombre visible</label>
                        <input
                          type="text"
                          value={roleDraft.displayName}
                          onChange={(event) => handleRoleDisplayNameChange(event.target.value)}
                          className={fieldClassName}
                          placeholder="Ej. Supervisor Regional"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Identificador</label>
                        <input
                          type="text"
                          value={roleDraft.originalRoleId ?? roleDraft.id}
                          className={`${fieldClassName} bg-[#f3f4f3] text-[#5f6560]`}
                          readOnly
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Descripcion</label>
                      <textarea
                        value={roleDraft.description}
                        onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })}
                        className={textareaClassName}
                        placeholder="Describe para que sirve este rol y que alcance tiene."
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Alcance</label>
                        <select
                          value={roleDraft.scope}
                          onChange={(event) => handleRoleScopeChange(event.target.value as RoleScope)}
                          className={fieldClassName}
                          disabled={roleDraft.system || Boolean(roleDraft.originalRoleId)}
                        >
                          <option value="global">Global</option>
                          <option value="local">Local</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Recinto origen</label>
                        <select
                          value={roleDraft.sourceRecinto}
                          onChange={(event) => handleRoleRecintoChange(event.target.value as RecintoKey)}
                          className={fieldClassName}
                          disabled={roleDraft.scope === "global"}
                        >
                          {availableRecintos.map((recinto) => (
                            <option key={recinto.key} value={recinto.key}>{recinto.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Estado</label>
                        <select
                          value={String(roleDraft.active)}
                          onChange={(event) => setRoleDraft({ ...roleDraft, active: event.target.value === "true" })}
                          className={fieldClassName}
                        >
                          <option value="true">Activo</option>
                          <option value="false">Inactivo</option>
                        </select>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[#edeeed] bg-[#fcfcfb] px-4 py-3 text-xs text-[#5f6560]">
                      <span className="font-semibold text-[#191c1c]">Clave de sincronizacion:</span> {roleDraft.system ? roleDraft.syncKey : buildRoleSyncKey(roleDraft.originalRoleId ?? roleDraft.id, roleDraft.scope, roleDraft.sourceRecinto)}
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-bold text-[#191c1c]">Permisos</h3>
                        <p className="text-sm text-[#5f6560] mt-1">Activa solo las capacidades que este rol necesita.</p>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        {Object.entries(permissionsByCategory).map(([category, permissions]) => (
                          <div key={category} className="rounded-2xl border border-[#edeeed] bg-[#fcfcfb] p-4 space-y-3">
                            <div>
                              <h4 className="text-sm font-bold uppercase tracking-wider text-[#191c1c]">{category}</h4>
                              <p className="text-xs text-[#5f6560]">{permissions.length} permiso{permissions.length === 1 ? "" : "s"}</p>
                            </div>
                            <div className="space-y-2">
                              {permissions.map((permission) => (
                                <label key={permission.id} className="flex gap-3 rounded-xl bg-white px-3 py-3 border border-[#edeeed] cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={roleDraft.permissions[permission.id] === true}
                                    onChange={() => togglePermission(permission.id)}
                                    className="mt-1 h-4 w-4 rounded border-[#c3c8c5] text-[#1b3022] focus:ring-[#1b3022]"
                                  />
                                  <span>
                                    <span className="block text-sm font-semibold text-[#191c1c]">{permission.label}</span>
                                    <span className="block text-xs text-[#5f6560] mt-1">{permission.description}</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#edeeed] pt-6">
                      <button
                        type="button"
                        className="rounded-xl border border-[#d8ddd9] px-4 py-3 text-sm font-semibold text-[#191c1c] hover:bg-[#f7f8f7]"
                        onClick={closeRoleEditor}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="rounded-xl bg-[#1b3022] px-5 py-3 text-sm font-semibold text-white hover:bg-[#243c2d] transition-colors disabled:opacity-60"
                        onClick={saveRole}
                        disabled={savingRole}
                      >
                        {savingRole ? "Guardando..." : "Guardar rol"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </article>
          </section>

          <section className="bg-[#f3f4f3] p-6 rounded-xl space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Buscar</label>
                <input
                  type="text"
                  value={searchText}
                  placeholder="Buscar por nombre o correo"
                  onChange={(event) => setSearchText(event.target.value)}
                  className={fieldClassName}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Recinto</label>
                <select value={recintoFilter} onChange={(event) => setRecintoFilter(event.target.value as RecintoKey | "ALL")} className={fieldClassName}>
                  <option value="ALL">Todos los recintos</option>
                  {availableRecintos.map((recinto) => (
                    <option key={recinto.key} value={recinto.key}>{recinto.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Rol</label>
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as string | "ALL")} className={fieldClassName}>
                  <option value="ALL">Todos los roles</option>
                  {renderRoleOptions()}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Estado</label>
                <select
                  value={activeFilter === "ALL" ? "ALL" : String(activeFilter)}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setActiveFilter(nextValue === "ALL" ? "ALL" : nextValue === "true")
                  }}
                  className={fieldClassName}
                >
                  <option value="ALL">Todos los estados</option>
                  <option value="true">Activos</option>
                  <option value="false">Inactivos</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-[11px] text-[#5f6560]">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span>
                  Mostrando <span className="font-semibold text-[#191c1c]">{visibleUsers.length}</span> usuario{visibleUsers.length === 1 ? "" : "s"} con los filtros aplicados.
                </span>
              </div>
              <div className="rounded-full bg-white px-4 py-2 text-[#1b3022] font-semibold border border-[#dce5dd]">
                {roleDefinitions.length} rol{roleDefinitions.length === 1 ? "" : "es"} en catalogo
              </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden">
            <div className="p-8 border-b border-[#edeeed] flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-emerald-950">Usuarios</h2>
                <p className="text-xs text-outline font-medium mt-1">Administra activacion y asignacion desde el catalogo centralizado.</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#d0e9d4] text-[#1b3022]">
                {visibleUsers.length} registro{visibleUsers.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="p-8 space-y-4">
              {!loading && visibleUsers.length === 0 && (
                <div className="bg-[#fcfcfb] border border-[#edeeed] rounded-2xl p-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#f3f4f3] flex items-center justify-center">
                    <Users className="w-8 h-8 text-[#5f6560]" />
                  </div>
                  <h3 className="text-lg font-bold text-[#191c1c] mb-2">Sin resultados</h3>
                  <p className="text-sm text-[#5f6560]">No hay usuarios que coincidan con los filtros seleccionados.</p>
                </div>
              )}

              <div className="space-y-4">
                {!loading && activeFilter === false && Object.keys(inactiveGroupsByDepartment).length > 0 ? (
                  Object.entries(inactiveGroupsByDepartment).map(([department, users]) => (
                    <div key={department} className="border border-[#edeeed] rounded-2xl p-5 space-y-4 bg-[#fcfcfb] shadow-[0_12px_24px_rgba(25,28,28,0.03)]">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-bold text-[#191c1c]">Departamento: {department}</p>
                          <p className="text-xs text-[#5f6560]">Estos son los usuarios inactivos del grupo seleccionado.</p>
                        </div>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4] transition-colors"
                          disabled={activatingDepartment[department]}
                          onClick={() => activateDepartment(department)}
                        >
                          {activatingDepartment[department] ? "Activando..." : "Activar todos"}
                        </button>
                      </div>

                      <div className="space-y-2">
                        {users.map((user) => (
                          <div key={`${user.databaseUrl}-${user.uid}`} className="border border-[#edeeed] rounded-xl p-4 bg-white">
                            {(() => {
                              const userRoleId = resolveUserRoleId(user)
                              const hasLeaderRole = isLeaderRoleId(userRoleId)
                              return (
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="text-sm font-bold text-[#191c1c]">{user.name}</p>
                                <p className="text-xs text-[#5f6560]">{user.email}</p>
                                <p className="text-xs text-[#5f6560] mt-1">Recinto: <span className="font-semibold text-[#191c1c]">{user.recinto}</span></p>
                                <p className="text-xs text-[#5f6560] mt-1">Rol actual: <span className="font-semibold text-[#191c1c]">{resolveUserRoleLabel(user)}</span></p>
                                <p className="text-xs text-[#5f6560] mt-1">Liderazgo: <span className="font-semibold text-[#191c1c]">{hasLeaderRole || user.isLeader === true ? "Lider habilitado" : "Sin liderazgo explícito"}</span></p>
                                <p className="text-xs mt-1">Estado: <span className={user.active ? "text-[#1b5e20]" : "text-[#8c1d18]"}>{user.active ? "Activo" : "Inactivo"}</span></p>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="text-sm text-[#5f6560]">Rol</span>
                                <select
                                  value={userRoleId}
                                  onChange={(event) => assignRole(user, event.target.value)}
                                  className="px-3 py-2 bg-[#fcfcfb] border border-[#edeeed] rounded-lg text-sm font-medium text-[#191c1c]"
                                  disabled={roleDefinitions.length === 0}
                                >
                                  {renderRoleOptions()}
                                </select>
                                {!hasLeaderRole && (
                                  <button
                                    type="button"
                                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${user.isLeader === true ? "border-[#8c1d18] text-[#8c1d18] hover:bg-[#fff6f5]" : "border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4]"}`}
                                    disabled={updatingLeader[`${user.databaseUrl}-${user.uid}`]}
                                    onClick={() => toggleUserLeader(user, user.isLeader !== true)}
                                    title="Definir liderazgo explícito"
                                  >
                                    {updatingLeader[`${user.databaseUrl}-${user.uid}`]
                                      ? "Actualizando..."
                                      : user.isLeader === true
                                        ? "Quitar líder"
                                        : "Marcar líder"}
                                  </button>
                                )}
                                <button
                                  className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4] transition-colors"
                                  disabled={activating[`${user.databaseUrl}-${user.uid}`]}
                                  onClick={() => activateUser(user)}
                                  title="Activar usuario"
                                >
                                  {activating[`${user.databaseUrl}-${user.uid}`] ? "Activando..." : "Activar"}
                                </button>
                              </div>
                            </div>
                              )
                            })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  visibleUsers.map((user) => (
                    <div key={`${user.databaseUrl}-${user.uid}`} className="border border-[#edeeed] rounded-2xl p-5 bg-[#fcfcfb] shadow-[0_12px_24px_rgba(25,28,28,0.03)]">
                      {(() => {
                        const userRoleId = resolveUserRoleId(user)
                        const hasLeaderRole = isLeaderRoleId(userRoleId)
                        return (
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-[#191c1c]">{user.name}</p>
                          <p className="text-xs text-[#5f6560]">{user.email}</p>
                          <p className="text-xs text-[#5f6560] mt-1">Recinto: <span className="font-semibold text-[#191c1c]">{user.recinto}</span></p>
                          <p className="text-xs text-[#5f6560] mt-1">Rol actual: <span className="font-semibold text-[#191c1c]">{resolveUserRoleLabel(user)}</span></p>
                          <p className="text-xs text-[#5f6560] mt-1">Liderazgo: <span className="font-semibold text-[#191c1c]">{hasLeaderRole || user.isLeader === true ? "Lider habilitado" : "Sin liderazgo explícito"}</span></p>
                          <p className="text-xs mt-1">Estado: <span className={user.active ? "text-[#1b5e20]" : "text-[#8c1d18]"}>{user.active ? "Activo" : "Inactivo"}</span></p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[#5f6560]">Rol</span>
                          <select
                            value={userRoleId}
                            onChange={(event) => assignRole(user, event.target.value)}
                            className="px-3 py-2 bg-white border border-[#edeeed] rounded-lg text-sm font-medium text-[#191c1c]"
                            disabled={roleDefinitions.length === 0}
                          >
                            {renderRoleOptions()}
                          </select>
                          {!hasLeaderRole && (
                            <button
                              type="button"
                              className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${user.isLeader === true ? "border-[#8c1d18] text-[#8c1d18] hover:bg-[#fff6f5]" : "border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4]"}`}
                              disabled={updatingLeader[`${user.databaseUrl}-${user.uid}`]}
                              onClick={() => toggleUserLeader(user, user.isLeader !== true)}
                              title="Definir liderazgo explícito"
                            >
                              {updatingLeader[`${user.databaseUrl}-${user.uid}`]
                                ? "Actualizando..."
                                : user.isLeader === true
                                  ? "Quitar líder"
                                  : "Marcar líder"}
                            </button>
                          )}
                          {user.active ? (
                            <button
                              className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#8c1d18] text-[#8c1d18] hover:bg-[#fff6f5] transition-colors"
                              disabled={activating[`${user.databaseUrl}-${user.uid}`]}
                              onClick={() => deactivateUser(user)}
                              title="Desactivar usuario"
                            >
                              {activating[`${user.databaseUrl}-${user.uid}`] ? "Desactivando..." : "Desactivar"}
                            </button>
                          ) : (
                            <button
                              className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4] transition-colors"
                              disabled={activating[`${user.databaseUrl}-${user.uid}`]}
                              onClick={() => activateUser(user)}
                              title="Activar usuario"
                            >
                              {activating[`${user.databaseUrl}-${user.uid}`] ? "Activando..." : "Activar"}
                            </button>
                          )}
                        </div>
                      </div>
                        )
                      })()}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  )
}
