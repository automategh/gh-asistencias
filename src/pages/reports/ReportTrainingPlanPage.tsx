import Layout from "@/components/layouts/layout"
import { ChevronDown, Clock, Download, Eye, IterationCw, LucideBarChart, Search, Smile, TrendingUp, Users, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import jsPDF from "jspdf"
import html2canvas from "html2canvas-pro"
import * as XLSX from "xlsx"
import { getUserProfile, loadUsersCargoMap, resolveCrossDbUserCargoByEmail, type UserCargoCache, type UserEmailCargoCache } from "@/services/user.service"
import { useDatabase } from "@/context/DatabaseContext"
import { useAuth } from "@/context/AuthContext"
import { getDepartmentNames } from "@/services/departaments/departments.service"
import {
    getTrainingCountsByDepartmentForYear,
    getTrainingKpiForYear,
    getTrainingYearsForDatabase,
    getTrainingHoursByRoleForYear,
    type DepartmentTrainingCount,
    type TrainingHoursByRole,
    type TrainingKpiSummary,
} from "@/services/meetings.analytics.service"
import { getTrainingsWithParticipants, type TrainingWithParticipants } from "@/services/meetings.training.listing"
import { getSurveys, getSurveyQuestionsBySurveyId, getSurveyResponsesForTraining, type Survey, type SurveyQuestion } from "@/services/forms.service"
import type { Database } from "firebase/database"

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

function getTrainingHours(startTime: number, endTime: number): number {
    const durationMs = Math.max(0, endTime - startTime)
    return durationMs / (1000 * 60 * 60)
}

function formatHours(hours: number): string {
    return hours.toFixed(2)
}

async function computeAverageSatisfaction(
    database: Database,
    trainings: TrainingWithParticipants[],
): Promise<number | null> {
    if (trainings.length === 0) {
        return null
    }

    const surveys = await getSurveys(database)

    const satisfactionSurveys: Survey[] = surveys.filter((survey) => {
        if (survey.category !== "training") {
            return false
        }
        if (!survey.isActive) {
            return false
        }
        return Boolean(survey.predetermined)
    })

    if (satisfactionSurveys.length === 0) {
        return null
    }

    const ratingQuestionsBySurveyId: Record<string, string[]> = {}

    for (const survey of satisfactionSurveys) {
        const questions = await getSurveyQuestionsBySurveyId(database, survey.id)
        const ratingIds = questions
            .filter((question: SurveyQuestion) => question.type === "rating")
            .map((question) => question.id)

        if (ratingIds.length > 0) {
            ratingQuestionsBySurveyId[survey.id] = ratingIds
        }
    }

    if (Object.keys(ratingQuestionsBySurveyId).length === 0) {
        return null
    }

    let totalResponseScore = 0
    let totalResponses = 0

    for (const item of trainings) {
        const trainingId = item.meeting.id
        if (!trainingId) {
            continue
        }

        const relevantParticipantIds = new Set(item.participants.map((participant) => participant.uid))

        for (const survey of satisfactionSurveys) {
            const ratingIds = ratingQuestionsBySurveyId[survey.id]
            if (!ratingIds || ratingIds.length === 0) {
                continue
            }

            const responses = await getSurveyResponsesForTraining(database, {
                surveyId: survey.id,
                trainingId,
            })

            if (responses.length === 0) {
                continue
            }

            for (const response of responses) {
                if (!relevantParticipantIds.has(response.userId)) {
                    continue
                }

                const answers = response.answers
                let sum = 0
                let count = 0

                for (const questionId of ratingIds) {
                    const value = answers[questionId]
                    if (typeof value === "number") {
                        sum += value
                        count += 1
                    }
                }

                if (count === 0) {
                    continue
                }

                const score = sum / count
                totalResponseScore += score
                totalResponses += 1
            }
        }
    }

    if (totalResponses === 0) {
        return null
    }

    return totalResponseScore / totalResponses
}

/**
 * Página de reporte para el plan de formación.
 * Permite filtrar por periodo anual y por área/departamento,
 * utilizando los departamentos configurados en la base de datos actual.
 */
function ReportTrainingPlanPage() {
    const { database } = useDatabase()
    const { user, hasPermission } = useAuth()
    const [departments, setDepartments] = useState<string[]>([])
    const [years, setYears] = useState<number[]>([])
    const [selectedYear, setSelectedYear] = useState<number | null>(null)
    const [periodMode, setPeriodMode] = useState<"year" | "month">("year")
    const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
    const [selectedDepartment, setSelectedDepartment] = useState<string>("")

    const [totalTrainings, setTotalTrainings] = useState<number>(0)
    const [totalHours, setTotalHours] = useState<number>(0)
    const [totalAttended, setTotalAttended] = useState<number>(0)
    const [showExportMenu, setShowExportMenu] = useState(false)
    const exportRef = useRef<HTMLDivElement>(null)
    const [departmentTrainingCounts, setDepartmentTrainingCounts] = useState<DepartmentTrainingCount[]>([])
    const [hoursByRole, setHoursByRole] = useState<TrainingHoursByRole[]>([])
    const [selectedAreaForChart, setSelectedAreaForChart] = useState<string | null>(null)
    const [trainingsDeltaPct, setTrainingsDeltaPct] = useState<number | null>(null)
    const [hoursDeltaPct, setHoursDeltaPct] = useState<number | null>(null)
    const [attendedDeltaPct, setAttendedDeltaPct] = useState<number | null>(null)
    const [isGenerating, setIsGenerating] = useState<boolean>(false)
    const [trainings, setTrainings] = useState<TrainingWithParticipants[]>([])
    const [leaderUid, setLeaderUid] = useState<string | null>(null)
    const [leaderName, setLeaderName] = useState<string | null>(null)
    const [avgSatisfaction, setAvgSatisfaction] = useState<number | null>(null)
    const [satisfactionDeltaPct, setSatisfactionDeltaPct] = useState<number | null>(null)
    const [showTableFilters, setShowTableFilters] = useState<boolean>(false)
    const [tableSearch, setTableSearch] = useState<string>("")
    const [tableSortField, setTableSortField] = useState<"date" | "hours" | "attendees">("date")
    const [tableSortDirection, setTableSortDirection] = useState<"asc" | "desc">("desc")
    const [showSortDropdown, setShowSortDropdown] = useState<boolean>(false)

    const [isAttendeesModalOpen, setIsAttendeesModalOpen] = useState<boolean>(false)
    const [selectedTrainingForModal, setSelectedTrainingForModal] = useState<TrainingWithParticipants | null>(null)
    const [hasAutoGeneratedInitialPlan, setHasAutoGeneratedInitialPlan] = useState<boolean>(false)

    const canViewTeamReports = hasPermission("reports_view_team")
    const canViewAllReports = hasPermission("reports_view_all")
    const isTeamScoped = canViewTeamReports && !canViewAllReports

    useEffect(() => {
        let cancelled = false

        async function loadFilters(): Promise<void> {
            try {
                if (!database) {
                    setDepartments([])
                    setYears([])
                    return
                }

                const [names, trainingYears] = await Promise.all([
                    getDepartmentNames(database),
                    getTrainingYearsForDatabase(database),
                ])

                if (!cancelled) {
                    setDepartments(names)
                    setYears(trainingYears)

                    if (trainingYears.length > 0) {
                        setSelectedYear((current) => current ?? trainingYears[0])
                    } else {
                        setSelectedYear(null)
                    }
                }
            } catch (error) {
                console.error("No fue posible cargar los filtros del plan de formación:", error)
            }
        }

        void loadFilters()

        return () => {
            cancelled = true
        }
    }, [database])

    /**
     * Carga el nombre del líder autenticado (según su perfil en RTDB)
     * para poder filtrar los reportes solo a sus colaboradores directos.
     */
    useEffect(() => {
        if (!database || !user || !isTeamScoped) {
            setLeaderUid(null)
            setLeaderName(null)
            return
        }

        let cancelled = false

        const loadLeaderProfile = async () => {
            try {
                const profile = await getUserProfile(user.uid, database)
                if (cancelled) return

                const cleanName = typeof profile?.name === "string" ? profile.name.trim() : ""
                setLeaderUid(user.uid)
                setLeaderName(cleanName.length > 0 ? cleanName : null)
            } catch (error) {
                console.error("No fue posible cargar el perfil del líder para el reporte de formación:", error)
                if (!cancelled) {
                    setLeaderUid(null)
                    setLeaderName(null)
                }
            }
        }

        void loadLeaderProfile()

        return () => {
            cancelled = true
        }
    }, [database, user, isTeamScoped])

    // Exportar a PDF: captura el contenedor principal
    const handleExportPDF = async () => {
        setShowExportMenu(false)
        const element = exportRef.current || document.getElementById("training-report-container")
        if (!element) return
        try {
            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                scrollX: 0,
                scrollY: -window.scrollY,
            })

            const imgData = canvas.toDataURL('image/png')
            const pdf = new jsPDF('p', 'mm', 'a4')

            const pageWidth = pdf.internal.pageSize.getWidth()
            const pageHeight = pdf.internal.pageSize.getHeight()

            const imgWidth = pageWidth
            const imgHeight = (canvas.height * imgWidth) / canvas.width

            let position = 0
            let heightLeft = imgHeight

            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
            heightLeft -= pageHeight

            while (heightLeft > 0) {
                position = heightLeft - imgHeight
                pdf.addPage()
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
                heightLeft -= pageHeight
            }

            const periodLabel = (() => {
                if (!selectedYear) return "Sin-periodo"
                if (periodMode === "month" && typeof selectedMonth === "number") {
                    const monthName = MONTH_LABELS[selectedMonth - 1] ?? "Mes"
                    return `${selectedYear} - ${monthName}`
                }
                return String(selectedYear)
            })()

            const exportTitle = `Plan de Formación ${periodLabel}${selectedDepartment ? ` - ${selectedDepartment}` : ""}`
            const fileName = `${exportTitle.toLowerCase().replace(/\s+/g, '-')}.pdf`

            pdf.save(fileName)
        } catch (exportError) {
            console.error('Error al exportar PDF:', exportError)
        }
    }

    // Exportar a Excel: descarga filas detalladas por asistente/capacitación
    const handleExportExcel = async () => {
        if (!database) return

        setShowExportMenu(false)
        // Solo asistentes presentes o tarde
        const rows: Array<Array<string | number>> = []

        // Cargar un mapa uid -> cargo en una sola lectura (BD seleccionada)
        const cargoCache: UserCargoCache = await loadUsersCargoMap(database)

        // Caché por email para búsquedas cruzadas solo cuando el recinto es corporativo
        const crossDbCargoCache: UserEmailCargoCache = {}

        for (const { meeting, trainer, participants, areas } of trainings) {
            const areaStr = areas.length > 0 ? areas.join(", ") : "-"
            const hours = getTrainingHours(meeting.startTime, meeting.endTime)
            const dateStr = new Date(meeting.startTime).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
            const asistentes = participants.filter((participant) =>
                (participant.attendance === "present" || participant.attendance === "late")
                && !participant.noShow,
            )
            for (const p of asistentes) {
                let cargo = cargoCache[p.uid] ?? ""

                // Si estamos en corporativo y en la BD actual no existe el cargo,
                // intentamos resolverlo en las demás BDs usando el email del participante.
                if (!cargo) {
                    cargo = await resolveCrossDbUserCargoByEmail(p.email, crossDbCargoCache)
                }
                rows.push([
                    meeting.title,
                    dateStr,
                    areaStr,
                    hours,
                    p.name,
                    cargo,
                    p.attendance ?? "-",
                    trainer ?? "-"
                ])
            }
        }
        // Crear archivo Excel real
        const ws = XLSX.utils.aoa_to_sheet([
            ["Capacitación", "Fecha", "Área(s)", "Horas", "Asistente", "Cargo", "Asistencia", "Capacitador"],
            ...rows
        ])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Plan de Formación")
        XLSX.writeFile(wb, "plan-formacion.xlsx")
    }

    const handleGeneratePlan = useCallback(async (): Promise<void> => {
        if (!database || selectedYear === null) {
            setTotalTrainings(0)
            setTotalHours(0)
            setTotalAttended(0)
            setTrainingsDeltaPct(null)
            setHoursDeltaPct(null)
            setAttendedDeltaPct(null)
            setDepartmentTrainingCounts([])
            setSelectedAreaForChart(null)
            setHoursByRole([])
            setTrainings([])
            setAvgSatisfaction(null)
            setSatisfactionDeltaPct(null)
            setTableSearch("")
            return
        }

        if (periodMode === "month" && (selectedMonth === null || selectedMonth < 1 || selectedMonth > 12)) {
            setTotalTrainings(0)
            setTotalHours(0)
            setTotalAttended(0)
            setTrainingsDeltaPct(null)
            setHoursDeltaPct(null)
            setAttendedDeltaPct(null)
            setDepartmentTrainingCounts([])
            setSelectedAreaForChart(null)
            setHoursByRole([])
            setTrainings([])
            setAvgSatisfaction(null)
            setSatisfactionDeltaPct(null)
            setTableSearch("")
            return
        }

        // Para líderes, si no tenemos su nombre, no podemos filtrar colaboradores de forma segura.
        // En ese caso devolvemos un estado vacío hasta que el perfil esté disponible.
        if (isTeamScoped && (!leaderName || leaderName.trim().length === 0)) {
            setTotalTrainings(0)
            setTotalHours(0)
            setTotalAttended(0)
            setTrainingsDeltaPct(null)
            setHoursDeltaPct(null)
            setAttendedDeltaPct(null)
            setDepartmentTrainingCounts([])
            setSelectedAreaForChart(null)
            setHoursByRole([])
            setTrainings([])
            setAvgSatisfaction(null)
            setSatisfactionDeltaPct(null)
            setTableSearch("")
            return
        }

        try {
            setIsGenerating(true)
            const previousYear = selectedYear - 1

            const monthForCurrent = periodMode === "month" ? selectedMonth : null
            const monthForPrevious = periodMode === "month" ? selectedMonth : null

            const effectiveLeaderName = isTeamScoped ? leaderName : null
            const effectiveLeaderUid = isTeamScoped ? leaderUid : null

            const [currentKpi, previousKpi, rawDepartmentCounts, hoursByRoleForYear, trainingsList, trainingsListPrevious] = await Promise.all([
                getTrainingKpiForYear(database, selectedYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForCurrent),
                getTrainingKpiForYear(database, previousYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForPrevious),
                getTrainingCountsByDepartmentForYear(database, selectedYear, effectiveLeaderName, effectiveLeaderUid, monthForCurrent),
                // Para "Horas por cargo" primero traemos el agregado de tutte las áreas
                getTrainingHoursByRoleForYear(database, selectedYear, null, effectiveLeaderName, effectiveLeaderUid, monthForCurrent),
                getTrainingsWithParticipants(database, selectedYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForCurrent),
                getTrainingsWithParticipants(database, previousYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForPrevious),
            ]) as [
                    TrainingKpiSummary,
                    TrainingKpiSummary,
                    DepartmentTrainingCount[],
                    TrainingHoursByRole[],
                    TrainingWithParticipants[],
                    TrainingWithParticipants[],
                ]

            setTotalTrainings(currentKpi.totalTrainings)
            setTotalHours(currentKpi.totalHours)
            setTotalAttended(currentKpi.totalAttended)

            const filteredDepartmentCounts = selectedDepartment
                ? rawDepartmentCounts.filter((item) => item.department === selectedDepartment)
                : rawDepartmentCounts

            setDepartmentTrainingCounts(filteredDepartmentCounts)
            // Reiniciamos la selección de área para el gráfico de horas por cargo
            setSelectedAreaForChart(null)
            setHoursByRole(hoursByRoleForYear)
            setTrainings(trainingsList)

            const calculateDelta = (current: number, previous: number): number | null => {
                if (previous <= 0) {
                    return null
                }
                return ((current - previous) / previous) * 100
            }

            setTrainingsDeltaPct(calculateDelta(currentKpi.totalTrainings, previousKpi.totalTrainings))
            setHoursDeltaPct(calculateDelta(currentKpi.totalHours, previousKpi.totalHours))
            setAttendedDeltaPct(calculateDelta(currentKpi.totalAttended, previousKpi.totalAttended))

            const currentAvg = await computeAverageSatisfaction(database, trainingsList)
            const previousAvg = await computeAverageSatisfaction(database, trainingsListPrevious)

            setAvgSatisfaction(currentAvg)

            if (currentAvg !== null && previousAvg !== null && previousAvg > 0) {
                setSatisfactionDeltaPct(((currentAvg - previousAvg) / previousAvg) * 100)
            } else {
                setSatisfactionDeltaPct(null)
            }
        } catch (error) {
            console.error("No fue posible cargar los KPIs del plan de formación:", error)
        } finally {
            setIsGenerating(false)
        }
    }, [
        database,
        selectedYear,
        periodMode,
        selectedMonth,
        isTeamScoped,
        leaderName,
        leaderUid,
        selectedDepartment,
    ])

    /**
     * Al ingresar a la página, genera automáticamente el plan
     * para el ciclo actual (año seleccionado por defecto) sin
     * que el usuario tenga que pulsar el botón.
     */
    useEffect(() => {
        if (!database || selectedYear === null) {
            return
        }

        if (hasAutoGeneratedInitialPlan) {
            return
        }

        if (periodMode === "month" && (selectedMonth === null || selectedMonth < 1 || selectedMonth > 12)) {
            return
        }

        if (isTeamScoped) {
            const leaderNameTrimmed = leaderName?.trim() ?? ""
            if (leaderNameTrimmed.length === 0) {
                return
            }
        }

        setHasAutoGeneratedInitialPlan(true)
        void handleGeneratePlan()
    }, [
        database,
        selectedYear,
        periodMode,
        selectedMonth,
        isTeamScoped,
        leaderName,
        leaderUid,
        hasAutoGeneratedInitialPlan,
        handleGeneratePlan,
    ])

    /**
     * Maneja la selección de un área/departamento desde la tarjeta
     * "Capacitaciones por Área" para actualizar el gráfico dependiente
     * de "Horas por cargo".
     *
     * Por defecto el gráfico muestra el agregado de todas las áreas.
     * Al hacer clic en un departamento, se recalculan las horas solo
     * para ese departamento.
     */
    const handleAreaClick = (departmentName: string): void => {
        setSelectedAreaForChart(departmentName)

        if (!database || selectedYear === null) {
            return
        }

        const monthForCurrent = periodMode === "month" ? selectedMonth : null
        const effectiveLeaderName = isTeamScoped ? leaderName : null
        const effectiveLeaderUid = isTeamScoped ? leaderUid : null

        void (async () => {
            try {
                const hoursForDepartment = await getTrainingHoursByRoleForYear(
                    database,
                    selectedYear,
                    departmentName,
                    effectiveLeaderName,
                    effectiveLeaderUid,
                    monthForCurrent,
                )
                setHoursByRole(hoursForDepartment)
            } catch (error) {
                console.error("No fue posible cargar las horas por cargo para el departamento seleccionado:", error)
            }
        })()
    }

    const handleToggleTableFilters = (): void => {
        setShowTableFilters((previous) => !previous)
    }

    const handleSelectSortField = (field: "date" | "hours" | "attendees"): void => {
        setTableSortField(field)
        setShowSortDropdown(false)
    }

    /**
     * Abre el modal con el detalle de asistentes para una capacitación específica.
     */
    const handleOpenAttendeesModal = (training: TrainingWithParticipants): void => {
        setSelectedTrainingForModal(training)
        setIsAttendeesModalOpen(true)
    }

    /**
     * Cierra el modal de asistentes y limpia la capacitación seleccionada.
     */
    const handleCloseAttendeesModal = (): void => {
        setIsAttendeesModalOpen(false)
        setSelectedTrainingForModal(null)
    }

    const filteredAndSortedTrainings: TrainingWithParticipants[] = (() => {
        if (trainings.length === 0) {
            return []
        }

        const normalizedSearch = tableSearch.trim().toLowerCase()

        const filtered = trainings.filter(({ meeting, trainer, areas }) => {
            if (!normalizedSearch) {
                return true
            }

            const titleText = meeting.title.toLowerCase()
            const trainerText = (trainer ?? "").toLowerCase()
            const areasText = areas.join(", ").toLowerCase()

            return (
                titleText.includes(normalizedSearch)
                || trainerText.includes(normalizedSearch)
                || areasText.includes(normalizedSearch)
            )
        })

        const sorted = [...filtered].sort((first, second) => {
            const multiplier = tableSortDirection === "asc" ? 1 : -1

            if (tableSortField === "date") {
                return (first.meeting.startTime - second.meeting.startTime) * multiplier
            }

            if (tableSortField === "hours") {
                const firstHours = getTrainingHours(first.meeting.startTime, first.meeting.endTime)
                const secondHours = getTrainingHours(second.meeting.startTime, second.meeting.endTime)
                return (firstHours - secondHours) * multiplier
            }

            const firstAttendees = first.participants.filter((participant) =>
                (participant.attendance === "present" || participant.attendance === "late")
                && !participant.noShow,
            ).length
            const secondAttendees = second.participants.filter((participant) =>
                (participant.attendance === "present" || participant.attendance === "late")
                && !participant.noShow,
            ).length
            return (firstAttendees - secondAttendees) * multiplier
        })

        return sorted
    })()

    const attendeesForSelectedTraining = selectedTrainingForModal
        ? selectedTrainingForModal.participants
            .filter((participant) =>
                (participant.attendance === "present" || participant.attendance === "late")
                && !participant.noShow,
            )
            .sort((first, second) => first.name.localeCompare(second.name, "es-ES"))
        : []

    const exportActions = (
        <div className="relative">
            <button
                className="flex items-center gap-x-4 px-4 py-2.5 bg-zinc-300 rounded-2xl cursor-pointer"
                onClick={() => setShowExportMenu((v) => !v)}
            >
                <Download className="w-4 h-4" />
                <span className="text-sm font-medium text-foreground">Exportar</span>
            </button>
            {showExportMenu && (
                <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-gray-100"
                        onClick={handleExportPDF}
                    >
                        Exportar a PDF
                    </button>
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-gray-100"
                        onClick={handleExportExcel}
                    >
                        Exportar a Excel
                    </button>
                </div>
            )}
        </div>
    )

    return (
        <Layout
            header={{
                breadcrumbs: [{ label: 'Reportes', to: '/reports' }, { label: 'Plan de formación' }],
                title: 'Plan de formación',
            }}
        >
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>
                <div className='bg-linear-to-br from-background via-muted/5 to-background' id="training-report-container" ref={exportRef}>
                    <div className='px-4 md:px-12 py-10 md:py-10 space-y-10'>
                        <section className="bg-[#f3f4f3] p-4 rounded-xl max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Acciones</p>
                                <h2 className="text-sm md:text-base font-bold text-[#191c1c]">Reporte de plan de formación</h2>
                            </div>
                            {exportActions}
                        </section>

                        <section className="bg-[#f3f4f3] p-6 rounded-xl space-y-4 max-w-7xl mx-auto">
                            <div className="flex flex-wrap items-end gap-6">
                                <div className="flex-1 min-w-50">
                                    <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Periodo</label>
                                    <div className="space-y-2">
                                        <div className="relative">
                                            <select
                                                className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-[#191c1c] appearance-none focus:ring-2 focus:ring-primary-container"
                                                value={selectedYear ?? ""}
                                                onChange={(event) => {
                                                    const value = event.target.value
                                                    setSelectedYear(value ? Number(value) : null)
                                                }}
                                            >
                                                {years.length === 0 ? (
                                                    <option value="" disabled>
                                                        No hay capacitaciones registradas
                                                    </option>
                                                ) : (
                                                    years.map((year) => (
                                                        <option key={year} value={year}>
                                                            {year} {year === new Date().getFullYear() ? "- Ciclo Actual" : "- Histórico"}
                                                        </option>
                                                    ))
                                                )}
                                            </select>
                                            <ChevronDown className="absolute right-3 top-3 text-outline pointer-events-none" />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 min-w-50">
                                    <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Área</label>
                                    <div className="relative">
                                        <select
                                            className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-[#191c1c] appearance-none focus:ring-2 focus:ring-primary-container"
                                            value={selectedDepartment}
                                            onChange={(event) => {
                                                setSelectedDepartment(event.target.value)
                                            }}
                                        >
                                            <option value="">Todas las Áreas</option>
                                            {departments.map((name) => (
                                                <option key={name} value={name}>
                                                    {name}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-3 text-outline pointer-events-none" />
                                    </div>
                                </div>
                                <div className="flex-none">
                                    <button
                                        className="bg-[#1b3022] text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-primary transition-all shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
                                        onClick={() => { void handleGeneratePlan() }}
                                        disabled={isGenerating || !database || selectedYear === null}
                                    >
                                        <IterationCw className={`w-4 h-4 ${isGenerating ? "animate-spin" : ""}`} />
                                        {isGenerating ? "Generando..." : "Generar Plan"}
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-2 items-center justify-between text-[10px] text-outline">
                                <div className="flex gap-2 items-center">
                                    <button
                                        type="button"
                                        className={`px-3 py-1 rounded-full border text-[10px] font-semibold transition-colors ${periodMode === "year" ? "bg-[#1b3022] text-white border-[#1b3022]" : "bg-white border-[#edeeed] hover:bg-[#edeeed]"}`}
                                        onClick={() => setPeriodMode("year")}
                                    >
                                        Ciclo anual
                                    </button>
                                    <button
                                        type="button"
                                        className={`px-3 py-1 rounded-full border text-[10px] font-semibold transition-colors ${periodMode === "month" ? "bg-[#1b3022] text-white border-[#1b3022]" : "bg-white border-[#edeeed] hover:bg-[#edeeed]"}`}
                                        onClick={() => setPeriodMode("month")}
                                    >
                                        Mensual
                                    </button>
                                    {periodMode === "month" && (
                                        <div className="relative flex-1 min-w-32">
                                            <select
                                                className="w-full bg-white border border-[#edeeed] rounded-lg py-2 pl-3 pr-8 text-xs font-medium text-[#191c1c] appearance-none focus:outline-none focus:ring-1 focus:ring-primary-container"
                                                value={selectedMonth ?? ""}
                                                onChange={(event) => {
                                                    const value = event.target.value
                                                    setSelectedMonth(value ? Number(value) : null)
                                                }}
                                            >
                                                <option value="">Todos los meses</option>
                                                {MONTH_LABELS.map((label, index) => (
                                                    <option key={label} value={index + 1}>{label}</option>
                                                ))}
                                            </select>
                                            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-outline pointer-events-none" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* kpi section */}
                        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">

                            {/* kpi total de capacitaciones */}
                            <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 rounded-xl bg-[#d0e9d4] text-emerald-900">
                                        <TrendingUp className="w-5 h-5" />
                                    </div>
                                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                        {isGenerating
                                            ? "Calculando..."
                                            : selectedYear && trainingsDeltaPct !== null
                                                ? `${trainingsDeltaPct >= 0 ? "+" : ""}${trainingsDeltaPct.toFixed(0)}% vs ${selectedYear - 1}`
                                                : "Sin datos previos"}
                                    </span>
                                </div>
                                <p className="text-3xl font-extrabold text-[#191c1c]">
                                    {isGenerating ? (
                                        <span className="inline-block h-7 w-20 bg-zinc-200 rounded-md animate-pulse" />
                                    ) : (
                                        totalTrainings
                                    )}
                                </p>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Total de Capacitaciones</p>
                            </div>

                            {/* kpi de total de horas */}
                            <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 rounded-xl bg-[#D9E6D8] text-emerald-900">
                                        <Clock className="w-5 h-5" />
                                    </div>
                                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                        {isGenerating
                                            ? "Calculando..."
                                            : selectedYear && hoursDeltaPct !== null
                                                ? `${hoursDeltaPct >= 0 ? "+" : ""}${hoursDeltaPct.toFixed(0)}% vs ${selectedYear - 1}`
                                                : "Sin datos previos"}
                                    </span>
                                </div>
                                <p className="text-3xl font-extrabold text-[#191c1c]">
                                    {isGenerating ? (
                                        <span className="inline-block h-7 w-24 bg-zinc-200 rounded-md animate-pulse" />
                                    ) : (
                                        formatHours(totalHours)
                                    )}
                                </p>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Total de Horas</p>
                            </div>

                            {/* kpi de promedio de asistencias */}
                            <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 rounded-xl bg-[#FFDD86] text-[#2a1800]">
                                        <Users className="w-5 h-5" />
                                    </div>
                                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                        {isGenerating
                                            ? "Calculando..."
                                            : selectedYear && attendedDeltaPct !== null
                                                ? `${attendedDeltaPct >= 0 ? "+" : ""}${attendedDeltaPct.toFixed(0)}% vs ${selectedYear - 1}`
                                                : "Sin datos previos"}
                                    </span>
                                </div>
                                <p className="text-3xl font-extrabold text-[#191c1c]">
                                    {isGenerating ? (
                                        <span className="inline-block h-7 w-20 bg-zinc-200 rounded-md animate-pulse" />
                                    ) : (
                                        totalAttended
                                    )}
                                </p>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Total de Asistencias</p>
                            </div>

                            {/* kpi de promedio de satisfacción */}
                            <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 rounded-xl bg-[#ffdad6] text-[#93000a]">
                                        <Smile className="w-5 h-5" />
                                    </div>
                                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                        {isGenerating
                                            ? "Calculando..."
                                            : selectedYear && satisfactionDeltaPct !== null
                                                ? `${satisfactionDeltaPct >= 0 ? "+" : ""}${satisfactionDeltaPct.toFixed(0)}% vs ${selectedYear - 1}`
                                                : "Sin datos previos"}
                                    </span>
                                </div>
                                <p className="text-3xl font-extrabold text-[#191c1c]">
                                    {isGenerating ? (
                                        <span className="inline-block h-7 w-24 bg-zinc-200 rounded-md animate-pulse" />
                                    ) : (
                                        avgSatisfaction !== null ? avgSatisfaction.toFixed(1) : "—"
                                    )}
                                </p>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Promedio de Satisfacción</p>
                            </div>
                        </section>



                        {/* section de los graficos de capacitaciones por area y horas por cargo 
                        - para este bloque vamos a mostrar una card donde se distribuya por area y en la otra card se muestre por cargo dependiendo de la seccion que el usuario le de click en la card anterior, para esto se puede usar un estado que guarde la seccion seleccionada y dependiendo de eso mostrar un grafico u otro, para los graficos se pueden usar componentes de librerias como recharts o chart.js, y para los datos se pueden generar datos de ejemplo o usar datos reales si es que ya existen en la base de datos
                    */}
                        <section className="grid md:grid-cols-2 gap-6 max-w-7xl mx-auto">
                            <div className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] p-8">
                                <div className="flex justify-between items-center mb-8">
                                    <div>
                                        <h3 className="text-xl font-bold text-emerald-950">Capacitaciones por Área</h3>
                                        <p className="text-xs text-outline font-medium">Distribución departamental del plan actual</p>
                                    </div>
                                </div>
                                <div className="space-y-6">
                                    {isGenerating ? (
                                        <div className="space-y-3">
                                            {[1, 2, 3].map((row) => (
                                                <div key={row} className="space-y-2">
                                                    <div className="flex justify-between items-center">
                                                        <span className="h-3 w-32 bg-zinc-200 rounded-md animate-pulse" />
                                                        <span className="h-3 w-16 bg-zinc-200 rounded-md animate-pulse" />
                                                    </div>
                                                    <div className="h-3 w-full bg-zinc-200 rounded-full animate-pulse" />
                                                </div>
                                            ))}
                                        </div>
                                    ) : departmentTrainingCounts.length === 0 ? (
                                        <p className="text-xs text-[#434843]">
                                            Genera el plan para visualizar la distribución de capacitaciones por área en el
                                            periodo seleccionado.
                                        </p>
                                    ) : (
                                        (() => {
                                            /**
                                             * Determina el número máximo de capacitaciones entre todos los área
                                             * para poder escalar las barras de distribución de forma proporcional.
                                             */
                                            const maxTrainings = departmentTrainingCounts.reduce<number>((max, item) => {
                                                return item.trainings > max ? item.trainings : max
                                            }, 0)

                                            return departmentTrainingCounts.map((item) => {
                                                /**
                                                 * Calcula el ancho de la barra para el departamento actual en función
                                                 * de sus capacitaciones respecto al máximo del conjunto. Se garantiza un
                                                 * ancho mínimo del 6% para que las barras con pocos registros sigan siendo visibles.
                                                 */
                                                const widthPercentage = maxTrainings > 0
                                                    ? Math.max(6, (item.trainings / maxTrainings) * 100)
                                                    : 0

                                                const isSelected = selectedAreaForChart === item.department

                                                return (
                                                    <div
                                                        key={item.department}
                                                        className={`space-y-2 rounded-lg px-2 py-1 transition-colors cursor-pointer ${isSelected ? "bg-emerald-50" : "hover:bg-emerald-50/70"}`}
                                                        onClick={() => handleAreaClick(item.department)}
                                                    >
                                                        <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                                                            <span>{item.department}</span>
                                                            <span>{item.trainings} capacitaciones</span>
                                                        </div>
                                                        <div className="h-3 w-full bg-[#edeeed] rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-[#1b3022] rounded-full"
                                                                style={{ width: `${widthPercentage}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        })()
                                    )}
                                </div>
                            </div>
                            <div className="bg-[#1b3022] rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] p-8">
                                <div className="flex justify-between items-center mb-8">
                                    <div>
                                        <h3 className="text-xl font-bold text-white">Horas por cargo</h3>
                                        <p className="text-xs text-outline font-medium text-[#819986]">Intensidad formativa por cargo</p>
                                    </div>
                                </div>
                                <div className="space-y-6">
                                    {(() => {
                                        const filteredHoursByRole = hoursByRole

                                        if (filteredHoursByRole.length === 0) {
                                            return (
                                                <p className="text-xs text-[#dbe7dd]">
                                                    No se encontraron horas de capacitación registradas por cargo para el
                                                    periodo seleccionado.
                                                </p>
                                            )
                                        }

                                        const maxHours = filteredHoursByRole.reduce<number>((max, item) => {
                                            return item.hours > max ? item.hours : max
                                        }, 0)

                                        const areaLabel = selectedAreaForChart || (selectedDepartment || null)

                                        return (
                                            <>
                                                <p className="text-xs text-[#dbe7dd]">
                                                    Horas totales de capacitación por cargo para el año
                                                    <span className="font-semibold"> {selectedYear}</span>
                                                    {areaLabel && (
                                                        <>
                                                            <span> · Área </span>
                                                            <span className="font-semibold">{areaLabel}</span>
                                                        </>
                                                    )}
                                                </p>
                                                <div className="space-y-3">
                                                    {filteredHoursByRole.map((item) => {
                                                        const widthPercentage = maxHours > 0
                                                            ? Math.max(6, (item.hours / maxHours) * 100)
                                                            : 0

                                                        return (
                                                            <div key={item.role} className="space-y-1">
                                                                <div className="flex justify-between text-[11px] font-medium text-[#e2efe4]">
                                                                    <span>{item.role}</span>
                                                                    <span>{formatHours(item.hours)} h</span>
                                                                </div>
                                                                <div className="h-2.5 w-full bg-[#243a2c] rounded-full overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-[#9ee6b3] rounded-full"
                                                                        style={{ width: `${widthPercentage}%` }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </>
                                        )
                                    })()}
                                </div>
                            </div>
                        </section>

                        <section className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden max-w-7xl mx-auto">
                            <div className="p-8 flex justify-between items-center border-b border-[#edeeed]">
                                <h3 className="text-xl font-bold text-emerald-950">Listado de Capacitaciones</h3>
                                <div className="flex gap-3 items-center text-[10px] text-outline uppercase tracking-widest relative">
                                    <button
                                        type="button"
                                        className="px-3 py-1 rounded-full bg-[#edeeed] text-[10px] font-semibold hover:bg-[#e1e3e2] transition-colors flex items-center gap-1"
                                        onClick={() => setShowSortDropdown((previous) => !previous)}
                                    >
                                        <LucideBarChart className="w-3 h-3 -rotate-90" />
                                        <span>
                                            Ordenar por: {tableSortField === "date" ? "Fecha" : tableSortField === "hours" ? "Horas" : "Asistentes"}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="p-2 rounded-lg bg-[#edeeed] text-outline hover:text-primary-container transition-colors"
                                        onClick={handleToggleTableFilters}
                                    >
                                        <Search className="w-4 h-4" />
                                    </button>
                                    {showSortDropdown && (
                                        <div className="absolute right-0 top-10 w-48 bg-white border border-[#edeeed] rounded-lg shadow-lg z-10 py-2">
                                            <p className="px-3 pb-1 text-[10px] font-bold text-outline uppercase tracking-widest">
                                                Selecciona el criterio
                                            </p>
                                            <label className="flex items-center gap-2 px-3 py-1 text-xs text-[#191c1c] cursor-pointer hover:bg-[#f3f4f3]">
                                                <input
                                                    type="checkbox"
                                                    className="w-3 h-3 rounded border-[#c4c7c5]"
                                                    checked={tableSortField === "date"}
                                                    onChange={() => handleSelectSortField("date")}
                                                />
                                                <span>Fecha</span>
                                            </label>
                                            <label className="flex items-center gap-2 px-3 py-1 text-xs text-[#191c1c] cursor-pointer hover:bg-[#f3f4f3]">
                                                <input
                                                    type="checkbox"
                                                    className="w-3 h-3 rounded border-[#c4c7c5]"
                                                    checked={tableSortField === "hours"}
                                                    onChange={() => handleSelectSortField("hours")}
                                                />
                                                <span>Horas</span>
                                            </label>
                                            <label className="flex items-center gap-2 px-3 py-1 text-xs text-[#191c1c] cursor-pointer hover:bg-[#f3f4f3]">
                                                <input
                                                    type="checkbox"
                                                    className="w-3 h-3 rounded border-[#c4c7c5]"
                                                    checked={tableSortField === "attendees"}
                                                    onChange={() => handleSelectSortField("attendees")}
                                                />
                                                <span>Asistentes</span>
                                            </label>
                                        </div>
                                    )}
                                </div>
                            </div>
                            {showTableFilters && (
                                <div className="px-8 pb-4 pt-2 border-b border-[#edeeed] bg-[#f9faf9] flex justify-between gap-4 items-end">
                                    <div className="flex-1 min-w-50">
                                        <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-1 ml-1">
                                            Buscar en listado
                                        </label>
                                        <input
                                            type="text"
                                            className="w-full bg-white border border-[#edeeed] rounded-lg py-2 px-3 text-sm text-[#191c1c] focus:outline-none focus:ring-2 focus:ring-primary-container"
                                            placeholder="Título, capacitador o área"
                                            value={tableSearch}
                                            onChange={(event) => setTableSearch(event.target.value)}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-outline">
                                        <span className="uppercase tracking-widest font-bold">Dirección</span>
                                        <button
                                            type="button"
                                            className="px-3 py-1 rounded-full bg-white border border-[#edeeed] text-[10px] font-semibold hover:bg-[#edeeed] transition-colors"
                                            onClick={() => setTableSortDirection((previous) => (previous === "asc" ? "desc" : "asc"))}
                                        >
                                            {tableSortDirection === "asc" ? "Ascendente" : "Descendente"}
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-[#f3f4f3]">
                                            <th className="px-8 py-4 text-[10px] uppercase tracking-widest text-outline font-black">Capacitación</th>
                                            <th className="px-8 py-4 text-[10px] uppercase tracking-widest text-outline font-black">Área</th>
                                            <th className="px-8 py-4 text-[10px] uppercase tracking-widest text-outline font-black">Fecha</th>
                                            <th className="px-8 py-4 text-[10px] uppercase tracking-widest text-outline font-black">Horas</th>
                                            <th className="px-8 py-4 text-[10px] uppercase tracking-widest text-outline font-black text-center">Asistentes</th>
                                            <th className="px-8 py-4 text-[10px] uppercase tracking-widest text-outline font-black text-center">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#edeeed]">
                                        {isGenerating ? (
                                            <tr>
                                                <td colSpan={6} className="py-8 text-center text-[#434843]">Cargando capacitaciones...</td>
                                            </tr>
                                        ) : filteredAndSortedTrainings.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-8 text-center text-[#434843]">No hay capacitaciones registradas para el periodo y filtros seleccionados.</td>
                                            </tr>
                                        ) : (
                                            filteredAndSortedTrainings.map((training) => {
                                                const { meeting, trainer, participants, areas } = training
                                                // Áreas involucradas: mostrar todas las áreas únicas
                                                const area = areas.length > 0 ? areas.join(", ") : "-"
                                                // Fecha formateada
                                                const date = new Date(meeting.startTime)
                                                const dateStr = date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
                                                // Horas
                                                const hours = getTrainingHours(meeting.startTime, meeting.endTime)
                                                // Asistentes: solo los presentes o tarde que no estén marcados como noShow
                                                const attendees = participants.filter((participant) =>
                                                    (participant.attendance === "present" || participant.attendance === "late")
                                                    && !participant.noShow,
                                                ).length
                                                return (
                                                    <tr key={meeting.id} className="hover:bg-slate-50 transition-colors group">
                                                        <td className="px-8 py-5">
                                                            <div>
                                                                <p className="text-sm font-bold text-[#191c1c]">{meeting.title}</p>
                                                                <p className="text-[10px] text-slate-500 font-medium">Capacitador: {trainer ?? "-"}</p>
                                                            </div>
                                                        </td>
                                                        <td className="px-8 py-5">
                                                            <span className="text-xs font-semibold text-[#5a665a] bg-[#d6e3d5] px-3 py-1 rounded-full">{area}</span>
                                                        </td>
                                                        <td className="px-8 py-5 text-sm font-medium text-[#191c1c]">{dateStr}</td>
                                                        <td className="px-8 py-5 text-sm font-bold text-emerald-900">{formatHours(hours)} hrs</td>
                                                        <td className="px-8 py-5 text-sm font-medium text-[#191c1c] text-center">{attendees}</td>
                                                        <td className="px-8 py-5 text-center">
                                                            <button
                                                                type="button"
                                                                className="px-3 py-1 rounded-lg bg-[#edeeed] text-outline hover:text-primary-container transition-colors"
                                                                onClick={() => handleOpenAttendeesModal(training)}
                                                            >
                                                                <Eye className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                )
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </div>
                </div>
                {isAttendeesModalOpen && selectedTrainingForModal && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-xs">
                        <div className="bg-white rounded-2xl shadow-[0_24px_40px_rgba(15,23,42,0.25)] w-full max-w-lg mx-4">
                            <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-[#edeeed]">
                                <div>
                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold mb-1">Asistentes</p>
                                    <h2 className="text-lg font-bold text-[#191c1c] leading-snug">
                                        {selectedTrainingForModal.meeting.title}
                                    </h2>
                                    <p className="text-[11px] text-slate-500 mt-1">
                                        {new Date(selectedTrainingForModal.meeting.startTime).toLocaleDateString("es-ES", {
                                            day: "2-digit",
                                            month: "short",
                                            year: "numeric",
                                        })}
                                        {" · "}
                                        {formatHours(
                                            getTrainingHours(
                                                selectedTrainingForModal.meeting.startTime,
                                                selectedTrainingForModal.meeting.endTime,
                                            ),
                                        )}
                                        {" hrs"}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCloseAttendeesModal}
                                    className="p-1.5 rounded-full hover:bg-[#edeeed] text-outline hover:text-[#191c1c] transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="px-6 pt-4 pb-5 max-h-80 overflow-y-auto">
                                {attendeesForSelectedTraining.length === 0 ? (
                                    <p className="text-sm text-[#434843]">
                                        No se registraron asistentes presentes o tarde para esta capacitación.
                                    </p>
                                ) : (
                                    <>
                                        <p className="text-xs text-outline mb-3">
                                            Total de asistentes: <span className="font-semibold text-[#191c1c]">{attendeesForSelectedTraining.length}</span>
                                        </p>
                                        <ul className="space-y-2">
                                            {attendeesForSelectedTraining.map((participant) => (
                                                <li
                                                    key={participant.uid}
                                                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#f6f7f6]"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-[#d6e3d5] flex items-center justify-center text-xs font-bold text-[#1b3022]">
                                                            {participant.name
                                                                .split(" ")
                                                                .filter((part) => part.length > 0)
                                                                .slice(0, 2)
                                                                .map((part) => part[0]?.toUpperCase())
                                                                .join("")}
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-semibold text-[#191c1c] leading-tight">{participant.name}</p>
                                                            {participant.email && (
                                                                <p className="text-[11px] text-slate-500 leading-tight">{participant.email}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <span className="text-[11px] font-medium text-emerald-900 bg-[#d0e9d4] px-2.5 py-1 rounded-full capitalize">
                                                        {participant.attendance === "late" ? "Tarde" : "Presente"}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    )
}

export default ReportTrainingPlanPage