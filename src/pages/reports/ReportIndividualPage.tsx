import Layout from "@/components/layouts/layout"
import { useAuth } from "@/context/AuthContext"
import { useDatabase } from "@/context/DatabaseContext"
import { getMeetingYearsForDatabase } from "@/services/meetings.analytics.service"
import { getUserInvitedMeetings } from "@/services/meetings.listing.service"
import { getUsersForReports, type ReportUserItem } from "@/services/user.service"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
import { CalendarDays, Download, Search } from "lucide-react"
import { get, ref } from "firebase/database"
import { useEffect, useMemo, useRef, useState } from "react"
import ExcelJS from "exceljs"
import {
    createLandscapePdf, loadLogoDataUrl,
    drawHeader, drawFooter, drawSectionTitle,
    drawKpiGrid, drawParagraph, drawTableHeader, drawTableRow, drawTableEnd, drawBarRow,
    type KpiItem, type TableColumn,
} from "@/services/pdf/pdfHelpers"
import {
    EXCEL_TITLE_STYLE, EXCEL_SUBTITLE_STYLE, EXCEL_SECTION_STYLE, EXCEL_HEADER_STYLE,
    applyRowStyle, downloadWorkbook,
} from "@/services/excel/excelHelpers"

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
        invitedCount: number
        trainings: Array<{ meeting: Meeting; hours: number }>
    }>({ totalHours: 0, coursesDone: 0, invitedCount: 0, trainings: [] })

    const [showExportMenu, setShowExportMenu] = useState<boolean>(false)
    const exportRef = useRef<HTMLDivElement>(null)

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
            setMetrics({ totalHours: 0, coursesDone: 0, invitedCount: 0, trainings: [] })
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
                let invitedCount = 0

                for (const meeting of meetingsInPeriod) {
                    try {
                        const participantSnap = await get(ref(database, `meetingParticipants/${meeting.id}/${selectedUserId}`))
                        if (!participantSnap.exists()) {
                            continue
                        }

                        invitedCount += 1

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
                    invitedCount,
                    trainings: attendedTrainings,
                })
            } catch (error) {
                console.error("No fue posible calcular las métricas individuales de actividades:", error)
                if (!cancelled) {
                    setMetrics({ totalHours: 0, coursesDone: 0, invitedCount: 0, trainings: [] })
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

    /**
     * Cierra el menú de export al hacer click fuera.
     */
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
                setShowExportMenu(false)
            }
        }
        if (showExportMenu) {
            document.addEventListener("mousedown", handleClickOutside)
            return () => document.removeEventListener("mousedown", handleClickOutside)
        }
        return
    }, [showExportMenu])

    /**
     * Calcula el período y labels para los reportes.
     */
    const getPeriodLabel = (): string => {
        if (selectedYear === null) return "Sin período"
        if (typeof selectedMonth === "number") {
            return `${selectedYear} - ${MONTH_LABELS[selectedMonth - 1]}`
        }
        return String(selectedYear)
    }

    /**
     * Exporta el reporte individual a PDF horizontal nativo con logo, portada + KPIs y gráficos.
     */
    const handleExportPDF = async () => {
        if (!database || !selectedUser) return
        setShowExportMenu(false)
        try {
            const logoDataUrl = await loadLogoDataUrl()
            const state = createLandscapePdf()
            const periodLabel = getPeriodLabel()
            const fileBaseName = `reporte-individual-${selectedUser.name.toLowerCase().replace(/\s+/g, "-")}-${selectedYear ?? "sin-anho"}${typeof selectedMonth === "number" ? "-" + MONTH_LABELS[selectedMonth - 1].toLowerCase().replace(/\s+/g, "-") : ""}`

            const redrawHeader = (): void => {
                drawHeader(state, {
                    title: `Reporte Individual: ${selectedUser.name}`,
                    subtitle: `Período: ${periodLabel}`,
                    logoDataUrl,
                })
            }

            // PÁGINA 1: Portada + KPIs + perfil
            redrawHeader()
            state.y = state.margin + 16

            const kpis: KpiItem[] = [
                { label: "Total Horas", value: metrics.totalHours.toFixed(2), sub: "Horas acumuladas del periodo" },
                { label: "Asistencia", value: `${metrics.coursesDone} / ${metrics.invitedCount}`, sub: "Asistidas vs. citadas" },
                { label: "Cargo", value: selectedUser.cargo ?? "Sin cargo", sub: selectedUser.department ?? "Sin departamento" },
            ]
            drawKpiGrid(state, kpis, redrawHeader, { cols: 3 })

            drawSectionTitle(state, "Resumen Ejecutivo", redrawHeader)
            const attendancePct = metrics.invitedCount > 0
                ? `${((metrics.coursesDone / metrics.invitedCount) * 100).toFixed(1)}%`
                : "N/A"
            const introText = `Este reporte muestra el detalle de las actividades en las que ${selectedUser.name} fue citado durante ${periodLabel.toLowerCase()}. Asistencia: ${metrics.coursesDone} de ${metrics.invitedCount} actividades citadas (${attendancePct}). Total de horas acumuladas: ${metrics.totalHours.toFixed(2)}.`
            drawParagraph(state, introText, redrawHeader)

            // PÁGINA 2: Listado de actividades
            drawFooter(state)
            state.pdf.addPage("a4", "landscape")
            state.nextPage()
            redrawHeader()
            state.y = state.margin + 16

            drawSectionTitle(state, "Historial de Actividades", redrawHeader)
            const listCols: TableColumn[] = [
                { label: "Título", width: 110, align: "left" },
                { label: "Tipo", width: 35, align: "left" },
                { label: "Fecha", width: 30, align: "left" },
                { label: "Lugar", width: 50, align: "left" },
                { label: "Horas", width: 25, align: "right" },
            ]
            const listWidths = listCols.map((column) => column.width)
            const listTotalW = listWidths.reduce((sum, width) => sum + width, 0)
            if (listTotalW < state.contentW) {
                listWidths[listWidths.length - 1] += state.contentW - listTotalW
            }
            const listTableCols = listCols.map((column, index) => ({ ...column, width: listWidths[index] }))
            drawTableHeader(state, listTableCols, redrawHeader)
            metrics.trainings.forEach(({ meeting, hours }, i) => {
                const typeLabel = meeting.type === "training"
                    ? "Capacitación"
                    : meeting.type === "meeting"
                        ? "Reunión"
                        : meeting.customType ?? "Actividad"
                const dateStr = new Date(meeting.startTime).toLocaleDateString("es-ES", {
                    day: "2-digit", month: "short", year: "numeric",
                })
                drawTableRow(state, [
                    { text: meeting.title, align: "left" },
                    { text: typeLabel, align: "left" },
                    { text: dateStr, align: "left" },
                    { text: meeting.location, align: "left" },
                    { text: hours.toFixed(2), align: "right" },
                ], listTableCols.map((column) => ({ width: column.width })), i % 2 === 1)
            })
            drawTableEnd(state)

            // PÁGINA 3: Gráfico de horas por mes (si hay datos)
            if (metrics.trainings.length > 0) {
                drawFooter(state)
                state.pdf.addPage("a4", "landscape")
                state.nextPage()
                redrawHeader()
                state.y = state.margin + 16

                drawSectionTitle(state, "Horas por Mes", redrawHeader)
                const byMonth = new Map<number, number>()
                for (const { meeting, hours } of metrics.trainings) {
                    const month = new Date(meeting.startTime).getMonth() + 1
                    byMonth.set(month, (byMonth.get(month) ?? 0) + hours)
                }
                const monthData = Array.from(byMonth.entries()).sort((a, b) => a[0] - b[0])
                const maxHours = Math.max(...monthData.map(([, v]) => v), 1)
                monthData.forEach(([monthIdx, hours], i) => {
                    drawBarRow(state, {
                        label: MONTH_LABELS[monthIdx - 1] ?? `Mes ${monthIdx}`,
                        valueLabel: `${hours.toFixed(2)} h`,
                        labelW: 70,
                        valueW: 35,
                        barMaxW: 120,
                        value: hours,
                        maxValue: maxHours,
                        isZebra: i % 2 === 1,
                    }, redrawHeader)
                })
                drawTableEnd(state)
            }

            drawFooter(state)
            state.pdf.save(`${fileBaseName}.pdf`)
        } catch (error) {
            console.error("Error al exportar PDF:", error)
        }
    }

    /**
     * Exporta el reporte individual a Excel.
     */
    const handleExportExcel = async () => {
        if (!database || !selectedUser) return
        setShowExportMenu(false)
        try {
            const wb = new ExcelJS.Workbook()
            wb.creator = "Reporte Individual"
            wb.created = new Date()
            const periodLabel = getPeriodLabel()
            const fileBaseName = `reporte-individual-${selectedUser.name.toLowerCase().replace(/\s+/g, "-")}-${selectedYear ?? "sin-anho"}${typeof selectedMonth === "number" ? "-" + MONTH_LABELS[selectedMonth - 1].toLowerCase().replace(/\s+/g, "-") : ""}`

            // HOJA 1: Perfil + KPIs
            const wsSummary = wb.addWorksheet("Resumen")
            wsSummary.columns = [{ width: 30 }, { width: 30 }, { width: 30 }]
            const titleRow = wsSummary.addRow([`Reporte Individual: ${selectedUser.name}`])
            wsSummary.mergeCells("A1:C1")
            titleRow.getCell(1).style = EXCEL_TITLE_STYLE
            titleRow.height = 28
            const subtitleRow = wsSummary.addRow([`Período: ${periodLabel}`])
            wsSummary.mergeCells("A2:C2")
            subtitleRow.getCell(1).style = EXCEL_SUBTITLE_STYLE
            wsSummary.addRow([])
            const profileSection = wsSummary.addRow(["Perfil"])
            wsSummary.mergeCells(`A${profileSection.number}:C${profileSection.number}`)
            profileSection.getCell(1).style = EXCEL_SECTION_STYLE
            profileSection.height = 22
            const profileHeader = wsSummary.addRow(["Campo", "Valor", ""])
            profileHeader.eachCell((cell) => { cell.style = EXCEL_HEADER_STYLE })
            profileHeader.height = 22
            const profileData: (string | number)[][] = [
                ["Nombre", selectedUser.name, ""],
                ["Email", selectedUser.email, ""],
                ["Cargo", selectedUser.cargo ?? "Sin cargo", ""],
                ["Departamento", selectedUser.department ?? "Sin departamento", ""],
                ["Jefe inmediato", selectedUser.immediateBoss ?? "Sin definir", ""],
            ]
            profileData.forEach((row, i) => {
                const r = wsSummary.addRow(row)
                applyRowStyle({ row: r, values: row, isZebra: i % 2 === 1 })
            })
            wsSummary.addRow([])

            const kpiSection = wsSummary.addRow(["Indicadores Clave"])
            wsSummary.mergeCells(`A${kpiSection.number}:C${kpiSection.number}`)
            kpiSection.getCell(1).style = EXCEL_SECTION_STYLE
            kpiSection.height = 22
            const kpiHeader = wsSummary.addRow(["Indicador", "Valor", "Descripción"])
            kpiHeader.eachCell((cell) => { cell.style = EXCEL_HEADER_STYLE })
            kpiHeader.height = 22
            const kpiData: (string | number)[][] = [
                ["Total Horas", metrics.totalHours.toFixed(2), "Horas acumuladas del periodo"],
                ["Asistencia", `${metrics.coursesDone} / ${metrics.invitedCount}`, "Asistidas vs. citadas"],
                ["% Asistencia", metrics.invitedCount > 0 ? `${((metrics.coursesDone / metrics.invitedCount) * 100).toFixed(1)}%` : "N/A", "Porcentaje de asistencia"],
            ]
            kpiData.forEach((row, i) => {
                const r = wsSummary.addRow(row)
                applyRowStyle({ row: r, values: row, isZebra: i % 2 === 1 })
            })

            // HOJA 2: Historial
            const wsList = wb.addWorksheet("Actividades")
            wsList.columns = [
                { width: 50 }, { width: 18 }, { width: 14 }, { width: 30 }, { width: 12 },
            ]
            const listHeaderRow = wsList.addRow([
                "Título", "Tipo", "Fecha", "Lugar", "Horas",
            ])
            listHeaderRow.eachCell((cell) => { cell.style = EXCEL_HEADER_STYLE })
            listHeaderRow.height = 22
            metrics.trainings.forEach(({ meeting, hours }, i) => {
                const typeLabel = meeting.type === "training"
                    ? "Capacitación"
                    : meeting.type === "meeting"
                        ? "Reunión"
                        : meeting.customType ?? "Actividad"
                const dateStr = new Date(meeting.startTime).toLocaleDateString("es-ES", {
                    day: "2-digit", month: "short", year: "numeric",
                })
                const values: (string | number)[] = [
                    meeting.title, typeLabel, dateStr, meeting.location, Number(hours.toFixed(2)),
                ]
                const r = wsList.addRow(values)
                applyRowStyle({
                    row: r, values,
                    isZebra: i % 2 === 1,
                    alignRightCols: [4],
                    wrapCols: [0, 3],
                })
            })

            await downloadWorkbook(wb, fileBaseName)
        } catch (error) {
            console.error("Error al exportar Excel:", error)
        }
    }

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
                                <div className="relative" ref={exportRef}>
                                    <button
                                        type="button"
                                        className="flex items-center gap-x-3 px-3 py-1.5 bg-white border border-[#e3e5e3] rounded-full text-xs font-semibold text-[#191c1c] hover:bg-[#fafbfa] disabled:text-[#b3bab3]"
                                        onClick={() => setShowExportMenu((v) => !v)}
                                        disabled={!selectedUser || metrics.trainings.length === 0}
                                    >
                                        <Download className="w-4 h-4 text-[#7a837a]" />
                                        <span>Exportar</span>
                                    </button>
                                    {showExportMenu && (
                                        <div className="absolute right-0 top-full mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                                            <button
                                                type="button"
                                                className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 rounded-t-lg"
                                                onClick={handleExportPDF}
                                            >
                                                Exportar a PDF
                                            </button>
                                            <button
                                                type="button"
                                                className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 rounded-b-lg"
                                                onClick={handleExportExcel}
                                            >
                                                Exportar a Excel
                                            </button>
                                        </div>
                                    )}
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
                                            Asistencia
                                        </p>
                                        <p className="text-3xl font-extrabold text-[#191c1c]">
                                            {isLoadingMetrics || !selectedYear
                                                ? "--"
                                                : `${metrics.coursesDone} / ${metrics.invitedCount}`}
                                        </p>
                                        <p className="mt-2 text-[11px] text-[#7a837a]">
                                            Actividades asistidas vs. citadas en el periodo.
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