import Layout from "@/components/layouts/layout"
import { useEffect, useMemo, useState } from "react"
import type { CrossDbUserItem } from "@/types/user"
import { listAllUsersAcrossDatabases, filterUsers, assignRoleInUserDatabase, activateUserInUserDatabase, deactivateUserInUserDatabase } from "@/services/roles.service"
import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver"
import type { AppRole } from "@/types/permissions"

/**
 * Página de gestión de permisos y roles.
 *
 * - Lista usuarios provenientes de todas las bases de datos configuradas.
 * - Permite filtrar por nombre/correo, recinto, rol y estado (activo/inactivo).
 * - Habilita cambio de rol y activación/desactivación respetando la BD de origen.
 */
export default function PermissionsPage() {
    const [allUsers, setAllUsers] = useState<CrossDbUserItem[]>([])
    const [visible, setVisible] = useState<CrossDbUserItem[]>([])
    const [searchText, setSearchText] = useState<string>("")
    const [roleFilter, setRoleFilter] = useState<AppRole | "ALL">("ALL")
    const [recintoFilter, setRecintoFilter] = useState<RecintoKey | "ALL">("ALL")
    const [activeFilter, setActiveFilter] = useState<boolean | "ALL">("ALL")
    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [activating, setActivating] = useState<Record<string, boolean>>({})
    const [activatingDepartment, setActivatingDepartment] = useState<Record<string, boolean>>({})

    const availableRecintos = useMemo(() => getAllAvailableDatabases(), [])

    useEffect(() => {
        let cancelled = false
        /**
         * Carga inicial de usuarios desde todas las bases de datos disponibles.
         * Actualiza `allUsers` y maneja estado de carga/errores.
         */
        async function loadAll(): Promise<void> {
            try {
                setLoading(true)
                setError(null)
                const users = await listAllUsersAcrossDatabases()
                if (!cancelled) {
                    setAllUsers(users)
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "No fue posible cargar usuarios")
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        loadAll().catch(() => setError("No fue posible cargar usuarios"))
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        /**
         * Aplica los filtros de búsqueda, recinto, rol y estado
         * sobre la lista completa de usuarios y actualiza `visible`.
         */
        const filtered = filterUsers(allUsers, { searchText, recinto: recintoFilter, role: roleFilter, active: activeFilter })
        setVisible(filtered)
    }, [allUsers, searchText, recintoFilter, roleFilter, activeFilter])

    const inactiveGroupsByDepartment = useMemo(() => {
        const groups: Record<string, CrossDbUserItem[]> = {}
        visible.forEach((u) => {
            if (u.active) return
            const deptRaw = (u.department ?? "").trim()
            const dept = deptRaw.length > 0 ? deptRaw : "Sin departamento"
            if (!groups[dept]) groups[dept] = []
            groups[dept].push(u)
        })
        return groups
    }, [visible])

    /**
     * Asigna un rol a un usuario en su base de datos correspondiente
     * y sincroniza el cambio en el estado local.
     *
     * @param u Usuario cruzado (incluye URL de su BD)
     * @param role Rol de aplicación a establecer
     */
    async function assignRole(u: CrossDbUserItem, role: AppRole): Promise<void> {
        await assignRoleInUserDatabase(u, role)
        setAllUsers(prev => prev.map(x => x.uid === u.uid && x.databaseUrl === u.databaseUrl ? { ...x, role } : x))
    }

    /**
     * Activa a un usuario en su base de datos de origen y
     * refleja el cambio en el listado local.
     * Gestiona también un estado de "busy" por usuario.
     */
    async function activateUser(u: CrossDbUserItem): Promise<void> {
        const key = `${u.databaseUrl}-${u.uid}`
        setActivating(prev => ({ ...prev, [key]: true }))
        try {
            await activateUserInUserDatabase(u)
            setAllUsers(prev => prev.map(x => x.uid === u.uid && x.databaseUrl === u.databaseUrl ? { ...x, active: true } : x))
        } catch (e) {
            console.error("No fue posible activar el usuario:", e)
        } finally {
            setActivating(prev => ({ ...prev, [key]: false }))
        }
    }

    /**
     * Desactiva a un usuario en su base de datos de origen y
     * refleja el cambio en el listado local.
     * Gestiona también un estado de "busy" por usuario.
     */
    async function deactivateUser(u: CrossDbUserItem): Promise<void> {
        const key = `${u.databaseUrl}-${u.uid}`
        setActivating(prev => ({ ...prev, [key]: true }))
        try {
            await deactivateUserInUserDatabase(u)
            setAllUsers(prev => prev.map(x => x.uid === u.uid && x.databaseUrl === u.databaseUrl ? { ...x, active: false } : x))
        } catch (e) {
            console.error("No fue posible desactivar el usuario:", e)
        } finally {
            setActivating(prev => ({ ...prev, [key]: false }))
        }
    }

    /**
     * Activa en bloque a todos los usuarios inactivos de un departamento
     * (según la vista filtrada actual) utilizando la función `activateUser`.
     */
    async function activateDepartment(department: string): Promise<void> {
        const usersInDept = visible.filter((u) => {
            const deptRaw = (u.department ?? "").trim()
            const dept = deptRaw.length > 0 ? deptRaw : "Sin departamento"
            return !u.active && dept === department
        })

        if (usersInDept.length === 0) return

        setActivatingDepartment(prev => ({ ...prev, [department]: true }))
        try {
            for (const u of usersInDept) {
                // Reutiliza la lógica de activación individual
                // para mantener consistente el estado local.
                // La activación se hace secuencialmente para evitar saturar la red.
                await activateUser(u)
            }
        } finally {
            setActivatingDepartment(prev => ({ ...prev, [department]: false }))
        }
    }

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-20 backdrop-blur-xl">
                    <nav className="max-w-6xl mx-auto px-6 py-4">
                        <h1 className="text-3xl font-bold mt-4 text-foreground">Asignación de Roles</h1>
                        <p className="text-sm text-muted-foreground">Gestiona roles de usuarios en todas las bases de datos.</p>
                    </nav>
                </header>
                <div className="max-w-6xl mx-auto p-6 mt-8 space-y-8">
                    {loading && (<div className="p-3 text-sm text-muted-foreground">Cargando…</div>)}
                    {error && (<div className="p-3 text-sm text-red-600 border border-red-300 rounded">{error}</div>)}

                    {/* Filtros */}
                    <section className="bg-card rounded-2xl border border-border p-6">
                        <div className="flex flex-wrap items-center gap-3">
                            <input
                                type="text"
                                value={searchText}
                                placeholder="Buscar por nombre o correo"
                                onChange={(e) => setSearchText(e.target.value)}
                                className="px-3 py-2 bg-input border border-border rounded"
                            />
                            <select value={recintoFilter} onChange={(e) => setRecintoFilter(e.target.value as RecintoKey | "ALL")} className="px-3 py-2 bg-input border border-border rounded">
                                <option value="ALL">Todos los recintos</option>
                                {availableRecintos.map(r => (<option key={r.key} value={r.key}>{r.name}</option>))}
                            </select>
                            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as AppRole | "ALL")} className="px-3 py-2 bg-input border border-border rounded">
                                <option value="ALL">Todos los roles</option>
                                <option value="Admin">Admin</option>
                                <option value="Lider">Lider</option>
                                <option value="HR">HR</option>
                                <option value="Instructor">Instructor</option>
                                <option value="User">User</option>
                            </select>
                            <select
                                value={activeFilter === "ALL" ? "ALL" : String(activeFilter)}
                                onChange={(e) => {
                                    const v = e.target.value
                                    setActiveFilter(v === "ALL" ? "ALL" : v === "true")
                                }}
                                className="px-3 py-2 bg-input border border-border rounded"
                            >
                                <option value="ALL">Todos los estados</option>
                                <option value="true">Activos</option>
                                <option value="false">Inactivos</option>
                            </select>
                        </div>
                    </section>

                    {/* Usuarios */}
                    <section className="bg-card rounded-2xl border border-border p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4">Usuarios ({visible.length})</h2>
                        <div className="space-y-4">
                            {/* Vista agrupada por departamento cuando se están viendo inactivos */}
                            {!loading && activeFilter === false && Object.keys(inactiveGroupsByDepartment).length > 0 ? (
                                Object.entries(inactiveGroupsByDepartment).map(([dept, users]) => (
                                    <div key={dept} className="border border-border rounded-lg p-4 space-y-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <p className="text-sm font-semibold text-foreground">Departamento: {dept}</p>
                                                <p className="text-xs text-muted-foreground">Estos son los de {dept.toLowerCase()} inactivos.</p>
                                            </div>
                                            <button
                                                type="button"
                                                className="px-3 py-2 rounded text-sm border border-primary text-primary hover:bg-primary/10"
                                                disabled={activatingDepartment[dept]}
                                                onClick={() => activateDepartment(dept)}
                                            >
                                                {activatingDepartment[dept] ? "Activando…" : "Activar todos"}
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {users.map((u) => (
                                                <div key={`${u.databaseUrl}-${u.uid}`} className="border border-border rounded-lg p-3">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="text-sm font-semibold text-foreground">{u.name}</p>
                                                            <p className="text-xs text-muted-foreground">{u.email}</p>
                                                            <p className="text-xs text-muted-foreground mt-1">Recinto: <span className="font-medium">{u.recinto}</span></p>
                                                            <p className="text-xs mt-1">Estado: <span className={u.active ? "text-green-600" : "text-red-600"}>{u.active ? "Activo" : "Inactivo"}</span></p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm text-muted-foreground">Rol</span>
                                                            <select value={u.role ?? "User"} onChange={(e) => assignRole(u, e.target.value as AppRole)} className="px-2 py-2 bg-input border border-border rounded text-sm capitalize">
                                                                <option value="Admin">Admin</option>
                                                                <option value="Lider">Lider</option>
                                                                <option value="HR">HR</option>
                                                                <option value="Instructor">Instructor</option>
                                                                <option value="User">User</option>
                                                            </select>
                                                            <button
                                                                className={`px-3 py-2 rounded text-sm border border-primary text-primary hover:bg-primary/10`}
                                                                disabled={activating[`${u.databaseUrl}-${u.uid}`]}
                                                                onClick={() => activateUser(u)}
                                                                title="Activar usuario"
                                                            >
                                                                {activating[`${u.databaseUrl}-${u.uid}`] ? "Activando…" : "Activar"}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <>
                                    {visible.map(u => (
                                        <div key={`${u.databaseUrl}-${u.uid}`} className="border border-border rounded-lg p-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-semibold text-foreground">{u.name}</p>
                                                    <p className="text-xs text-muted-foreground">{u.email}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">Recinto: <span className="font-medium">{u.recinto}</span></p>
                                                    <p className="text-xs mt-1">Estado: <span className={u.active ? "text-green-600" : "text-red-600"}>{u.active ? "Activo" : "Inactivo"}</span></p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm text-muted-foreground">Rol</span>
                                                    <select value={u.role ?? "User"} onChange={(e) => assignRole(u, e.target.value as AppRole)} className="px-2 py-2 bg-input border border-border rounded text-sm capitalize">
                                                        <option value="Admin">Admin</option>
                                                        <option value="Lider">Lider</option>
                                                        <option value="HR">HR</option>
                                                        <option value="Instructor">Instructor</option>
                                                        <option value="User">User</option>
                                                    </select>
                                                    {u.active ? (
                                                        <button
                                                            className={`px-3 py-2 rounded text-sm border border-red-600 text-red-600 hover:bg-red-600/10`}
                                                            disabled={activating[`${u.databaseUrl}-${u.uid}`]}
                                                            onClick={() => deactivateUser(u)}
                                                            title="Desactivar usuario"
                                                        >
                                                            {activating[`${u.databaseUrl}-${u.uid}`] ? "Desactivando…" : "Desactivar"}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className={`px-3 py-2 rounded text-sm border border-primary text-primary hover:bg-primary/10`}
                                                            disabled={activating[`${u.databaseUrl}-${u.uid}`]}
                                                            onClick={() => activateUser(u)}
                                                            title="Activar usuario"
                                                        >
                                                            {activating[`${u.databaseUrl}-${u.uid}`] ? "Activando…" : "Activar"}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}
                            {!loading && visible.length === 0 && (<div className="text-sm text-muted-foreground">Sin resultados</div>)}
                        </div>
                    </section>
                </div>
            </div>
        </Layout>
    )
}
