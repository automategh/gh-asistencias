import Layout from "@/components/layouts/layout"
import { useEffect, useMemo, useState } from "react"
import type { CrossDbUserItem } from "@/types/user"
import { listAllUsersAcrossDatabases, filterUsers, assignRoleInUserDatabase, activateUserInUserDatabase, deactivateUserInUserDatabase } from "@/services/roles.service"
import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver"
import type { AppRole } from "@/types/permissions"
import { ChevronRight, ShieldCheck, Users } from "lucide-react"

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
    const fieldClassName = "w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] appearance-none focus:ring-2 focus:ring-primary-container"

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
            <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs border-b border-[#edeeed]">
                    <nav className="px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto">
                        <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                            <span>Configuración</span>
                            <ChevronRight className="w-4 h-4" />
                            <span>Permisos</span>
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-[#191c1c] flex items-center gap-3">
                            <ShieldCheck className="w-7 h-7 text-[#1b3022]" />
                            Asignación de Roles
                        </h1>
                        <p className="text-sm text-[#5f6560] mt-1">Gestiona roles, activación y estado de usuarios en todas las bases de datos.</p>
                    </nav>
                </header>

                <div className="px-4 md:px-12 py-10 md:py-10 space-y-10 max-w-7xl mx-auto">
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
                        <div className="flex flex-wrap items-end gap-6">
                            <div className="flex-2 min-w-64">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Buscar</label>
                                <input
                                    type="text"
                                    value={searchText}
                                    placeholder="Buscar por nombre o correo"
                                    onChange={(e) => setSearchText(e.target.value)}
                                    className={fieldClassName}
                                />
                            </div>
                            <div className="flex-1 min-w-44">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Recinto</label>
                                <select value={recintoFilter} onChange={(e) => setRecintoFilter(e.target.value as RecintoKey | "ALL")} className={fieldClassName}>
                                    <option value="ALL">Todos los recintos</option>
                                    {availableRecintos.map(r => (<option key={r.key} value={r.key}>{r.name}</option>))}
                                </select>
                            </div>
                            <div className="flex-1 min-w-40">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Rol</label>
                                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as AppRole | "ALL")} className={fieldClassName}>
                                    <option value="ALL">Todos los roles</option>
                                    <option value="Admin">Admin</option>
                                    <option value="Lider">Lider</option>
                                    <option value="HR">Talento Humano</option>
                                    <option value="Instructor">Instructor</option>
                                    <option value="User">User</option>
                                </select>
                            </div>
                            <div className="flex-1 min-w-40">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Estado</label>
                                <select
                                    value={activeFilter === "ALL" ? "ALL" : String(activeFilter)}
                                    onChange={(e) => {
                                        const v = e.target.value
                                        setActiveFilter(v === "ALL" ? "ALL" : v === "true")
                                    }}
                                    className={fieldClassName}
                                >
                                    <option value="ALL">Todos los estados</option>
                                    <option value="true">Activos</option>
                                    <option value="false">Inactivos</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#5f6560]">
                            <Users className="w-4 h-4" />
                            <span>
                                Mostrando <span className="font-semibold text-[#191c1c]">{visible.length}</span> usuario{visible.length === 1 ? "" : "s"} con los filtros aplicados.
                            </span>
                        </div>
                    </section>

                    <section className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden">
                        <div className="p-8 border-b border-[#edeeed] flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold text-emerald-950">Usuarios</h2>
                                <p className="text-xs text-outline font-medium mt-1">Administra activación y roles por base de datos.</p>
                            </div>
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#d0e9d4] text-[#1b3022]">
                                {visible.length} registro{visible.length === 1 ? "" : "s"}
                            </span>
                        </div>
                        <div className="p-8 space-y-4">
                            {!loading && visible.length === 0 && (
                                <div className="bg-[#fcfcfb] border border-[#edeeed] rounded-2xl p-8 text-center">
                                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#f3f4f3] flex items-center justify-center">
                                        <Users className="w-8 h-8 text-[#5f6560]" />
                                    </div>
                                    <h3 className="text-lg font-bold text-[#191c1c] mb-2">Sin resultados</h3>
                                    <p className="text-sm text-[#5f6560]">No hay usuarios que coincidan con los filtros seleccionados.</p>
                                </div>
                            )}

                        <div className="space-y-4">
                            {/* Vista agrupada por departamento cuando se están viendo inactivos */}
                            {!loading && activeFilter === false && Object.keys(inactiveGroupsByDepartment).length > 0 ? (
                                Object.entries(inactiveGroupsByDepartment).map(([dept, users]) => (
                                    <div key={dept} className="border border-[#edeeed] rounded-2xl p-5 space-y-4 bg-[#fcfcfb] shadow-[0_12px_24px_rgba(25,28,28,0.03)]">
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <p className="text-sm font-bold text-[#191c1c]">Departamento: {dept}</p>
                                                <p className="text-xs text-[#5f6560]">Estos son los de {dept.toLowerCase()} inactivos.</p>
                                            </div>
                                            <button
                                                type="button"
                                                className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4] transition-colors"
                                                disabled={activatingDepartment[dept]}
                                                onClick={() => activateDepartment(dept)}
                                            >
                                                {activatingDepartment[dept] ? "Activando…" : "Activar todos"}
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {users.map((u) => (
                                                <div key={`${u.databaseUrl}-${u.uid}`} className="border border-[#edeeed] rounded-xl p-4 bg-white">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="text-sm font-bold text-[#191c1c]">{u.name}</p>
                                                            <p className="text-xs text-[#5f6560]">{u.email}</p>
                                                            <p className="text-xs text-[#5f6560] mt-1">Recinto: <span className="font-semibold text-[#191c1c]">{u.recinto}</span></p>
                                                            <p className="text-xs mt-1">Estado: <span className={u.active ? "text-[#1b5e20]" : "text-[#8c1d18]"}>{u.active ? "Activo" : "Inactivo"}</span></p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm text-[#5f6560]">Rol</span>
                                                            <select value={u.role ?? "User"} onChange={(e) => assignRole(u, e.target.value as AppRole)} className="px-3 py-2 bg-[#fcfcfb] border border-[#edeeed] rounded-lg text-sm font-medium text-[#191c1c] capitalize">
                                                                <option value="Admin">Admin</option>
                                                                <option value="Lider">Lider</option>
                                                                <option value="HR">Talento Humano</option>
                                                                <option value="Instructor">Instructor</option>
                                                                <option value="User">User</option>
                                                            </select>
                                                            <button
                                                                className={`px-3 py-2 rounded-lg text-sm font-semibold border border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4] transition-colors`}
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
                                        <div key={`${u.databaseUrl}-${u.uid}`} className="border border-[#edeeed] rounded-2xl p-5 bg-[#fcfcfb] shadow-[0_12px_24px_rgba(25,28,28,0.03)]">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-bold text-[#191c1c]">{u.name}</p>
                                                    <p className="text-xs text-[#5f6560]">{u.email}</p>
                                                    <p className="text-xs text-[#5f6560] mt-1">Recinto: <span className="font-semibold text-[#191c1c]">{u.recinto}</span></p>
                                                    <p className="text-xs mt-1">Estado: <span className={u.active ? "text-[#1b5e20]" : "text-[#8c1d18]"}>{u.active ? "Activo" : "Inactivo"}</span></p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm text-[#5f6560]">Rol</span>
                                                    <select value={u.role ?? "User"} onChange={(e) => assignRole(u, e.target.value as AppRole)} className="px-3 py-2 bg-white border border-[#edeeed] rounded-lg text-sm font-medium text-[#191c1c] capitalize">
                                                        <option value="Admin">Admin</option>
                                                        <option value="Lider">Lider</option>
                                                        <option value="HR">Talento Humano</option>
                                                        <option value="Instructor">Instructor</option>
                                                        <option value="User">User</option>
                                                    </select>
                                                    {u.active ? (
                                                        <button
                                                            className={`px-3 py-2 rounded-lg text-sm font-semibold border border-[#8c1d18] text-[#8c1d18] hover:bg-[#fff6f5] transition-colors`}
                                                            disabled={activating[`${u.databaseUrl}-${u.uid}`]}
                                                            onClick={() => deactivateUser(u)}
                                                            title="Desactivar usuario"
                                                        >
                                                            {activating[`${u.databaseUrl}-${u.uid}`] ? "Desactivando…" : "Desactivar"}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className={`px-3 py-2 rounded-lg text-sm font-semibold border border-[#1b3022] text-[#1b3022] hover:bg-[#d0e9d4] transition-colors`}
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
                        </div>
                        </div>
                    </section>
                </div>
            </div>
        </Layout>
    )
}
