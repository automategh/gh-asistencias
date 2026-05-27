import Layout from "@/components/layouts/layout"
import { useAuth } from "@/context/AuthContext"
import { useDatabase } from "@/context/DatabaseContext"
import { getMeetingYearsForDatabase } from "@/services/meetings.analytics.service"
import { getUserInvitedMeetings } from "@/services/meetings.listing.service"
import { getUsersForReports, type ReportUserItem } from "@/services/user.service"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
import { CalendarDays, Search } from "lucide-react"
import { get, ref } from "firebase/database"
import { useEffect, useMemo, useState } from "react"

const MONTH_LABELS: readonly string[] = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
]

function ReportIndividualPage() {

    const { user, hasPermission } = useAuth()
    const { database } = useDatabase()
    const canViewTeamReports = hasPermission("reports_view_team")
    const canViewAllReports = hasPermission("reports_view_all")
    const isTeamScoped = canViewTeamReports && !canViewAllReports

    const [users, setUsers] = useState<ReportUserItem[]>([])
    const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(false)
    const [usersError, setUsersError] = useState<string | null>(null)
    const [search, setSearch] = useState<string>("")
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

    const [availableYears, setAvailableYears] = useState<number[]>([])
    const [selectedYear, setSelectedYear] = useState<number | null>(null)
    const [isLoadingYears, setIsLoadingYears] = useState<boolean>(false)
    const [selectedMonth, setSelectedMonth] = useState<number | null>(null)

    const [isLoadingMetrics, setIsLoadingMetrics] = useState<boolean>(false)
    const [metrics, setMetrics] = useState<{
        totalHours: number
        coursesDone: number
        trainings: Array<{ meeting: Meeting; hours: number }>
    }>({ totalHours: 0, coursesDone: 0, trainings: [] })

    useEffect(() => {
        if (!database || !user) {
            setUsers([])
            setSelectedUserId(null)
            return
        }

        let cancelled = false

        const loadUsers = async () => {
            try {
                setIsLoadingUsers(true)
                setUsersError(null)

                const leaderName = isTeamScoped ? user.displayName ?? null : null
                const list = await getUsersForReports(database, { leaderName })

                if (cancelled) {
                    return
                }

                setUsers(list)
                setSelectedUserId((previous) => previous ?? (list[0]?.uid ?? null))
            } catch (error) {
                console.error("No fue posible cargar los usuarios para el reporte individual:", error)
                if (!cancelled) {
                    setUsers([])
                    setSelectedUserId(null)
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
    }, [database, isTeamScoped, user])

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
                const years = await getMeetingYearsForDatabase(database)

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
                console.error("No fue posible cargar los años de actividades:", error)
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

    const filteredUsers = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) {
            return users
        }

        return users.filter((item) => {
            const name = item.name.toLowerCase()
            const email = item.email.toLowerCase()
            const department = (item.department ?? "").toLowerCase()
            return name.includes(term) || email.includes(term) || department.includes(term)
        })
    }, [search, users])

    useEffect(() => {
        if (!database || !selectedUserId || !selectedYear) {
            setMetrics({ totalHours: 0, coursesDone: 0, trainings: [] })
            return
        }

        let cancelled = false

        const loadMetrics = async () => {
            try {
                setIsLoadingMetrics(true)

                const now = Date.now()
                const lookbackMs = 3 * 365 * 24 * 60 * 60 * 1000
                const invited = await getUserInvitedMeetings(database, selectedUserId, now, lookbackMs, ["completed", "closed"])

                if (cancelled) {
                    return
                }

                const meetingsInPeriod = invited.filter((item) => {
                    const date = new Date(item.startTime)
                    const year = date.getFullYear()
                    const month = date.getMonth() + 1

                    if (year !== selectedYear) {
                        return false
                    }

                    if (selectedMonth && month !== selectedMonth) {
                        return false
                    }

                    return true
                })

                const attendedTrainings: Array<{ meeting: Meeting; hours: number }> = []
                let totalHours = 0

                for (const meeting of meetingsInPeriod) {
                    try {
                        const participantSnap = await get(ref(database, `meetingParticipants/${meeting.id}/${selectedUserId}`))
                        if (!participantSnap.exists()) {
                            continue
                        }

                        const participant = participantSnap.val() as MeetingParticipant
                        const attendance = participant.attendance ?? null
                        const isPresentOrLate = attendance === "present" || attendance === "late"
                        const isNoShow = Boolean(participant.noShow)

                        if (!isPresentOrLate || isNoShow) {
                            continue
                        }

                        const durationMs = Math.max(0, meeting.endTime - meeting.startTime)
                        const hours = durationMs / (1000 * 60 * 60)

                        attendedTrainings.push({
                            meeting,
                            hours,
                        })
                        totalHours += hours
                    } catch (readError) {
                        console.error("No fue posible leer la asistencia individual para el reporte:", readError)
                    }
                }

                setMetrics({
                    totalHours,
                    coursesDone: attendedTrainings.length,
                    trainings: attendedTrainings,
                })
            } catch (error) {
                console.error("No fue posible calcular las métricas individuales de actividades:", error)
                if (!cancelled) {
                    setMetrics({ totalHours: 0, coursesDone: 0, trainings: [] })
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingMetrics(false)
                }
            }
        }

        void loadMetrics()

        return () => {
            cancelled = true
        }
    }, [database, selectedUserId, selectedYear, selectedMonth])

    const selectedUser = useMemo(
        () => users.find((item) => item.uid === selectedUserId) ?? null,
        [users, selectedUserId],
    )

    return (
        <Layout
            header={{
                breadcrumbs: [{ label: 'Reportes', to: '/reports' }, { label: 'Individual' }],
                title: 'Reporte Individual',
            }}
        >
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>
                <div className='px-4 md:px-12 py-10 md:py-10 space-y-10'>
                    <div className="mx-auto max-w-7xl space-y-8">
                        <section className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex-1 flex items-center gap-3 rounded-full bg-white border border-[#e3e5e3] px-4 py-2 shadow-xs">
                                <Search className="w-4 h-4 text-[#7a837a]" />
                                <input
                                    type="text"
                                    className="flex-1 bg-transparent text-sm text-[#191c1c] placeholder:text-[#9aa29a] focus:outline-none"
                                    placeholder="Buscar colaboradores por nombre, correo o departamento..."
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                />
                            </div>
                            <div className="flex items-center gap-3 flex-wrap justify-end">
                                <div className="flex items-center gap-2 rounded-full bg-white border border-[#e3e5e3] px-3 py-1.5 shadow-xs">
                                    <CalendarDays className="w-4 h-4 text-[#7a837a]" />
                                    <select
                                        className="bg-transparent text-xs font-semibold text-[#191c1c] focus:outline-none"
                                        value={selectedYear ?? ""}
                                        onChange={(event) => {
                                            const value = event.target.value
                                            setSelectedYear(value ? Number(value) : null)
                                        }}
                                    >
                                        <option value="" disabled>
                                            {isLoadingYears ? "Cargando años..." : "Selecciona un año"}
                                        </option>
                                        {availableYears.map((year) => (
                                            <option key={year} value={year}>
                                                {year}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 rounded-full bg-white border border-[#e3e5e3] px-3 py-1.5 shadow-xs">
                                    <span className="text-[10px] font-semibold text-[#7a837a]">Mes</span>
                                    <select
                                        className="bg-transparent text-xs font-semibold text-[#191c1c] focus:outline-none"
                                        value={selectedMonth ?? ""}
                                        onChange={(event) => {
                                            const value = event.target.value
                                            setSelectedMonth(value ? Number(value) : null)
                                        }}
                                        disabled={!selectedYear}
                                    >
                                        <option value="">Todos</option>
                                        {MONTH_LABELS.map((label, index) => (
                                            <option key={label} value={index + 1}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </section>

                        <section className="grid gap-6 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,3fr)] items-start">
                            <div className="bg-white rounded-2xl border border-[#edeeed] p-6 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold">
                                            Colaboradores
                                        </p>
                                        <p className="text-xs text-[#5a665a]">
                                            {isTeamScoped
                                                ? "Solo se muestran los colaboradores que tienen tu nombre como jefe inmediato."
                                                : "Lista completa de colaboradores disponibles para reportes."}
                                        </p>
                                    </div>
                                </div>

                                <div className="h-80 overflow-y-auto rounded-xl border border-[#edeeed] bg-[#fafbfa]">
                                    {isLoadingUsers ? (
                                        <div className="h-full flex items-center justify-center text-xs text-[#5a665a]">
                                            Cargando colaboradores...
                                        </div>
                                    ) : usersError ? (
                                        <div className="h-full flex items-center justify-center text-xs text-red-600">
                                            {usersError}
                                        </div>
                                    ) : filteredUsers.length === 0 ? (
                                        <div className="h-full flex items-center justify-center text-xs text-[#5a665a]">
                                            No se encontraron colaboradores para los criterios seleccionados.
                                        </div>
                                    ) : (
                                        <ul className="divide-y divide-[#edeeed]">
                                            {filteredUsers.map((item) => {
                                                const isActive = item.uid === selectedUserId
                                                const department = item.department ?? "Sin departamento"
                                                const roleLabel = item.cargo ?? "Sin cargo"

                                                return (
                                                    <li
                                                        key={item.uid}
                                                        className={`px-4 py-3 cursor-pointer transition-colors ${
                                                            isActive ? "bg-primary/5" : "bg-transparent hover:bg-[#f3f4f3]"
                                                        }`}
                                                        onClick={() => setSelectedUserId(item.uid)}
                                                    >
                                                        <p className="text-xs font-semibold text-[#191c1c]">{item.name}</p>
                                                        <p className="text-[11px] text-[#5a665a]">{item.email}</p>
                                                        <p className="mt-1 text-[10px] text-[#7a837a]">
                                                            {department} · {roleLabel}
                                                        </p>
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="bg-white rounded-2xl border border-[#edeeed] p-6 shadow-sm flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                    <div className="space-y-1">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold">
                                            Perfil
                                        </p>
                                        <h2 className="text-2xl font-bold text-[#191c1c]">
                                            {selectedUser ? selectedUser.name : "Selecciona un colaborador"}
                                        </h2>
                                        {selectedUser && (
                                            <>
                                                <p className="text-xs text-[#5a665a]">{selectedUser.cargo ?? "Sin cargo definido"}</p>
                                                <p className="text-[11px] text-[#7a837a]">
                                                    {selectedUser.department ?? "Sin departamento"}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                    {selectedUser && (
                                        <div className="text-right space-y-1">
                                            <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold">
                                                Jefe inmediato
                                            </p>
                                            <p className="text-xs font-semibold text-[#191c1c]">
                                                {selectedUser.immediateBoss ?? "Sin definir"}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <div className="grid gap-4 md:grid-cols-3">
                                    <div className="bg-[#0c3323] text-white rounded-2xl p-5 flex flex-col justify-between">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-200 font-bold mb-1">
                                                Total horas
                                            </p>
                                            <p className="text-3xl font-extrabold">
                                                {isLoadingMetrics || !selectedYear ? "--" : metrics.totalHours.toFixed(1)}
                                            </p>
                                        </div>
                                        <p className="mt-2 text-[11px] text-emerald-100">
                                            Horas acumuladas del periodo seleccionado.
                                        </p>
                                    </div>
                                    <div className="bg-white rounded-2xl border border-[#edeeed] p-5">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold mb-1">
                                            Actividades registradas
                                        </p>
                                        <p className="text-3xl font-extrabold text-[#191c1c]">
                                            {isLoadingMetrics || !selectedYear ? "--" : metrics.coursesDone}
                                        </p>
                                        <p className="mt-2 text-[11px] text-[#7a837a]">
                                            Actividades cerradas o completadas en el periodo.
                                        </p>
                                    </div>
                                    <div className="bg-white rounded-2xl border border-[#edeeed] p-5">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold mb-1">
                                            Estado general
                                        </p>
                                        <p className="text-sm font-semibold text-[#191c1c]">
                                            {!selectedYear
                                                ? "Selecciona un año para ver el estado."
                                                : metrics.coursesDone > 0
                                                    ? "Con participación activa en el periodo."
                                                    : "Sin registros de actividades en el periodo."}
                                        </p>
                                        <p className="mt-2 text-[11px] text-[#7a837a]">
                                            Resumen cualitativo basado en la participación.
                                        </p>
                                    </div>
                                </div>

                                <section className="bg-white rounded-2xl border border-[#edeeed] p-6 shadow-sm">
                                    <div className="flex items-center justify-between mb-3">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.18em] text-outline font-bold">
                                                Historial de Actividades
                                            </p>
                                            <p className="text-xs text-[#5a665a]">
                                                Actividades del periodo seleccionado en las que el colaborador fue participante.
                                            </p>
                                        </div>
                                    </div>

                                    {isLoadingMetrics ? (
                                        <p className="text-xs text-[#5a665a]">Calculando métricas individuales...</p>
                                    ) : !selectedYear ? (
                                        <p className="text-xs text-[#5a665a]">Selecciona un año para ver el historial.</p>
                                    ) : metrics.trainings.length === 0 ? (
                                        <p className="text-xs text-[#5a665a]">
                                            No se encontraron reuniones para este colaborador en el año seleccionado.
                                        </p>
                                    ) : (
                                        <div className="mt-3 space-y-2">
                                            {metrics.trainings.map(({ meeting, hours }) => {
                                                const dateLabel = new Date(meeting.startTime).toLocaleDateString("es-ES", {
                                                    day: "2-digit",
                                                    month: "short",
                                                    year: "numeric",
                                                })

                                                return (
                                                    <div
                                                        key={meeting.id}
                                                        className="flex items-center justify-between rounded-xl bg-[#fafbfa] border border-[#edeeed] px-4 py-3 text-xs"
                                                    >
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-[#191c1c] truncate">{meeting.title}</p>
                                                            <p className="text-[11px] text-[#7a837a] truncate">{meeting.location}</p>
                                                        </div>
                                                        <div className="w-32 text-right">
                                                            <p className="font-semibold text-[#191c1c]">{dateLabel}</p>
                                                            <p className="text-[11px] text-[#7a837a]">{hours.toFixed(1)} hrs</p>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </section>
                            </div>
                        </section>
                    </div>
                </div>

            </div>
        </Layout>
    )
}

export default ReportIndividualPage