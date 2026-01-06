import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import { useEffect, useMemo, useState } from "react"
import type { AppRole, FeatureKey, RoleItem, AdminUserItem } from "@/types/permissions"
import { FEATURE_KEYS } from "@/types/permissions"
import { createRole, setUserRole, upsertRoleFeatures, setUserFeatureOverride, listRoles, listAvailableFeatures, upsertFeatureCatalog, listUsersPaged, deleteFeatureKey, removeFeatureFromAllRoles } from "@/services/permissions.service"

/**
 * Página de administración de Roles y Permisos.
 * - Lista roles y permite crear/editar features del rol.
 * - Lista usuarios y permite asignar rol y overrides por feature.
 */
export default function PermissionsPage() {
    const { database } = useDatabase()

    const [roles, setRoles] = useState<RoleItem[]>([])
    const [users, setUsers] = useState<AdminUserItem[]>([])
    const [availableFeatures, setAvailableFeatures] = useState<ReadonlyArray<FeatureKey>>(FEATURE_KEYS)
    const [newFeatureMap, setNewFeatureMap] = useState<Record<string, boolean>>({})
    const [newFeatureKey, setNewFeatureKey] = useState<string>("")
    const [cleanRolesOnDelete, setCleanRolesOnDelete] = useState<boolean>(true)
    const [searchText, setSearchText] = useState<string>("")
    const [roleFilter, setRoleFilter] = useState<AppRole | "ALL">("ALL")
    const [pageSize, setPageSize] = useState<number>(25)
    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)

    // Form para crear rol
    const [newRole, setNewRole] = useState<string>("")

    useEffect(() => {
        let cancelled = false
        async function load() {
            try {
                setLoading(true)
                setError(null)
                if (!database) {
                    setRoles([])
                    setUsers([])
                    return
                }
                const [roleList, userList, featureList] = await Promise.all([
                    listRoles(database),
                    listUsersPaged(database, { limit: pageSize }),
                    listAvailableFeatures(database),
                ])
                if (!cancelled) {
                    setRoles(roleList)
                    setUsers(userList)
                    setAvailableFeatures(featureList)
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "No fue posible cargar roles/usuarios")
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load().catch(() => setError("No fue posible cargar roles/usuarios"))
        return () => { cancelled = true }
    }, [database, pageSize])

    const featureKeys = useMemo<readonly FeatureKey[]>(() => availableFeatures, [availableFeatures])

    async function handleCreateRole(): Promise<void> {
        if (!database) return
        const key = newRole.trim()
        if (!key) return
        await createRole(database, key as AppRole)
        setNewRole("")
        // Recarga lista de roles desde servicio
        const roleList = await listRoles(database)
        setRoles(roleList)
    }

    async function toggleRoleFeature(r: RoleItem, feature: FeatureKey, value: boolean): Promise<void> {
        if (!database) return
        await upsertRoleFeatures(database, r.role, { [feature]: value })
        setRoles(prev => prev.map(item => item.role === r.role ? { role: item.role, features: { ...item.features, [feature]: value } } : item))
    }

    async function assignUserRole(user: AdminUserItem, role: AppRole): Promise<void> {
        if (!database) return
        await setUserRole(database, user.uid, role)
        setUsers(prev => prev.map(u => u.uid === user.uid ? { ...u, role } : u))
    }

    async function toggleUserOverride(uid: string, feature: FeatureKey, value: boolean): Promise<void> {
        if (!database) return
        await setUserFeatureOverride(database, uid, feature, value)
    }

    async function applyFeatureCatalogChanges(): Promise<void> {
        if (!database) return
        await upsertFeatureCatalog(database, newFeatureMap)
        setNewFeatureMap({} as Record<FeatureKey, boolean>)
        const featureList = await listAvailableFeatures(database)
        setAvailableFeatures(featureList)
    }

    async function addNewFeature(): Promise<void> {
        if (!database) return
        const key = newFeatureKey.trim()
        if (!key) return
        await upsertFeatureCatalog(database, { [key]: true })
        setNewFeatureKey("")
        const featureList = await listAvailableFeatures(database)
        setAvailableFeatures(featureList)
    }

    async function removeFeature(key: string): Promise<void> {
        if (!database) return
        await deleteFeatureKey(database, key)
        if (cleanRolesOnDelete) {
            await removeFeatureFromAllRoles(database, key)
        }
        const featureList = await listAvailableFeatures(database)
        setAvailableFeatures(featureList)
    }

    async function reloadUsers(): Promise<void> {
        if (!database) return
        const userList = await listUsersPaged(database, { searchText, roleFilter, limit: pageSize })
        setUsers(userList)
    }

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-20 backdrop-blur-xl">
                    <nav className="max-w-6xl mx-auto px-6 py-4">
                        <h1 className="text-3xl font-bold mt-4 text-foreground">Roles y Permisos</h1>
                    </nav>
                </header>
                <div className="max-w-6xl mx-auto p-6 mt-8 space-y-8">
                    {loading && (<div className="p-3 text-sm text-muted-foreground">Cargando…</div>)}
                    {error && (<div className="p-3 text-sm text-red-600 border border-red-300 rounded">{error}</div>)}

                    {/* Crear rol */}
                    <section className="bg-card rounded-2xl border border-border p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4">Crear Rol</h2>
                        <div className="flex items-center gap-3">
                            <input
                                type="text"
                                value={newRole}
                                placeholder="Nombre de rol (ej. Auditor)"
                                onChange={(e) => setNewRole(e.target.value)}
                                className="flex-1 px-4 py-3 bg-input border border-border rounded-lg text-foreground"
                            />
                            <button onClick={handleCreateRole} className="px-4 py-3 bg-primary text-primary-foreground rounded-lg">Crear</button>
                        </div>
                    </section>

                    {/* Catálogo de Features */}
                    <section className="bg-card rounded-2xl border border-border p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4">Catálogo de Permisos (BD)</h2>
                        <p className="text-sm text-muted-foreground mb-4">Gestiona permisos desde la BD: añade nuevas claves, activa/desactiva y elimina. Las claves activas se usan en roles y overrides.</p>
                        <div className="grid md:grid-cols-3 gap-3 mb-4">
                            {availableFeatures.map(f => (
                                <div key={f} className="flex items-center justify-between gap-2 border border-border rounded px-3 py-2">
                                    <label className="flex items-center gap-2">
                                        <input type="checkbox" checked={true} onChange={(e) => setNewFeatureMap(prev => ({ ...prev, [f]: e.target.checked }))} />
                                        <span className="text-sm text-foreground break-all">{f}</span>
                                    </label>
                                    <button onClick={() => removeFeature(f)} className="text-xs px-2 py-1 bg-red-600 text-white rounded">Eliminar</button>
                                </div>
                            ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mb-3">
                            <input
                                type="text"
                                value={newFeatureKey}
                                placeholder="Nueva clave de permiso (ej. manageUsers)"
                                onChange={(e) => setNewFeatureKey(e.target.value)}
                                className="px-3 py-2 bg-input border border-border rounded"
                            />
                            <button onClick={addNewFeature} className="px-4 py-2 bg-secondary text-white rounded">Añadir permiso</button>
                            <label className="flex items-center gap-2 text-sm text-muted-foreground">
                                <input type="checkbox" checked={cleanRolesOnDelete} onChange={(e) => setCleanRolesOnDelete(e.target.checked)} />
                                Eliminar también de roles al borrar permiso
                            </label>
                        </div>
                        <div>
                            <button onClick={applyFeatureCatalogChanges} className="px-4 py-3 bg-primary text-primary-foreground rounded-lg">Guardar cambios</button>
                        </div>
                    </section>

                    {/* Roles */}
                    <section className="bg-card rounded-2xl border border-border p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4">Permisos por Rol</h2>
                        <div className="space-y-6">
                            {roles.map(r => (
                                <div key={r.role} className="border border-border rounded-lg p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-lg font-semibold text-foreground">{r.role}</h3>
                                    </div>
                                    <div className="grid md:grid-cols-3 gap-3">
                                        {featureKeys.map(f => (
                                            <label key={f} className="flex items-center gap-2">
                                                <input type="checkbox" checked={r.features[f] ?? false} onChange={(e) => toggleRoleFeature(r, f, e.target.checked)} />
                                                <span className="text-sm text-foreground capitalize">{f}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Usuarios (búsqueda y filtros) */}
                    <section className="bg-card rounded-2xl border border-border p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4">Usuarios</h2>
                        <div className="flex flex-wrap items-center gap-3 mb-4">
                            <input
                                type="text"
                                value={searchText}
                                placeholder="Buscar por nombre (prefijo)"
                                onChange={(e) => setSearchText(e.target.value)}
                                className="px-3 py-2 bg-input border border-border rounded"
                            />
                            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as AppRole | "ALL")} className="px-3 py-2 bg-input border border-border rounded">
                                <option value="ALL">Todos los roles</option>
                                {roles.map(r => (<option key={r.role} value={r.role}>{r.role}</option>))}
                            </select>
                            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="px-3 py-2 bg-input border border-border rounded">
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                            </select>
                            <button onClick={reloadUsers} className="px-4 py-2 bg-primary text-primary-foreground rounded">Buscar</button>
                        </div>
                        <div className="space-y-4">
                            {users.map(u => (
                                <div key={u.uid} className="border border-border rounded-lg p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-foreground">{u.name}</p>
                                            <p className="text-xs text-muted-foreground">{u.email}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-muted-foreground">Rol</span>
                                            <select value={u.role ?? "User"} onChange={(e) => assignUserRole(u, e.target.value as AppRole)} className="px-2 py-2 bg-input border border-border rounded text-sm capitalize">
                                                {roles.map(r => (<option key={r.role} value={r.role}>{r.role}</option>))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="mt-3 grid md:grid-cols-3 gap-3">
                                        {featureKeys.map(f => (
                                            <label key={f} className="flex items-center gap-2">
                                                <input type="checkbox" onChange={(e) => toggleUserOverride(u.uid, f, e.target.checked)} />
                                                <span className="text-sm text-foreground capitalize">{f}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </Layout>
    )
}
