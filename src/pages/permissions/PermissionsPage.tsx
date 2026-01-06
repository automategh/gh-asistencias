import Layout from "@/components/layouts/layout"
import { useEffect, useMemo, useState } from "react"
import type { AppRole } from "@/types/permissions"
import type { CrossDbUserItem } from "@/types/user"
import { listAllUsersAcrossDatabases, filterUsers, assignRoleInUserDatabase } from "@/services/roles.service"
import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver"

/**
 * Módulo de Asignación de Roles (sin permisos).
 * Lista usuarios de las 4 bases de datos y permite asignar un rol.
 */
export default function PermissionsPage() {
    const [allUsers, setAllUsers] = useState<CrossDbUserItem[]>([])
    const [visible, setVisible] = useState<CrossDbUserItem[]>([])
    const [searchText, setSearchText] = useState<string>("")
    const [roleFilter, setRoleFilter] = useState<AppRole | "ALL">("ALL")
    const [recintoFilter, setRecintoFilter] = useState<RecintoKey | "ALL">("ALL")
    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)

    const availableRecintos = useMemo(() => getAllAvailableDatabases(), [])

    useEffect(() => {
        let cancelled = false
        async function loadAll() {
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
        const filtered = filterUsers(allUsers, { searchText, recinto: recintoFilter, role: roleFilter })
        setVisible(filtered)
    }, [allUsers, searchText, recintoFilter, roleFilter])

    async function assignRole(u: CrossDbUserItem, role: AppRole): Promise<void> {
        await assignRoleInUserDatabase(u, role)
        setAllUsers(prev => prev.map(x => x.uid === u.uid && x.databaseUrl === u.databaseUrl ? { ...x, role } : x))
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
                        </div>
                    </section>

                    {/* Usuarios */}
                    <section className="bg-card rounded-2xl border border-border p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4">Usuarios ({visible.length})</h2>
                        <div className="space-y-4">
                            {visible.map(u => (
                                <div key={`${u.databaseUrl}-${u.uid}`} className="border border-border rounded-lg p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-foreground">{u.name}</p>
                                            <p className="text-xs text-muted-foreground">{u.email}</p>
                                            <p className="text-xs text-muted-foreground mt-1">Recinto: <span className="font-medium">{u.recinto}</span></p>
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
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {!loading && visible.length === 0 && (<div className="text-sm text-muted-foreground">Sin resultados</div>)}
                        </div>
                    </section>
                </div>
            </div>
        </Layout>
    )
}
