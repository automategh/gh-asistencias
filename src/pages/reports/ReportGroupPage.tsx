import Layout from "@/components/layouts/layout"
import { useAuth } from "@/context/AuthContext"
import { useDatabase } from "@/context/DatabaseContext"
import { getMeetingYearsForDatabase } from "@/services/meetings.analytics.service"
import { getUsersForReports, type ReportUserItem } from "@/services/user.service"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
import { CalendarDays, ChevronRight, LucideBarChart, Search, Users as UsersIcon, Clock, X } from "lucide-react"
import { get, ref } from "firebase/database"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

const MONTH_LABELS: readonly string[] = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

interface ActivityGroupStats {
    readonly meeting: Meeting
    readonly totalHours: number
    readonly attendeesCount: number
}

interface GroupAggregate {
    readonly totalHours: number
    readonly totalMeetings: number
    readonly peopleCount: number
}

interface ActivityDetailAttendee {
    readonly participant: MeetingParticipant
    readonly user: ReportUserItem | null
}

function ReportGroupPage() {
    const navigate = useNavigate()
    const { user, hasPermission } = useAuth()
    const { database } = useDatabase()
    const canViewTeamReports = hasPermission("reports_view_team")
    const canViewAllReports = hasPermission("reports_view_all")
    const isTeamScoped = canViewTeamReports && !canViewAllReports

    const [allUsers, setAllUsers] = useState<ReportUserItem[]>([])
    const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(false)
    const [usersError, setUsersError] = useState<string | null>(null)

    const [availableYears, setAvailableYears] = useState<number[]>([])
    const [selectedYear, setSelectedYear] = useState<number | null>(null)
    const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
    const [isLoadingYears, setIsLoadingYears] = useState<boolean>(false)

    const [search, setSearch] = useState<string>("")

    const [isLoadingStats, setIsLoadingStats] = useState<boolean>(false)
    const [stats, setStats] = useState<ActivityGroupStats[]>([])
    const [aggregate, setAggregate] = useState<GroupAggregate>({
        totalHours: 0,
        totalMeetings: 0,
        peopleCount: 0,
    })

    const [selectedActivity, setSelectedActivity] = useState<Meeting | null>(null)
    const [activityAttendees, setActivityAttendees] = useState<ActivityDetailAttendee[]>([])
    const [isLoadingActivityDetail, setIsLoadingActivityDetail] = useState<boolean>(false)
    const [activityDetailError, setActivityDetailError] = useState<string | null>(null)

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

                const leaderName = isTeamScoped ? user.displayName ?? null : null
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

                const allowedUids = new Set(allUsers.map((item) => item.uid))
                const attendeesUniverse = new Set<string>()
                const activityStats: ActivityGroupStats[] = []

                const meetingsSnapshot = await get(ref(database, "meetings"))
                if (!meetingsSnapshot.exists()) {
                    if (!cancelled) {
                        setStats([])
                        setAggregate({
                            totalHours: 0,
                            totalMeetings: 0,
                            peopleCount: 0,
                        })
                    }
                    return
                }

                const meetingsValue = meetingsSnapshot.val() as Record<string, Meeting> | null
                if (!meetingsValue) {
                    if (!cancelled) {
                        setStats([])
                        setAggregate({
                            totalHours: 0,
                            totalMeetings: 0,
                            peopleCount: 0,
                        })
                    }
                    return
                }

                const candidateMeetings = Object.values(meetingsValue).filter((meeting) => {
                    const date = new Date(meeting.startTime)
                    const year = date.getFullYear()
                    const month = date.getMonth() + 1
                    const isStatusValid =
                        meeting.status === "completed"
                        || meeting.status === "closed"
                        || meeting.status === "scheduled"
                    if (year !== selectedYear || !isStatusValid) {
                        return false
                    }
                    if (selectedMonth && month !== selectedMonth) {
                        return false
                    }
                    return true
                })

                let totalHours = 0
                let totalMeetings = 0

                for (const meeting of candidateMeetings) {
                    if (cancelled) {
                        return
                    }

                    const participantsSnapshot = await get(ref(database, `meetingParticipants/${meeting.id}`))
                    if (!participantsSnapshot.exists()) {
                        continue
                    }

                    const participantsValue = participantsSnapshot.val() as Record<string, MeetingParticipant> | null
                    const attendeesForMeeting: MeetingParticipant[] = []

                    if (participantsValue) {
                        for (const participant of Object.values(participantsValue)) {
                        const isAllowed = allowedUids.has(participant.uid)
                        const attendance = participant.attendance ?? null
                        const isPresentOrLate = attendance === "present" || attendance === "late"
                        const isNoShow = Boolean(participant.noShow)

                        if (!isAllowed || !isPresentOrLate || isNoShow) {
                            continue
                        }

                        attendeesForMeeting.push(participant)
                        attendeesUniverse.add(participant.uid)
                        }
                    }

                    const durationMs = Math.max(0, meeting.endTime - meeting.startTime)
                    const hours = durationMs / (1000 * 60 * 60)

                    activityStats.push({
                        meeting,
                        totalHours: hours,
                        attendeesCount: attendeesForMeeting.length,
                    })

                    totalHours += hours
                    totalMeetings += 1
                }

                activityStats.sort((first, second) => {
                    if (second.totalHours !== first.totalHours) {
                        return second.totalHours - first.totalHours
                    }
                    if (second.attendeesCount !== first.attendeesCount) {
                        return second.attendeesCount - first.attendeesCount
                    }
                    return second.meeting.startTime - first.meeting.startTime
                })

                if (cancelled) {
                    return
                }

                setStats(activityStats)
                setAggregate({
                    totalHours,
                    totalMeetings,
                    peopleCount: attendeesUniverse.size,
                })
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
    }, [allUsers, database, selectedYear, selectedMonth])

    const filteredStats = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) {
            return stats
        }

        return stats.filter((item) => {
            const title = item.meeting.title.toLowerCase()
            const location = item.meeting.location.toLowerCase()
            const typeLabel = item.meeting.type.toLowerCase()
            const creatorName = (item.meeting.createdByName ?? "").toLowerCase()
            const customType = (item.meeting.customType ?? "").toLowerCase()
            return (
                title.includes(term)
                || location.includes(term)
                || typeLabel.includes(term)
                || creatorName.includes(term)
                || customType.includes(term)
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

    /**
     * Abre el detalle de asistentes para una actividad específica,
     * mostrando únicamente quienes marcaron asistencia real (present o late, sin noShow).
     */
    const handleOpenActivityDetail = async (meeting: Meeting): Promise<void> => {
        if (!database) {
            return
        }

        setSelectedActivity(meeting)
        setActivityAttendees([])
        setActivityDetailError(null)
        setIsLoadingActivityDetail(true)

        try {
            const allowedUids = new Set(allUsers.map((item) => item.uid))

            const participantsSnapshot = await get(ref(database, `meetingParticipants/${meeting.id}`))
            if (!participantsSnapshot.exists()) {
                setActivityAttendees([])
                return
            }

            const participantsValue = participantsSnapshot.val() as Record<string, MeetingParticipant> | null
            if (!participantsValue) {
                setActivityAttendees([])
                return
            }

            const attendees: ActivityDetailAttendee[] = []

            for (const participant of Object.values(participantsValue)) {
                const isAllowed = allowedUids.has(participant.uid)
                const attendance = participant.attendance ?? null
                const isPresentOrLate = attendance === "present" || attendance === "late"
                const isNoShow = Boolean(participant.noShow)

                if (!isAllowed || !isPresentOrLate || isNoShow) {
                    continue
                }

                const userMeta = allUsers.find((item) => item.uid === participant.uid) ?? null

                attendees.push({
                    participant,
                    user: userMeta,
                })
            }

            attendees.sort((first, second) => first.participant.name.localeCompare(second.participant.name, "es"))
            setActivityAttendees(attendees)
        } catch (error) {
            console.error("No fue posible cargar los asistentes de la actividad:", error)
            setActivityDetailError("No fue posible cargar los asistentes que marcaron asistencia en esta actividad.")
        } finally {
            setIsLoadingActivityDetail(false)
        }
    }

    /**
     * Cierra el panel de detalle de asistentes de la actividad.
     */
    const handleCloseActivityDetail = (): void => {
        setSelectedActivity(null)
        setActivityAttendees([])
        setActivityDetailError(null)
    }

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
                                    placeholder="Buscar actividades por título, lugar, tipo o responsable..."
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    disabled={isLoadingUsers}
                                />
                            </div>
                            <div className="flex items-center gap-3 flex-wrap justify-end">
                                <div className="flex items-center gap-2 rounded-full bg-white border border-[#e3e5e3] px-3 py-1.5 shadow-xs">
                                    <CalendarDays className="w-4 h-4 text-[#7a837a]" />
                                    <select
                                        className="bg-transparent text-xs font-semibold text-[#191c1c] focus:outline-none disabled:text-[#b3bab3]"
                                        value={selectedYear ?? ""}
                                        onChange={(event) => {
                                            const value = event.target.value
                                            setSelectedYear(value ? Number(value) : null)
                                            setSelectedMonth(null)
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
                                <div className="flex items-center gap-2 rounded-full bg-white border border-[#e3e5e3] px-3 py-1.5 shadow-xs">
                                    <span className="text-[10px] font-semibold text-[#7a837a]">Mes</span>
                                    <select
                                        className="bg-transparent text-xs font-semibold text-[#191c1c] focus:outline-none disabled:text-[#b3bab3]"
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
                                    Número total de actividades programadas, cerradas o completadas en el año seleccionado.
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
                                        Actividades del año
                                    </p>
                                    <p className="text-xs text-[#5a665a]">
                                        Listado de actividades programadas, cerradas o completadas durante el año seleccionado.
                                    </p>
                                </div>
                            </div>

                                    {isLoadingStats ? (
                                <p className="text-xs text-[#5a665a]">Calculando métricas Generales...</p>
                            ) : !selectedYear ? (
                                <p className="text-xs text-[#5a665a]">Selecciona un año para ver el detalle General.</p>
                            ) : filteredStats.length === 0 ? (
                                <p className="text-xs text-[#5a665a]">
                                            No se encontraron actividades con asistencia registrada para el año indicado.
                                </p>
                            ) : (
                                <div className="mt-3 space-y-2 max-h-130 overflow-y-auto pr-1">
                                            {filteredStats.map((item) => {
                                                const avatarLabel = item.meeting.type === "training" ? "C" : item.meeting.type === "meeting" ? "R" : "A"
                                                const dateLabel = new Date(item.meeting.startTime).toLocaleDateString("es-ES", {
                                                    day: "2-digit",
                                                    month: "short",
                                                    year: "numeric",
                                                })
                                                const timeLabel = new Date(item.meeting.startTime).toLocaleTimeString("es-ES", {
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                })
                                                const typeLabel =
                                                    item.meeting.type === "training"
                                                        ? "Capacitación"
                                                    : item.meeting.type === "meeting"
                                                            ? "Reunión"
                                                            : item.meeting.customType ?? "Actividad"

                                                return (
                                                    <article
                                                        key={item.meeting.id}
                                                        className="flex items-center justify-between rounded-2xl border border-[#edeeed] bg-[#fafbfa] px-4 py-3 text-xs cursor-pointer hover:bg-[#f3f4f3]"
                                                        onClick={() => {
                                                            void handleOpenActivityDetail(item.meeting)
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                                            <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center text-[11px] font-semibold">
                                                                {avatarLabel}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-semibold text-[#191c1c] truncate">{item.meeting.title}</p>
                                                                <p className="text-[11px] text-[#7a837a] truncate">{item.meeting.location}</p>
                                                                <p className="mt-0.5 text-[10px] text-[#7a837a] truncate">
                                                                    {typeLabel} · {dateLabel} · {timeLabel}
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
                                                                <p className="text-[11px] text-[#7a837a]">Asistentes</p>
                                                                <p className="text-sm font-semibold text-[#191c1c]">
                                                                    {item.attendeesCount}
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
                    {selectedActivity && (
                        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-xs">
                            <div className="bg-white rounded-2xl shadow-[0_24px_40px_rgba(15,23,42,0.25)] w-full max-w-xl mx-4">
                                <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-[#edeeed]">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-widest text-outline font-bold mb-1">
                                            Asistentes de la actividad
                                        </p>
                                        <h2 className="text-lg font-bold text-[#191c1c] leading-snug">
                                            {selectedActivity.title}
                                        </h2>
                                        {selectedYear && (
                                            <p className="text-[11px] text-slate-500 mt-1">Año {selectedYear}</p>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCloseActivityDetail}
                                        className="p-1.5 rounded-full hover:bg-[#edeeed] text-outline hover:text-[#191c1c] transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="px-6 pt-4 pb-5 max-h-80 overflow-y-auto">
                                    {isLoadingActivityDetail ? (
                                        <p className="text-xs text-[#5a665a]">Cargando asistentes con marcación de asistencia...</p>
                                    ) : activityDetailError ? (
                                        <p className="text-xs text-red-600">{activityDetailError}</p>
                                    ) : activityAttendees.length === 0 ? (
                                        <p className="text-xs text-[#5a665a]">
                                            No se encontraron asistentes que hayan marcado asistencia real en esta actividad.
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {activityAttendees.map((item) => {
                                                const displayName = item.user?.name ?? item.participant.name
                                                const displayEmail = item.user?.email ?? item.participant.email
                                                const departmentLabel = item.user?.department ?? "Sin departamento"
                                                const cargoLabel = item.user?.cargo ?? "Sin cargo"
                                                const initials = displayName
                                                    .split(" ")
                                                    .filter((part) => part.length > 0)
                                                    .slice(0, 2)
                                                    .map((part) => part[0]?.toUpperCase() ?? "")
                                                    .join("")
                                                const attendanceLabel = item.participant.attendance === "late" ? "Tarde" : "Presente"

                                                return (
                                                    <div
                                                        key={item.participant.uid}
                                                        className="flex items-center justify-between rounded-xl bg-[#fafbfa] border border-[#edeeed] px-4 py-3 text-xs"
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                                            <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center text-[11px] font-semibold">
                                                                {initials || "?"}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-semibold text-[#191c1c] truncate">{displayName}</p>
                                                                <p className="text-[11px] text-[#7a837a] truncate">{displayEmail}</p>
                                                                <p className="mt-0.5 text-[10px] text-[#7a837a] truncate">
                                                                    {departmentLabel} · {cargoLabel}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="w-28 text-right">
                                                            <p className="text-[11px] text-[#7a837a]">{attendanceLabel}</p>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
        </Layout>
    )
}

export default ReportGroupPage
