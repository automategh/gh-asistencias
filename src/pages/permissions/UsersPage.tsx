import Layout from "@/components/layouts/layout"
import { useAuth } from "@/context/AuthContext"
import { useDatabase } from "@/context/DatabaseContext"
import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver"
import {
  activateUserInUserDatabase,
  assignRoleInUserDatabase,
  deactivateUserInUserDatabase,
  filterUsers,
  listAllUsersAcrossDatabases,
  setUserLeaderInUserDatabase,
} from "@/services/roles.service"
import {
  getLegacyRoleFromRoleId,
  listRolesAcrossDatabases,
} from "@/services/authorization/role-permissions.service"
import type { ManageableRoleDefinition } from "@/types/authorization"
import type { CrossDbUserItem } from "@/types/user"
import { Users } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

const isLeaderRoleId = (roleId: string): boolean => roleId.trim().toLowerCase() === "lider"

export default function UsersPage() {
  const { hasPermission } = useAuth()
  const { databaseUrl: selectedDatabaseUrl, isCorporateUser } = useDatabase()

  const [allUsers, setAllUsers] = useState<CrossDbUserItem[]>([])
  const [visibleUsers, setVisibleUsers] = useState<CrossDbUserItem[]>([])
  const [roleDefinitions, setRoleDefinitions] = useState<ManageableRoleDefinition[]>([])
  const [searchText, setSearchText] = useState<string>("")
  const [recintoFilter, setRecintoFilter] = useState<RecintoKey | "ALL">("ALL")
  const [roleFilter, setRoleFilter] = useState<string | "ALL">("ALL")
  const [activeFilter, setActiveFilter] = useState<boolean | "ALL">("ALL")
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState<Record<string, boolean>>({})
  const [updatingLeader, setUpdatingLeader] = useState<Record<string, boolean>>({})

  const availableRecintos = useMemo(() => getAllAvailableDatabases(), [])
  const selectedDatabase = useMemo(() => {
    if (!selectedDatabaseUrl) {
      return null
    }

    return availableRecintos.find((databaseItem) => databaseItem.url === selectedDatabaseUrl) ?? null
  }, [availableRecintos, selectedDatabaseUrl])

  const roleDefinitionById = useMemo(() => {
    return roleDefinitions.reduce<Record<string, ManageableRoleDefinition>>((accumulator, role) => {
      accumulator[role.id] = role
      return accumulator
    }, {})
  }, [roleDefinitions])

  const fieldClassName = "w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] appearance-none focus:ring-2 focus:ring-primary-container"

  const canAssignRole = hasPermission("users_assign_role")
  const canActivateUsers = hasPermission("users_activate")
  const canDeactivateUsers = hasPermission("users_deactivate")
  const canToggleLeadership = canAssignRole
  const hasAnyUserActionPermission = canAssignRole || canActivateUsers || canDeactivateUsers || canToggleLeadership

  useEffect(() => {
    let cancelled = false

    async function loadInitialData(): Promise<void> {
      try {
        setLoading(true)
        setError(null)

        const [roles, users] = await Promise.all([
          listRolesAcrossDatabases(),
          listAllUsersAcrossDatabases(),
        ])

        const usersInSelectedDatabase = selectedDatabaseUrl
          ? isCorporateUser
            ? users
            : users.filter((user) => user.databaseUrl === selectedDatabaseUrl)
          : []

        if (!cancelled) {
          setRoleDefinitions(roles)
          setAllUsers(usersInSelectedDatabase)
        }
      } catch (exception) {
        if (!cancelled) {
          setError(exception instanceof Error ? exception.message : "No fue posible cargar usuarios")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadInitialData().catch(() => {
      if (!cancelled) {
        setError("No fue posible cargar usuarios")
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isCorporateUser, selectedDatabaseUrl])

  useEffect(() => {
    setVisibleUsers(filterUsers(allUsers, {
      searchText,
      roleId: roleFilter,
      active: activeFilter,
      recinto: isCorporateUser ? recintoFilter : "ALL",
    }))
  }, [allUsers, searchText, recintoFilter, roleFilter, activeFilter, isCorporateUser])

  const resolveUserRoleId = (user: CrossDbUserItem): string => {
    return user.roleId ?? "user"
  }

  const resolveUserRoleLabel = (user: CrossDbUserItem): string => {
    const roleId = resolveUserRoleId(user)
    return roleDefinitionById[roleId]?.displayName ?? user.role ?? "Usuario"
  }

  const renderRoleOptions = () => {
    return roleDefinitions.map((role) => (
      <option key={`${role.scope}-${role.id}-${role.sourceRecinto}`} value={role.id}>{role.displayName}</option>
    ))
  }

  const assignRole = async (user: CrossDbUserItem, roleId: string): Promise<void> => {
    if (!canAssignRole) {
      return
    }

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
    if (!canActivateUsers) {
      return
    }

    const key = `${user.databaseUrl}-${user.uid}`
    setActivating((previousValue) => ({ ...previousValue, [key]: true }))

    try {
      await activateUserInUserDatabase(user)
      setAllUsers((previousUsers) => previousUsers.map((currentUser) => {
        const isTargetUser = currentUser.uid === user.uid && currentUser.databaseUrl === user.databaseUrl
        return isTargetUser ? { ...currentUser, active: true } : currentUser
      }))
    } finally {
      setActivating((previousValue) => ({ ...previousValue, [key]: false }))
    }
  }

  const deactivateUser = async (user: CrossDbUserItem): Promise<void> => {
    if (!canDeactivateUsers) {
      return
    }

    const key = `${user.databaseUrl}-${user.uid}`
    setActivating((previousValue) => ({ ...previousValue, [key]: true }))

    try {
      await deactivateUserInUserDatabase(user)
      setAllUsers((previousUsers) => previousUsers.map((currentUser) => {
        const isTargetUser = currentUser.uid === user.uid && currentUser.databaseUrl === user.databaseUrl
        return isTargetUser ? { ...currentUser, active: false } : currentUser
      }))
    } finally {
      setActivating((previousValue) => ({ ...previousValue, [key]: false }))
    }
  }

  const toggleUserLeader = async (user: CrossDbUserItem, nextIsLeader: boolean): Promise<void> => {
    if (!canToggleLeadership) {
      return
    }

    const key = `${user.databaseUrl}-${user.uid}`
    setUpdatingLeader((previousValue) => ({ ...previousValue, [key]: true }))

    try {
      await setUserLeaderInUserDatabase(user, nextIsLeader)
      setAllUsers((previousUsers) => previousUsers.map((currentUser) => {
        const isTargetUser = currentUser.uid === user.uid && currentUser.databaseUrl === user.databaseUrl
        return isTargetUser ? { ...currentUser, isLeader: nextIsLeader } : currentUser
      }))
    } finally {
      setUpdatingLeader((previousValue) => ({ ...previousValue, [key]: false }))
    }
  }

  return (
    <Layout
      header={{
        breadcrumbs: [{ label: "Configuracion" }, { label: "Usuarios" }],
        title: "Gestion de Usuarios",
        description: "Administra usuarios solo del recinto base actualmente seleccionado.",
      }}
    >
      <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
        <div className="px-4 md:px-12 py-10 space-y-10 max-w-7xl mx-auto">
          {loading && (
            <div className="bg-white rounded-2xl p-6 text-sm text-[#5f6560] shadow-[0_20px_20px_rgba(25,28,28,0.04)]">
              Cargando usuarios...
            </div>
          )}
          {error && (
            <div className="bg-[#fff6f5] border border-[#f0c7c2] rounded-2xl p-6 text-sm text-[#8c1d18] shadow-[0_20px_20px_rgba(25,28,28,0.04)]">
              {error}
            </div>
          )}

          <section className="bg-[#f3f4f3] p-6 rounded-xl space-y-4">
            <div className={`grid gap-4 ${isCorporateUser ? "lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]" : "lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]"}`}>
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
              {isCorporateUser && (
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Recinto</label>
                  <select value={recintoFilter} onChange={(event) => setRecintoFilter(event.target.value as RecintoKey | "ALL")} className={fieldClassName}>
                    <option value="ALL">Todos los recintos</option>
                    {availableRecintos.map((recintoItem) => (
                      <option key={recintoItem.key} value={recintoItem.key}>{recintoItem.name}</option>
                    ))}
                  </select>
                </div>
              )}
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
                  Mostrando <span className="font-semibold text-[#191c1c]">{visibleUsers.length}</span> usuario{visibleUsers.length === 1 ? "" : "s"} de <span className="font-semibold text-[#191c1c]">{selectedDatabase?.name ?? "Base no seleccionada"}</span>.
                </span>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden">
            <div className="p-8 border-b border-[#edeeed] flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-emerald-950">Usuarios</h2>
                <p className="text-xs text-outline font-medium mt-1">Las acciones disponibles se muestran segun tus permisos asignados.</p>
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
                {visibleUsers.map((user) => {
                  const userRoleId = resolveUserRoleId(user)
                  const hasLeaderRole = isLeaderRoleId(userRoleId)

                  return (
                    <div key={`${user.databaseUrl}-${user.uid}`} className="border border-[#edeeed] rounded-2xl p-5 bg-[#fcfcfb] shadow-[0_12px_24px_rgba(25,28,28,0.03)]">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-[#191c1c]">{user.name}</p>
                          <p className="text-xs text-[#5f6560]">{user.email}</p>
                          <p className="text-xs text-[#5f6560] mt-1">Rol actual: <span className="font-semibold text-[#191c1c]">{resolveUserRoleLabel(user)}</span></p>
                          <p className="text-xs text-[#5f6560] mt-1">Liderazgo: <span className="font-semibold text-[#191c1c]">{hasLeaderRole || user.isLeader === true ? "Lider habilitado" : "Sin liderazgo explícito"}</span></p>
                          <p className="text-xs mt-1">Estado: <span className={user.active ? "text-[#1b5e20]" : "text-[#8c1d18]"}>{user.active ? "Activo" : "Inactivo"}</span></p>
                        </div>

                        <div className="flex items-center gap-2">
                          {canAssignRole && (
                            <>
                              <span className="text-sm text-[#5f6560]">Rol</span>
                              <select
                                value={userRoleId}
                                onChange={(event) => assignRole(user, event.target.value)}
                                className="px-3 py-2 bg-white border border-[#edeeed] rounded-lg text-sm font-medium text-[#191c1c]"
                                disabled={roleDefinitions.length === 0}
                              >
                                {renderRoleOptions()}
                              </select>
                            </>
                          )}
                          {canToggleLeadership && !hasLeaderRole && (
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
                          {user.active && canDeactivateUsers && (
                            <button
                              className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#8c1d18] text-[#8c1d18] hover:bg-[#fff6f5] transition-colors"
                              disabled={activating[`${user.databaseUrl}-${user.uid}`]}
                              onClick={() => deactivateUser(user)}
                              title="Desactivar usuario"
                            >
                              {activating[`${user.databaseUrl}-${user.uid}`] ? "Desactivando..." : "Desactivar"}
                            </button>
                          )}
                          {!user.active && canActivateUsers && (
                            <button
                              className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4] transition-colors"
                              disabled={activating[`${user.databaseUrl}-${user.uid}`]}
                              onClick={() => activateUser(user)}
                              title="Activar usuario"
                            >
                              {activating[`${user.databaseUrl}-${user.uid}`] ? "Activando..." : "Activar"}
                            </button>
                          )}
                          {!hasAnyUserActionPermission && (
                            <span className="text-xs font-semibold text-[#5f6560] px-2 py-1 rounded bg-[#f3f4f3]">
                              Sin acciones permitidas
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  )
}
