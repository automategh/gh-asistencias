import Layout from "@/components/layouts/layout"
import { useAuth } from "@/context/AuthContext"
import { useDatabase } from "@/context/DatabaseContext"
import { getTrainingYearsForDatabase } from "@/services/meetings.analytics.service"
import { getUserInvitedMeetings } from "@/services/meetings.listing.service"
import { getUsersForReports, type ReportUserItem } from "@/services/user.service"
import type { Meeting } from "@/types/meeting"
import { CalendarDays, ChevronRight, LucideBarChart, Search, Users as UsersIcon, Clock } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

interface UserGroupStats {
    readonly user: ReportUserItem
    readonly totalHours: number
    readonly meetingsCount: number
}

interface GroupAggregate {
    readonly totalHours: number
    readonly totalMeetings: number
    readonly peopleCount: number
}

function ReportGroupPage() {
    const navigate = useNavigate()
    const { user, role } = useAuth()
    const { database } = useDatabase()

    const [allUsers, setAllUsers] = useState<ReportUserItem[]>([])
    const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(false)
    const [usersError, setUsersError] = useState<string | null>(null)

    const [availableYears, setAvailableYears] = useState<number[]>([])
    const [selectedYear, setSelectedYear] = useState<number | null>(null)
    const [isLoadingYears, setIsLoadingYears] = useState<boolean>(false)

    const [search, setSearch] = useState<string>("")

    const [isLoadingStats, setIsLoadingStats] = useState<boolean>(false)
    const [stats, setStats] = useState<UserGroupStats[]>([])
    const [aggregate, setAggregate] = useState<GroupAggregate>({
        totalHours: 0,
        totalMeetings: 0,
        peopleCount: 0,
    })

    useEffect(() => {
        if (!database || !user) {
            setAllUsers([])
            return
        }

        let cancelled = false

        const loadUsers = async () => {
            try {
                setIsLoadingUsers(true)
                setUsersError(null)

                const leaderName = role === "Lider" ? user.displayName ?? null : null
                const list = await getUsersForReports(database, { leaderName })

                if (cancelled) {
                    return
                }

                setAllUsers(list)
            } catch (error) {
                console.error("No fue posible cargar los usuarios para el reporte General:", error)
                if (!cancelled) {
                    setAllUsers([])
                    setUsersError("No fue posible cargar la lista de colaboradores.")
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingUsers(false)
                }
            }
        }

        void loadUsers()

        return () => {
            cancelled = true
        }
    }, [database, role, user])

    useEffect(() => {
        if (!database) {
            setAvailableYears([])
            setSelectedYear(null)
            return
        }

        let cancelled = false

        const loadYears = async () => {
            try {
                setIsLoadingYears(true)
                const years = await getTrainingYearsForDatabase(database)

                if (cancelled) {
                    return
                }

                setAvailableYears(years)

                if (years.length === 0) {
                    setSelectedYear(null)
                    return
                }

                setSelectedYear((previous) => {
                    if (previous && years.includes(previous)) {
                        return previous
                    }
                    const currentYear = new Date().getFullYear()
                    return years.includes(currentYear) ? currentYear : years[0]
                })
            } catch (error) {
                console.error("No fue posible cargar los años para el reporte General:", error)
                if (!cancelled) {
                    setAvailableYears([])
                    setSelectedYear(null)
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingYears(false)
                }
            }
        }

        void loadYears()

        return () => {
            cancelled = true
        }
    }, [database])

    useEffect(() => {
        if (!database || !selectedYear || allUsers.length === 0) {
            setStats([])
            setAggregate({
                totalHours: 0,
                totalMeetings: 0,
                peopleCount: 0,
            })
            return
        }

        let cancelled = false

        const loadStats = async () => {
            try {
                setIsLoadingStats(true)

                const uniqueMeetingHours = new Map<string, number>()

                const now = Date.now()
                const lookbackMs = 3 * 365 * 24 * 60 * 60 * 1000

                const tasks = allUsers.map(async (item) => {
                    const invited = await getUserInvitedMeetings(database, item.uid, now, lookbackMs, ["completed", "closed"])

                    if (cancelled) {
                        return null
                    }

                    const meetingsInYear = invited.filter((meeting: Meeting) => {
                        const year = new Date(meeting.startTime).getFullYear()
                        return year === selectedYear
                    })

                    if (meetingsInYear.length === 0) {
                        return {
                            user: item,
                            totalHours: 0,
                            meetingsCount: 0,
                        }
                    }

                    let totalHours = 0
                    for (const meeting of meetingsInYear) {
                        const durationMs = Math.max(0, meeting.endTime - meeting.startTime)
                        const hours = durationMs / (1000 * 60 * 60)
                        totalHours += hours
                        uniqueMeetingHours.set(meeting.id, hours)
                    }

                    return {
                        user: item,
                        totalHours,
                        meetingsCount: meetingsInYear.length,
                    }
                })

                const results = await Promise.all(tasks)

                if (cancelled) {
                    return
                }

                const compact: UserGroupStats[] = results
                    .filter((item): item is UserGroupStats => Boolean(item))
                    .filter((item) => item.meetingsCount > 0 || item.totalHours > 0)

                compact.sort((first, second) => {
                    if (second.totalHours !== first.totalHours) {
                        return second.totalHours - first.totalHours
                    }
                    return second.meetingsCount - first.meetingsCount
                })

                setStats(compact)

                if (compact.length === 0) {
                    setAggregate({
                        totalHours: 0,
                        totalMeetings: 0,
                        peopleCount: 0,
                    })
                } else {
                    let totalUniqueHours = 0
                    let totalUniqueMeetings = 0

                    for (const hours of uniqueMeetingHours.values()) {
                        totalUniqueHours += hours
                        totalUniqueMeetings += 1
                    }

                    setAggregate({
                        totalHours: totalUniqueHours,
                        totalMeetings: totalUniqueMeetings,
                        peopleCount: compact.length,
                    })
                }
            } catch (error) {
                console.error("No fue posible calcular el reporte General:", error)
                if (!cancelled) {
                    setStats([])
                    setAggregate({
                        totalHours: 0,
                        totalMeetings: 0,
                        peopleCount: 0,
                    })
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingStats(false)
                }
            }
        }

        void loadStats()

        return () => {
            cancelled = true
        }
    }, [allUsers, database, selectedYear])

    const filteredStats = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) {
            return stats
        }

        return stats.filter((item) => {
            const { user: u } = item
            const name = u.name.toLowerCase()
            const email = u.email.toLowerCase()
            const department = (u.department ?? "").toLowerCase()
            const cargo = (u.cargo ?? "").toLowerCase()
            return (
                name.includes(term)
                || email.includes(term)
                || department.includes(term)
                || cargo.includes(term)
            )
        })
    }, [search, stats])

    useEffect(() => {
        if (stats.length === 0 && !isLoadingStats) {
            setAggregate({
                totalHours: 0,
                totalMeetings: 0,
                peopleCount: 0,
            })
        }
    }, [isLoadingStats, stats.length])

    return (
        <Layout>
            <div className="bg-linear-to-br from-background via-muted/5 to-background">
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className="px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center">
                        <div>
                            <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                                <span
                                    className="hover:text-secondary cursor-pointer transition-colors"
                                    onClick={() => navigate("/reports")}
                                >
                                    Reportes
                                </span>
                                <ChevronRight className="w-4 h-4" />
                                <span>General</span>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight">Reporte General</h1>
                            <p className="font-body text-[#434843] text-sm mt-1 max-w-xl">
                                Visualiza cómo se distribuyen las horas y actividades entre los colaboradores de tu organización
                                durante el año seleccionado.
                            </p>
                        </div>
                    </nav>
                </header>

                <div className="px-4 md:px-12 py-10 md:py-14 space-y-10">
                    <div className="mx-auto max-w-7xl space-y-8">
                        {usersError && (
                            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-800">
                                {usersError}
                            </div>
                        )}

                        <section className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex-1 flex items-center gap-3 rounded-full bg-white border border-[#e3e5e3] px-4 py-2 shadow-xs">
                                <Search className="w-4 h-4 text-[#7a837a]" />
                                <input
                                    type="text"
                                    className="flex-1 bg-transparent text-sm text-[#191c1c] placeholder:text-[#9aa29a] focus:outline-none disabled:text-[#b3bab3]"
                                    placeholder="Buscar colaboradores por nombre, correo, cargo o departamento..."
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    disabled={isLoadingUsers}
                                />
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 rounded-full bg-white border border-[#e3e5e3] px-3 py-1.5 shadow-xs">
                                    <CalendarDays className="w-4 h-4 text-[#7a837a]" />
                                    <select
                                        className="bg-transparent text-xs font-semibold text-[#191c1c] focus:outline-none disabled:text-[#b3bab3]"
                                        value={selectedYear ?? ""}
                                        onChange={(event) => {
                                            const value = event.target.value
                                            setSelectedYear(value ? Number(value) : null)
                                        }}
                                        disabled={isLoadingYears || isLoadingUsers}
                                    >
                                        <option value="" disabled>
                                            {isLoadingYears || isLoadingUsers ? "Cargando datos..." : "Selecciona un año"}
                                        </option>
                                        {availableYears.map((year) => (
                                            <option key={year} value={year}>
                                                {year}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </section>

                        <section className="grid gap-4 md:grid-cols-3">
                            <div className="bg-[#0c3323] text-white rounded-3xl p-6 flex flex-col justify-between shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-200 font-bold mb-1">
                                            Horas totales
                                        </p>
                                        <p className="text-3xl font-extrabold">
                                            {selectedYear && !isLoadingStats ? aggregate.totalHours.toFixed(1) : "--"}
                                        </p>
                                    </div>
                                    <Clock className="w-9 h-9 text-emerald-100" />
                                </div>
                                <p className="text-[11px] text-emerald-100">
                                    Suma de horas en todas las actividades y capacitaciones del año seleccionado.
                                </p>
                            </div>
                            <div className="bg-white rounded-3xl border border-[#edeeed] p-6 shadow-sm flex flex-col justify-between">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold mb-1">
                                            Actividades registradas
                                        </p>
                                        <p className="text-3xl font-extrabold text-[#191c1c]">
                                            {selectedYear && !isLoadingStats ? aggregate.totalMeetings : "--"}
                                        </p>
                                    </div>
                                    <LucideBarChart className="w-9 h-9 text-emerald-700" />
                                </div>
                                <p className="text-[11px] text-[#7a837a]">
                                    Número total de actividades cerradas o completadas en las que participaron los colaboradores.
                                </p>
                            </div>
                            <div className="bg-white rounded-3xl border border-[#edeeed] p-6 shadow-sm flex flex-col justify-between">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold mb-1">
                                            Colaboradores activos
                                        </p>
                                        <p className="text-3xl font-extrabold text-[#191c1c]">
                                            {selectedYear && !isLoadingStats ? aggregate.peopleCount : "--"}
                                        </p>
                                    </div>
                                    <UsersIcon className="w-9 h-9 text-emerald-700" />
                                </div>
                                <p className="text-[11px] text-[#7a837a]">
                                    Colaboradores con al menos una actividad registrada en el año.
                                </p>
                            </div>
                        </section>

                        <section className="bg-white rounded-3xl border border-[#edeeed] p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold">
                                        Distribución por colaborador
                                    </p>
                                    <p className="text-xs text-[#5a665a]">
                                        Ordenado por horas acumuladas. Ideal para detectar equipos con mayor carga de actividades.
                                    </p>
                                </div>
                            </div>

                            {isLoadingStats ? (
                                <p className="text-xs text-[#5a665a]">Calculando métricas Generales...</p>
                            ) : !selectedYear ? (
                                <p className="text-xs text-[#5a665a]">Selecciona un año para ver el detalle General.</p>
                            ) : filteredStats.length === 0 ? (
                                <p className="text-xs text-[#5a665a]">
                                    No se encontraron actividades para los colaboradores seleccionados en el año indicado.
                                </p>
                            ) : (
                                <div className="mt-3 space-y-2 max-h-130 overflow-y-auto pr-1">
                                    {filteredStats.map((item) => {
                                        const initials = item.user.name
                                            .split(" ")
                                            .filter((part) => part.length > 0)
                                            .slice(0, 2)
                                            .map((part) => part[0]?.toUpperCase() ?? "")
                                            .join("")

                                        const departmentLabel = item.user.department ?? "Sin departamento"
                                        const cargoLabel = item.user.cargo ?? "Sin cargo"

                                        return (
                                            <article
                                                key={item.user.uid}
                                                className="flex items-center justify-between rounded-2xl border border-[#edeeed] bg-[#fafbfa] px-4 py-3 text-xs"
                                            >
                                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                                    <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center text-[11px] font-semibold">
                                                        {initials || "?"}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-[#191c1c] truncate">{item.user.name}</p>
                                                        <p className="text-[11px] text-[#7a837a] truncate">{item.user.email}</p>
                                                        <p className="mt-0.5 text-[10px] text-[#7a837a] truncate">
                                                            {departmentLabel} · {cargoLabel}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-6 pl-4">
                                                    <div className="text-right">
                                                        <p className="text-[11px] text-[#7a837a]">Horas</p>
                                                        <p className="text-sm font-semibold text-[#191c1c]">
                                                            {item.totalHours.toFixed(1)}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-[11px] text-[#7a837a]">Actividades</p>
                                                        <p className="text-sm font-semibold text-[#191c1c]">
                                                            {item.meetingsCount}
                                                        </p>
                                                    </div>
                                                </div>
                                            </article>
                                        )
                                    })}
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default ReportGroupPage
