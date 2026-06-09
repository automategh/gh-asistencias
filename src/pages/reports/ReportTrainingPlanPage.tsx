import Layout from "@/components/layouts/layout"
import { ChevronDown, Clock, Download, Eye, IterationCw, LucideBarChart, Search, Smile, TrendingUp, Users, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import jsPDF from "jspdf"
import ExcelJS from "exceljs"
import { getUserProfile, loadUsersProfileMiniMap, type UserProfileMiniCache } from "@/services/user.service"
import { useDatabase } from "@/context/DatabaseContext"
import { useAuth } from "@/context/AuthContext"
import { getDepartmentNames } from "@/services/departaments/departments.service"
import {
    getTrainingCountsByDepartmentForYear,
    getTrainingKpiForYear,
    getTrainingYearsForDatabase,
    getTrainingHoursByRoleForYear,
    type DepartmentTrainingCount,
    type TrainingHoursByDepartment,
    type TrainingHoursByRole,
    type TrainingHoursGroupBy,
    type TrainingHoursGrouped,
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
 * PÃ¡gina de reporte para el plan de formaciÃ³n.
 * Permite filtrar por periodo anual y por Ã¡rea/departamento,
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
    const [hoursByGroup, setHoursByGroup] = useState<TrainingHoursGrouped[]>([])
    const [hoursGroupBy, setHoursGroupBy] = useState<TrainingHoursGroupBy>("role")
    const [selectedAreaForChart, setSelectedAreaForChart] = useState<string | null>(null)
    const [isHoursByGroupLoading, setIsHoursByGroupLoading] = useState<boolean>(false)
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
    const [attendeesProfileMap, setAttendeesProfileMap] = useState<UserProfileMiniCache>({})
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
                console.error("No fue posible cargar los filtros del plan de formaciÃ³n:", error)
            }
        }

        void loadFilters()

        return () => {
            cancelled = true
        }
    }, [database])

    /**
     * Carga el nombre del lÃ­der autenticado (según su perfil en RTDB)
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
                console.error("No fue posible cargar el perfil del lÃ­der para el reporte de formaciÃ³n:", error)
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

    // Exportar a PDF: genera un PDF horizontal nativo (sin html2canvas) con logo,
    // portada + KPIs, gráficos, listado de capacitaciones y detalle de asistentes.
    const handleExportPDF = async () => {
        if (!database) return
        setShowExportMenu(false)

        try {
            // Cargar mapa de perfiles para resolver cargo y departamento
            const profileMiniMap = await loadUsersProfileMiniMap(database)

            // Calcular período y labels
            const periodLabel = (() => {
                if (selectedYear === null) return "Sin período"
                if (periodMode === "month" && typeof selectedMonth === "number") {
                    const monthName = MONTH_LABELS[selectedMonth - 1] ?? "Mes"
                    return `${selectedYear} - ${monthName}`
                }
                return String(selectedYear)
            })()
            const areaLabel = selectedDepartment || "Todas las áreas"
            const fileBaseName = `plan-formacion-${selectedYear ?? "sin-anho"}${periodMode === "month" && typeof selectedMonth === "number" ? "-" + (MONTH_LABELS[selectedMonth - 1] ?? "").toLowerCase().replace(/\s+/g, "-") : ""}${selectedDepartment ? "-" + selectedDepartment.toLowerCase().replace(/\s+/g, "-") : ""}`
            const today = new Date()
            const generatedAt = today.toLocaleString("es-ES", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })

            // Colores (RGB)
            const COLOR_HEADER: [number, number, number] = [27, 48, 34]           // emerald-950
            const COLOR_TEXT: [number, number, number] = [25, 28, 28]             // zinc-900
            const COLOR_TEXT_LIGHT: [number, number, number] = [120, 120, 120]    // gris claro
            const COLOR_ZEBRA: [number, number, number] = [246, 247, 246]         // zinc-50
            const COLOR_BORDER: [number, number, number] = [203, 208, 204]        // gris claro
            const COLOR_DELTA_POS: [number, number, number] = [27, 94, 32]        // verde
            const COLOR_DELTA_NEG: [number, number, number] = [198, 40, 40]       // rojo
            const COLOR_BAR: [number, number, number] = [158, 230, 179]           // emerald-200

            // Crear PDF horizontal (A4 = 297x210mm)
            const pdf = new jsPDF("landscape", "mm", "a4")
            const PAGE_W = pdf.internal.pageSize.getWidth()    // 297
            const PAGE_H = pdf.internal.pageSize.getHeight()   // 210
            const MARGIN = 12
            const CONTENT_W = PAGE_W - MARGIN * 2              // 273
            const CONTENT_BOTTOM = PAGE_H - 14

            // Cargar logo y recortarlo al bounding box del contenido real
            let logoDataUrl: string | null = null
            try {
                const logoRes = await fetch("/Logo-heroica-green.png")
                if (logoRes.ok) {
                    const blob = await logoRes.blob()
                    logoDataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onload = () => resolve(reader.result as string)
                        reader.onerror = reject
                        reader.readAsDataURL(blob)
                    })
                }
            } catch (logoError) {
                console.warn("No se pudo cargar el logo:", logoError)
            }

            // Recortar el PNG al contenido real (object-cover estilo bounding box)
            if (logoDataUrl) {
                try {
                    const img = new Image()
                    await new Promise<void>((resolve, reject) => {
                        img.onload = () => resolve()
                        img.onerror = reject
                        img.src = logoDataUrl ?? "" ;
                    })
                    // Detectar bounding box escaneando el canvas
                    const fullCanvas = document.createElement("canvas")
                    fullCanvas.width = img.naturalWidth
                    fullCanvas.height = img.naturalHeight
                    const fullCtx = fullCanvas.getContext("2d")
                    if (fullCtx) {
                        fullCtx.drawImage(img, 0, 0)
                        const data = fullCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data
                        let top = -1, bottom = -1, left = img.naturalWidth, right = 0
                        for (let y = 0; y < img.naturalHeight; y++) {
                            for (let x = 0; x < img.naturalWidth; x++) {
                                const off = (y * img.naturalWidth + x) * 4
                                const a = data[off + 3]
                                const r = data[off], g = data[off + 1], b = data[off + 2]
                                if (a > 0 && (r < 250 || g < 250 || b < 250)) {
                                    if (top < 0) top = y
                                    bottom = y
                                    if (x < left) left = x
                                    if (x > right) right = x
                                }
                            }
                        }
                        if (top >= 0 && right > left && bottom > top) {
                            const pad = 10 // padding en px para no cortar el borde
                            const cropX = Math.max(0, left - pad)
                            const cropY = Math.max(0, top - pad)
                            const cropW = Math.min(img.naturalWidth - cropX, right - left + 1 + pad * 2)
                            const cropH = Math.min(img.naturalHeight - cropY, bottom - top + 1 + pad * 2)
                            const cropCanvas = document.createElement("canvas")
                            cropCanvas.width = cropW
                            cropCanvas.height = cropH
                            const cropCtx = cropCanvas.getContext("2d")
                            if (cropCtx) {
                                cropCtx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
                                const cropped: string = cropCanvas.toDataURL("image/png")
                                logoDataUrl = cropped
                            }
                        }
                    }
                } catch (cropError) {
                    console.warn("No se pudo recortar el logo, usando original:", cropError)
                }
            }

            // Helpers
            const setFill = (rgb: [number, number, number]) => pdf.setFillColor(rgb[0], rgb[1], rgb[2])
            const setText = (rgb: [number, number, number]) => pdf.setTextColor(rgb[0], rgb[1], rgb[2])
            const setDraw = (rgb: [number, number, number]) => pdf.setDrawColor(rgb[0], rgb[1], rgb[2])
            const WHITE: [number, number, number] = [255, 255, 255]

            // Estado del cursor
            let cursorY = MARGIN
            let pageNumber = 1

            const drawHeader = (): void => {
                if (logoDataUrl) {
                    const logoW = 42
                    const props = pdf.getImageProperties(logoDataUrl)
                    const ratio = props.width / props.height
                    const logoH = logoW / ratio
                    pdf.addImage(logoDataUrl, "PNG", MARGIN, MARGIN - 2, logoW, logoH)
                }
                pdf.setFont("helvetica", "bold")
                pdf.setFontSize(16)
                setText(COLOR_TEXT)
                pdf.text("Plan de Formación", PAGE_W - MARGIN, MARGIN + 2, { align: "right" })
                pdf.setFont("helvetica", "normal")
                pdf.setFontSize(9)
                setText(COLOR_TEXT_LIGHT)
                pdf.text(`Período: ${periodLabel}  ·  Área: ${areaLabel}`, PAGE_W - MARGIN, MARGIN + 8, { align: "right" })
                setDraw(COLOR_BORDER)
                pdf.setLineWidth(0.3)
                pdf.line(MARGIN, MARGIN + 12, PAGE_W - MARGIN, MARGIN + 12)
            }

            const drawFooter = (): void => {
                pdf.setFont("helvetica", "normal")
                pdf.setFontSize(8)
                setText(COLOR_TEXT_LIGHT)
                pdf.text(`Generado el ${generatedAt}`, MARGIN, PAGE_H - 6)
                pdf.text(`Página ${pageNumber}`, PAGE_W - MARGIN, PAGE_H - 6, { align: "right" })
            }

            const ensureSpace = (needed: number): void => {
                if (cursorY + needed > CONTENT_BOTTOM) {
                    drawFooter()
                    pdf.addPage("a4", "landscape")
                    pageNumber++
                    drawHeader()
                    cursorY = MARGIN + 16
                }
            }

            const drawSectionTitle = (title: string): void => {
                ensureSpace(12)
                setFill(COLOR_HEADER)
                pdf.rect(MARGIN, cursorY, CONTENT_W, 8, "F")
                pdf.setFont("helvetica", "bold")
                pdf.setFontSize(10)
                setText(WHITE)
                pdf.text(title, MARGIN + 2, cursorY + 5.5)
                cursorY += 10
            }

            const drawTableHeader = (cols: { label: string; width: number; align?: "left" | "center" | "right" }[]): void => {
                ensureSpace(9)
                setFill(COLOR_HEADER)
                pdf.rect(MARGIN, cursorY, CONTENT_W, 7, "F")
                pdf.setFont("helvetica", "bold")
                pdf.setFontSize(8)
                setText(WHITE)
                let x = MARGIN
                cols.forEach((col) => {
                    const align = col.align ?? "left"
                    const textX = align === "left" ? x + 1.5 : align === "right" ? x + col.width - 1.5 : x + col.width / 2
                    pdf.text(col.label, textX, cursorY + 5, { align })
                    x += col.width
                })
                cursorY += 7
            }

            const drawTableRow = (
                cells: { text: string; align?: "left" | "center" | "right" }[],
                cols: { width: number }[],
                isZebra: boolean,
            ): void => {
                const rowH = 6
                if (isZebra) {
                    setFill(COLOR_ZEBRA)
                    pdf.rect(MARGIN, cursorY, CONTENT_W, rowH, "F")
                }
                pdf.setFont("helvetica", "normal")
                pdf.setFontSize(8)
                setText(COLOR_TEXT)
                let x = MARGIN
                cells.forEach((cell, i) => {
                    const align = cell.align ?? "left"
                    const colW = cols[i].width
                    const textW = colW - 3
                    const textX = align === "left" ? x + 1.5 : align === "right" ? x + colW - 1.5 : x + colW / 2
                    const raw = cell.text
                    const linesArr = pdf.splitTextToSize(raw, textW) as string[]
                    let finalText = linesArr[0] ?? ""
                    if (linesArr.length > 1) {
                        while (finalText.length > 0 && pdf.getTextWidth(finalText + "...") > textW) {
                            finalText = finalText.slice(0, -1)
                        }
                        finalText = finalText + "..."
                    } else if (pdf.getTextWidth(finalText) > textW) {
                        while (finalText.length > 0 && pdf.getTextWidth(finalText + "...") > textW) {
                            finalText = finalText.slice(0, -1)
                        }
                        finalText = finalText + "..."
                    }
                    pdf.text(finalText, textX, cursorY + 4, { align })
                    x += colW
                })
                cursorY += rowH
            }

            const drawTableEnd = (): void => {
                setDraw(COLOR_BORDER)
                pdf.setLineWidth(0.2)
                pdf.line(MARGIN, cursorY, PAGE_W - MARGIN, cursorY)
                cursorY += 4
            }

            // ====================================================
            // PÁGINA 1: Portada + KPIs
            // ====================================================
            drawHeader()
            cursorY = MARGIN + 16

            // Bloque de KPIs en formato 2x2
            const kpiCols: { label: string; value: string; sub: string; delta: number | null }[] = [
                { label: "Total de Capacitaciones", value: String(totalTrainings), sub: "Actividades en el período", delta: trainingsDeltaPct },
                { label: "Total de Horas", value: formatHours(totalHours), sub: "Horas acumuladas", delta: hoursDeltaPct },
                { label: "Total de Asistencias", value: String(totalAttended), sub: "Presentes + tarde", delta: attendedDeltaPct },
                { label: "Promedio de Satisfacción", value: avgSatisfaction !== null ? avgSatisfaction.toFixed(1) : "—", sub: "Sobre 5", delta: satisfactionDeltaPct },
            ]
            const kpiBoxW = (CONTENT_W - 4) / 2
            const kpiBoxH = 26
            kpiCols.forEach((kpi, i) => {
                const col = i % 2
                const row = Math.floor(i / 2)
                const x = MARGIN + col * (kpiBoxW + 4)
                const y = MARGIN + 16 + row * (kpiBoxH + 4)
                setDraw(COLOR_BORDER)
                pdf.setLineWidth(0.3)
                pdf.rect(x, y, kpiBoxW, kpiBoxH)
                pdf.setFont("helvetica", "bold")
                pdf.setFontSize(8)
                setText(COLOR_TEXT_LIGHT)
                pdf.text(kpi.label.toUpperCase(), x + 3, y + 5)
                pdf.setFont("helvetica", "bold")
                pdf.setFontSize(22)
                setText(COLOR_HEADER)
                pdf.text(kpi.value, x + 3, y + 16)
                pdf.setFont("helvetica", "normal")
                pdf.setFontSize(7)
                setText(COLOR_TEXT_LIGHT)
                pdf.text(kpi.sub, x + 3, y + 22)
                if (kpi.delta !== null) {
                    const deltaText = `${kpi.delta >= 0 ? "+" : ""}${kpi.delta.toFixed(0)}% vs ${selectedYear !== null ? selectedYear - 1 : ""}`
                    setFill(kpi.delta >= 0 ? COLOR_DELTA_POS : COLOR_DELTA_NEG)
                    const badgeW = pdf.getTextWidth(deltaText) + 4
                    pdf.rect(x + kpiBoxW - badgeW - 3, y + 2, badgeW, 5, "F")
                    pdf.setFont("helvetica", "bold")
                    pdf.setFontSize(7)
                    setText(WHITE)
                    pdf.text(deltaText, x + kpiBoxW - badgeW / 2 - 3, y + 5.5, { align: "center" })
                }
            })
            cursorY = MARGIN + 16 + 2 * (kpiBoxH + 4) + 6

            // Calcular tasa de asistencia global a partir de los trainings
            let totalInvited = 0
            let totalPresent = 0
            for (const t of trainings) {
                for (const p of t.participants) {
                    if (p.noShow) continue
                    if (p.attendance === "absent") continue
                    totalInvited++
                    if (p.attendance === "present" || p.attendance === "late") totalPresent++
                }
            }
            const attendanceRate = totalInvited > 0 ? Math.round((totalPresent * 100) / totalInvited) : 0

            // Resumen ejecutivo
            ensureSpace(30)
            drawSectionTitle("Resumen Ejecutivo")
            const introText = areaLabel !== "Todas las áreas"
                ? `Este reporte muestra el detalle del plan de formación para el área "${areaLabel}" durante ${periodLabel.toLowerCase()}. Tasa de asistencia global: ${attendanceRate}%.`
                : `Este reporte muestra el detalle del plan de formación de ${periodLabel.toLowerCase()}. Tasa de asistencia global: ${attendanceRate}%.`
            pdf.setFont("helvetica", "normal")
            pdf.setFontSize(9)
            setText(COLOR_TEXT)
            const introLines = pdf.splitTextToSize(introText, CONTENT_W)
            introLines.forEach((line: string) => {
                ensureSpace(5)
                pdf.text(line, MARGIN, cursorY + 4)
                cursorY += 5
            })
            cursorY += 4

            // ====================================================
            // PÁGINAS SIGUIENTES: Gráficos
            // ====================================================
            drawFooter()
            pdf.addPage("a4", "landscape")
            pageNumber++
            drawHeader()
            cursorY = MARGIN + 16

            // Gráfico: Capacitaciones por Área
            drawSectionTitle("Capacitaciones por Área")
            const maxTrainingsArea = departmentTrainingCounts.reduce((m, i) => Math.max(m, i.trainings), 0)
            const trainingsLabelW = 80
            const trainingsValueW = 18
            const trainingsBarMaxW = (CONTENT_W - trainingsLabelW - trainingsValueW - 4) * 0.5
            departmentTrainingCounts.forEach((item, i) => {
                ensureSpace(7)
                drawTableRow(
                    [
                        { text: item.department, align: "left" },
                        { text: String(item.trainings), align: "right" },
                        { text: "", align: "left" },
                    ],
                    [
                        { width: trainingsLabelW },
                        { width: trainingsValueW },
                        { width: trainingsBarMaxW + 4 },
                    ],
                    i % 2 === 1,
                )
                const barY = cursorY - 4.5
                const barW = maxTrainingsArea > 0 ? Math.max(2, (item.trainings / maxTrainingsArea) * trainingsBarMaxW) : 0
                setFill(COLOR_BAR)
                pdf.rect(MARGIN + trainingsLabelW + trainingsValueW + 4, barY, barW, 1.5, "F")
            })
            drawTableEnd()
            cursorY += 4

            // Gráfico: Horas por Cargo/Área
            const hoursTitle = hoursGroupBy === "role" ? "Horas por Cargo" : "Horas por Área"
            drawSectionTitle(`${hoursTitle} (${periodLabel})`)
            const maxHours = hoursByGroup.reduce((m, i) => Math.max(m, i.hours), 0)
            const hoursLabelW = hoursGroupBy === "role" ? 90 : 80
            const hoursValueW = 25
            const hoursBarMaxW = (CONTENT_W - hoursLabelW - hoursValueW - 4) * 0.5
            hoursByGroup.forEach((item, i) => {
                ensureSpace(7)
                const label = hoursGroupBy === "role"
                    ? (item as TrainingHoursByRole).role
                    : (item as TrainingHoursByDepartment).department
                drawTableRow(
                    [
                        { text: label, align: "left" },
                        { text: `${formatHours(item.hours)} h`, align: "right" },
                        { text: "", align: "left" },
                    ],
                    [
                        { width: hoursLabelW },
                        { width: hoursValueW },
                        { width: hoursBarMaxW + 4 },
                    ],
                    i % 2 === 1,
                )
                const barY = cursorY - 4.5
                const barW = maxHours > 0 ? Math.max(2, (item.hours / maxHours) * hoursBarMaxW) : 0
                setFill(COLOR_BAR)
                pdf.rect(MARGIN + hoursLabelW + hoursValueW + 4, barY, barW, 1.5, "F")
            })
            drawTableEnd()

            // ====================================================
            // LISTADO DE CAPACITACIONES
            // ====================================================
            drawFooter()
            pdf.addPage("a4", "landscape")
            pageNumber++
            drawHeader()
            cursorY = MARGIN + 16

            drawSectionTitle("Listado de Capacitaciones")
            const listCols = [
                { label: "Capacitación", width: 78, align: "left" as const },
                { label: "Área(s)", width: 48, align: "left" as const },
                { label: "Fecha", width: 24, align: "left" as const },
                { label: "Horas", width: 16, align: "right" as const },
                { label: "Asistentes", width: 22, align: "right" as const },
                { label: "Capacitador", width: 45, align: "left" as const },
            ]
            const listWidth = listCols.reduce((s, c) => s + c.width, 0)
            if (listWidth < CONTENT_W) {
                listCols[listCols.length - 1].width += CONTENT_W - listWidth
            }
            drawTableHeader(listCols)
            trainings.forEach((training, i) => {
                const { meeting, trainer, participants, areas } = training
                const areaStr = areas.length > 0 ? areas.join(", ") : "-"
                const hours = getTrainingHours(meeting.startTime, meeting.endTime)
                const dateStr = new Date(meeting.startTime).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
                const attendees = participants.filter((p) =>
                    (p.attendance === "present" || p.attendance === "late") && !p.noShow,
                ).length
                drawTableRow(
                    [
                        { text: meeting.title, align: "left" },
                        { text: areaStr, align: "left" },
                        { text: dateStr, align: "left" },
                        { text: formatHours(hours), align: "right" },
                        { text: String(attendees), align: "right" },
                        { text: trainer ?? "-", align: "left" },
                    ],
                    listCols.map((c) => ({ width: c.width })),
                    i % 2 === 1,
                )
            })
            drawTableEnd()

            // ====================================================
            // DETALLE DE ASISTENTES
            // ====================================================
            drawFooter()
            pdf.addPage("a4", "landscape")
            pageNumber++
            drawHeader()
            cursorY = MARGIN + 16

            drawSectionTitle("Detalle de Asistentes")
            const detailCols = [
                { label: "Capacitación", width: 60, align: "left" as const },
                { label: "Fecha", width: 22, align: "left" as const },
                { label: "Asistente", width: 48, align: "left" as const },
                { label: "Área", width: 38, align: "left" as const },
                { label: "Cargo", width: 50, align: "left" as const },
                { label: "Estado", width: 55, align: "center" as const },
            ]
            const detailWidth = detailCols.reduce((s, c) => s + c.width, 0)
            if (detailWidth < CONTENT_W) {
                detailCols[detailCols.length - 1].width += CONTENT_W - detailWidth
            }
            drawTableHeader(detailCols)
            let detailRowIdx = 0
            for (const training of trainings) {
                const { meeting, participants, areas } = training
                const areaStr = areas.length > 0 ? areas.join(", ") : "-"
                const dateStr = new Date(meeting.startTime).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
                const asistentes = participants.filter((p) =>
                    (p.attendance === "present" || p.attendance === "late") && !p.noShow,
                )
                if (asistentes.length === 0) {
                    ensureSpace(6)
                    drawTableRow(
                        [
                            { text: meeting.title, align: "left" },
                            { text: dateStr, align: "left" },
                            { text: "Sin asistentes", align: "left" },
                            { text: areaStr, align: "left" },
                            { text: "-", align: "left" },
                            { text: "-", align: "center" },
                        ],
                        detailCols.map((c) => ({ width: c.width })),
                        detailRowIdx % 2 === 1,
                    )
                    detailRowIdx++
                } else {
                    for (const p of asistentes) {
                        const profile = profileMiniMap[p.uid]
                        const cargo = profile?.cargo?.trim() || "-"
                        const dept = profile?.department?.trim() || "-"
                        const estado = p.attendance === "late" ? "Tarde" : "Presente"
                        ensureSpace(6)
                        drawTableRow(
                            [
                                { text: meeting.title, align: "left" },
                                { text: dateStr, align: "left" },
                                { text: p.name, align: "left" },
                                { text: dept, align: "left" },
                                { text: cargo, align: "left" },
                                { text: estado, align: "center" },
                            ],
                            detailCols.map((c) => ({ width: c.width })),
                            detailRowIdx % 2 === 1,
                        )
                        detailRowIdx++
                    }
                }
            }
            drawTableEnd()

            drawFooter()
            pdf.save(`${fileBaseName}.pdf`)
        } catch (exportError) {
            console.error('Error al exportar PDF:', exportError)
        }
    }

    // Exportar a Excel: genera un archivo con varias hojas siguiendo el diseño de la página.
    const handleExportExcel = async () => {
        if (!database) return

        setShowExportMenu(false)

        // Cargar mapa de perfiles para resolver cargo y departamento
        const profileMiniMap = await loadUsersProfileMiniMap(database)

        // Calcular período y labels para headers
        const periodLabel = (() => {
            if (selectedYear === null) return "Sin período"
            if (periodMode === "month" && typeof selectedMonth === "number") {
                const monthName = MONTH_LABELS[selectedMonth - 1] ?? "Mes"
                return `${selectedYear} - ${monthName}`
            }
            return String(selectedYear)
        })()
        const areaLabel = selectedDepartment || "Todas las áreas"
        const fileBaseName = `plan-formacion-${selectedYear ?? "sin-anho"}${periodMode === "month" && typeof selectedMonth === "number" ? "-" + (MONTH_LABELS[selectedMonth - 1] ?? "").toLowerCase().replace(/\s+/g, "-") : ""}${selectedDepartment ? "-" + selectedDepartment.toLowerCase().replace(/\s+/g, "-") : ""}`

        // Estilos compartidos
        const borderThin = {
            top: { style: "thin" as const, color: { argb: "FFCBD0CC" } },
            left: { style: "thin" as const, color: { argb: "FFCBD0CC" } },
            bottom: { style: "thin" as const, color: { argb: "FFCBD0CC" } },
            right: { style: "thin" as const, color: { argb: "FFCBD0CC" } },
        }
        const titleStyle = { font: { bold: true, size: 16, color: { argb: "FF1B3022" } } }
        const subtitleStyle = { font: { italic: true, size: 10, color: { argb: "FF5F6560" } } }
        const sectionStyle = {
            font: { bold: true, size: 12, color: { argb: "FFFFFFFF" } },
            fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1B3022" } },
            alignment: { horizontal: "left" as const, vertical: "middle" as const },
            border: borderThin,
        }
        const headerStyle = {
            font: { bold: true, size: 11, color: { argb: "FFFFFFFF" } },
            fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1B3022" } },
            alignment: { horizontal: "center" as const, vertical: "middle" as const, wrapText: true },
            border: borderThin,
        }
        const cellBorder = borderThin
        const baseCell = { border: cellBorder, alignment: { vertical: "middle" as const } }
        const zebraCell = { ...baseCell, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF6F7F6" } } }
        // Crear el workbook
        const wb = new ExcelJS.Workbook()
        wb.creator = "Plan de Formación"
        wb.created = new Date()

        // ============================================
        // HOJA 1: Plan de Formación (lista plana por asistente)
        // ============================================
        const wsMain = wb.addWorksheet("Plan de Formación")
        // Anchos de columna
        wsMain.columns = [
            { width: 38 }, // Capacitación
            { width: 14 }, // Fecha
            { width: 24 }, // Área(s)
            { width: 8 },  // Horas
            { width: 28 }, // Asistente
            { width: 22 }, // Área asistente
            { width: 26 }, // Cargo
            { width: 12 }, // Asistencia
            { width: 26 }, // Capacitador
        ]

        // Fila 1: título
        wsMain.addRow(["Plan de Formación"])
        wsMain.mergeCells("A1:I1")
        wsMain.getCell("A1").style = titleStyle
        wsMain.getRow(1).height = 28

        // Fila 2: período
        wsMain.addRow([`Período: ${periodLabel}`])
        wsMain.mergeCells("A2:I2")
        wsMain.getCell("A2").style = subtitleStyle

        // Fila 3: área
        wsMain.addRow([`Área: ${areaLabel}`])
        wsMain.mergeCells("A3:I3")
        wsMain.getCell("A3").style = subtitleStyle

        // Fila 4: vacía
        wsMain.addRow([])

        // Fila 5: header de tabla
        const headerRow = wsMain.addRow([
            "Capacitación", "Fecha", "Área(s)", "Horas", "Asistente",
            "Área asistente", "Cargo", "Asistencia", "Capacitador"
        ])
        headerRow.eachCell((cell) => {
            cell.style = headerStyle
        })
        headerRow.height = 22

        // Filas de datos
        let dataRowIdx = 6
        for (const { meeting, trainer, participants, areas } of trainings) {
            const areaStr = areas.length > 0 ? areas.join(", ") : "-"
            const hours = getTrainingHours(meeting.startTime, meeting.endTime)
            const dateStr = new Date(meeting.startTime).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
            const asistentes = participants.filter((p) =>
                (p.attendance === "present" || p.attendance === "late") && !p.noShow,
            )
            for (const p of asistentes) {
                const profile = profileMiniMap[p.uid]
                const cargo = profile?.cargo?.trim() || ""
                const deptAsistente = profile?.department?.trim() || ""
                const row = wsMain.addRow([
                    meeting.title,
                    dateStr,
                    areaStr,
                    hours,
                    p.name,
                    deptAsistente,
                    cargo,
                    p.attendance === "late" ? "Tarde" : (p.attendance === "present" ? "Presente" : "-"),
                    trainer ?? "-",
                ])
                // Zebra: la primera fila de datos (dataRowIdx=6) no es zebra, las siguientes sí
                const isZebra = (dataRowIdx - 6) % 2 === 1
                row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                    const baseStyle = isZebra ? zebraCell : baseCell
                    cell.style = colNumber === 1
                        ? { ...baseStyle, font: { bold: true } }
                        : baseStyle
                })
                dataRowIdx++
            }
        }

        // ============================================
        // HOJA 2: Resumen (KPIs + gráficos)
        // ============================================
        const wsSummary = wb.addWorksheet("Resumen")
        wsSummary.columns = [
            { width: 32 },
            { width: 18 },
            { width: 30 },
        ]

        // Fila 1: título
        wsSummary.addRow(["Resumen Ejecutivo"])
        wsSummary.mergeCells("A1:C1")
        wsSummary.getCell("A1").style = titleStyle
        wsSummary.getRow(1).height = 28

        // Fila 2: período + área
        wsSummary.addRow([`Período: ${periodLabel} · Área: ${areaLabel}`])
        wsSummary.mergeCells("A2:C2")
        wsSummary.getCell("A2").style = subtitleStyle

        // Fila 3: vacía
        wsSummary.addRow([])

        // Fila 4: sección "Indicadores Clave"
        const kpiHeaderRow = wsSummary.addRow(["Indicadores Clave", "", ""])
        wsSummary.mergeCells("A4:C4")
        kpiHeaderRow.eachCell((cell) => {
            cell.style = sectionStyle
        })

        // Fila 5: header de columnas
        const kpiColHeaderRow = wsSummary.addRow(["Indicador", "Valor", "Variación vs año anterior"])
        kpiColHeaderRow.eachCell((cell) => {
            cell.style = headerStyle
        })

        // Filas 6-9: KPIs
        const previousYear = selectedYear !== null ? selectedYear - 1 : null
        const fmtDelta = (delta: number | null) => delta === null
            ? "Sin datos previos"
            : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}% vs ${previousYear}`
        const kpiRows = [
            ["Total de Capacitaciones", totalTrainings, fmtDelta(trainingsDeltaPct)],
            ["Total de Horas", Number(formatHours(totalHours)), fmtDelta(hoursDeltaPct)],
            ["Total de Asistencias", totalAttended, fmtDelta(attendedDeltaPct)],
            ["Promedio de Satisfacción", avgSatisfaction !== null ? Number(avgSatisfaction.toFixed(2)) : "-", fmtDelta(satisfactionDeltaPct)],
        ]
        kpiRows.forEach((kpiData, i) => {
            const r = wsSummary.addRow(kpiData)
            const isZebra = i % 2 === 1
            r.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                const baseStyle = isZebra ? zebraCell : baseCell
                cell.style = colNumber === 1
                    ? { ...baseStyle, font: { bold: true } }
                    : baseStyle
            })
        })

        // Fila vacía
        wsSummary.addRow([])

        // Sección "Capacitaciones por Área"
        const areaSectionRow = wsSummary.addRow(["Capacitaciones por Área", "", ""])
        wsSummary.mergeCells(`A${areaSectionRow.number}:C${areaSectionRow.number}`)
        areaSectionRow.eachCell((cell) => {
            cell.style = sectionStyle
        })

        // Header de columnas
        const areaColHeaderRow = wsSummary.addRow(["Área", "Capacitaciones", ""])
        wsSummary.mergeCells(`B${areaColHeaderRow.number}:C${areaColHeaderRow.number}`)
        areaColHeaderRow.eachCell((cell) => {
            cell.style = headerStyle
        })

        // Filas de datos
        departmentTrainingCounts.forEach((item, i) => {
            const r = wsSummary.addRow([item.department, item.trainings, ""])
            const isZebra = i % 2 === 1
            r.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                const baseStyle = isZebra ? zebraCell : baseCell
                cell.style = colNumber === 1
                    ? { ...baseStyle, font: { bold: true } }
                    : baseStyle
            })
        })

        // Fila vacía
        wsSummary.addRow([])

        // Sección "Horas por Cargo/Área"
        const hoursTitle = hoursGroupBy === "role" ? "Horas por Cargo" : "Horas por Área"
        const hoursCol = hoursGroupBy === "role" ? "Cargo" : "Área"
        const hoursSectionRow = wsSummary.addRow([hoursTitle, "", ""])
        wsSummary.mergeCells(`A${hoursSectionRow.number}:C${hoursSectionRow.number}`)
        hoursSectionRow.eachCell((cell) => {
            cell.style = sectionStyle
        })

        const hoursColHeaderRow = wsSummary.addRow([hoursCol, "Horas", ""])
        wsSummary.mergeCells(`B${hoursColHeaderRow.number}:C${hoursColHeaderRow.number}`)
        hoursColHeaderRow.eachCell((cell) => {
            cell.style = headerStyle
        })

        hoursByGroup.forEach((item, i) => {
            const label = hoursGroupBy === "role"
                ? (item as TrainingHoursByRole).role
                : (item as TrainingHoursByDepartment).department
            const r = wsSummary.addRow([label, Number(formatHours(item.hours)), ""])
            const isZebra = i % 2 === 1
            r.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                const baseStyle = isZebra ? zebraCell : baseCell
                cell.style = colNumber === 1
                    ? { ...baseStyle, font: { bold: true } }
                    : baseStyle
            })
        })

        // ============================================
        // HOJA 3: Listado de Capacitaciones
        // ============================================
        const wsList = wb.addWorksheet("Listado de Capacitaciones")
        wsList.columns = [
            { width: 38 },
            { width: 24 },
            { width: 14 },
            { width: 8 },
            { width: 20 },
            { width: 26 },
        ]

        wsList.addRow(["Listado de Capacitaciones"])
        wsList.mergeCells("A1:F1")
        wsList.getCell("A1").style = titleStyle
        wsList.getRow(1).height = 28

        wsList.addRow([`Período: ${periodLabel} · Área: ${areaLabel}`])
        wsList.mergeCells("A2:F2")
        wsList.getCell("A2").style = subtitleStyle

        wsList.addRow([])

        const listHeaderRow = wsList.addRow([
            "Capacitación", "Área(s)", "Fecha", "Horas", "Asistentes (presentes/tarde)", "Capacitador"
        ])
        listHeaderRow.eachCell((cell) => {
            cell.style = headerStyle
        })
        listHeaderRow.height = 22

        trainings.forEach((training, i) => {
            const { meeting, trainer, participants, areas } = training
            const areaStr = areas.length > 0 ? areas.join(", ") : "-"
            const hours = getTrainingHours(meeting.startTime, meeting.endTime)
            const dateStr = new Date(meeting.startTime).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
            const attendees = participants.filter((p) =>
                (p.attendance === "present" || p.attendance === "late") && !p.noShow,
            ).length
            const r = wsList.addRow([meeting.title, areaStr, dateStr, hours, attendees, trainer ?? "-"])
            const isZebra = i % 2 === 1
            r.eachCell({ includeEmpty: false }, (cell) => {
                cell.style = isZebra ? zebraCell : baseCell
            })
        })

        // ============================================
        // Generar y descargar el archivo
        // ============================================
        const buffer = await wb.xlsx.writeBuffer()
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `${fileBaseName}.xlsx`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
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
            setHoursByGroup([])
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
            setHoursByGroup([])
            setTrainings([])
            setAvgSatisfaction(null)
            setSatisfactionDeltaPct(null)
            setTableSearch("")
            return
        }

        // Para lÃ­deres, si no tenemos su nombre, no podemos filtrar colaboradores de forma segura.
        // En ese caso devolvemos un estado vacÃ­o hasta que el perfil estÃ© disponible.
        if (isTeamScoped && (!leaderName || leaderName.trim().length === 0)) {
            setTotalTrainings(0)
            setTotalHours(0)
            setTotalAttended(0)
            setTrainingsDeltaPct(null)
            setHoursDeltaPct(null)
            setAttendedDeltaPct(null)
            setDepartmentTrainingCounts([])
            setSelectedAreaForChart(null)
            setHoursByGroup([])
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

            const [currentKpi, previousKpi, rawDepartmentCounts, hoursByGroupForYear, trainingsList, trainingsListPrevious] = await Promise.all([
                getTrainingKpiForYear(database, selectedYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForCurrent),
                getTrainingKpiForYear(database, previousYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForPrevious),
                getTrainingCountsByDepartmentForYear(database, selectedYear, effectiveLeaderName, effectiveLeaderUid, monthForCurrent),
                // "Horas por cargo/área" respeta el filtro de área seleccionado arriba
                getTrainingHoursByRoleForYear(database, selectedYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForCurrent, hoursGroupBy),
                getTrainingsWithParticipants(database, selectedYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForCurrent),
                getTrainingsWithParticipants(database, previousYear, selectedDepartment || null, effectiveLeaderName, effectiveLeaderUid, monthForPrevious),
            ]) as [
                    TrainingKpiSummary,
                    TrainingKpiSummary,
                    DepartmentTrainingCount[],
                    TrainingHoursGrouped[],
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
            // Reiniciamos la selecciÃ³n de Ã¡rea para el grÃ¡fico de horas por cargo
            setSelectedAreaForChart(null)
            setHoursByGroup(hoursByGroupForYear)
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
            console.error("No fue posible cargar los KPIs del plan de formaciÃ³n:", error)
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
        hoursGroupBy,
    ])

    /**
     * Al ingresar a la pÃ¡gina, genera automÃ¡ticamente el plan
     * para el ciclo actual (aÃ±o seleccionado por defecto) sin
     * que el usuario tenga que pulsar el botÃ³n.
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
     * Maneja la selecciÃ³n de un Ã¡rea/departamento desde la tarjeta
     * "Capacitaciones por Ãrea" para actualizar el grÃ¡fico dependiente
     * de "Horas por cargo".
     *
     * Por defecto el grÃ¡fico muestra el agregado de todas las Ã¡reas.
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

        setIsHoursByGroupLoading(true)
        void (async () => {
            try {
                const hoursForSelection = await getTrainingHoursByRoleForYear(
                    database,
                    selectedYear,
                    departmentName,
                    effectiveLeaderName,
                    effectiveLeaderUid,
                    monthForCurrent,
                    hoursGroupBy,
                )
                setHoursByGroup(hoursForSelection)
            } catch (error) {
                console.error("No fue posible cargar las horas para el departamento seleccionado:", error)
                setHoursByGroup([])
            } finally {
                setIsHoursByGroupLoading(false)
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
     * Carga también el mapa de perfiles (cargo + área) para mostrarlos en el modal.
     */
    const handleOpenAttendeesModal = async (training: TrainingWithParticipants): Promise<void> => {
        setSelectedTrainingForModal(training)
        setIsAttendeesModalOpen(true)
        if (!database) {
            return
        }
        try {
            const map = await loadUsersProfileMiniMap(database)
            setAttendeesProfileMap(map)
        } catch (error) {
            console.error("No fue posible cargar el perfil de los asistentes:", error)
            setAttendeesProfileMap({})
        }
    }

    /**
     * Cierra el modal de asistentes y limpia la capacitación seleccionada.
     */
    const handleCloseAttendeesModal = (): void => {
        setIsAttendeesModalOpen(false)
        setSelectedTrainingForModal(null)
        setAttendeesProfileMap({})
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

                            {/* kpi de promedio de satisfacciÃ³n */}
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
                                        avgSatisfaction !== null ? avgSatisfaction.toFixed(1) : "â€”"
                                    )}
                                </p>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Promedio de SatisfacciÃ³n</p>
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
                                             * Determina el número máximo de capacitaciones entre todos los áreas
                                             * para poder escalar las barras de distribución de forma proporcional.
                                             */
                                            const maxTrainings = departmentTrainingCounts.reduce<number>((max, item) => {
                                                return item.trainings > max ? item.trainings : max
                                            }, 0)

                                            return departmentTrainingCounts.map((item) => {
                                                /**
                                                 * Calcula el ancho de la barra para el departamento actual en funciÃ³n
                                                 * de sus capacitaciones respecto al mÃ¡ximo del conjunto. Se garantiza un
                                                 * ancho mÃ­nimo del 6% para que las barras con pocos registros sigan siendo visibles.
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
                                <div className="flex justify-between items-start gap-3 mb-6">
                                    <div>
                                        <h3 className="text-xl font-bold text-white">
                                            {hoursGroupBy === "role" ? "Horas por cargo" : "Horas por área"}
                                        </h3>
                                        <p className="text-xs text-outline font-medium text-[#819986]">
                                            {hoursGroupBy === "role"
                                                ? "Intensidad formativa por cargo"
                                                : "Intensidad formativa por área"}
                                        </p>
                                    </div>
                                    <div className="inline-flex rounded-full bg-[#243a2c] p-1 text-[10px] font-semibold">
                                        <button
                                            type="button"
                                            aria-pressed={hoursGroupBy === "role"}
                                            onClick={() => setHoursGroupBy("role")}
                                            className={`px-3 py-1 rounded-full transition-colors ${
                                                hoursGroupBy === "role"
                                                    ? "bg-[#9ee6b3] text-[#1b3022]"
                                                    : "text-[#dbe7dd] hover:text-white"
                                            }`}
                                        >
                                            Por cargo
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={hoursGroupBy === "department"}
                                            onClick={() => setHoursGroupBy("department")}
                                            className={`px-3 py-1 rounded-full transition-colors ${
                                                hoursGroupBy === "department"
                                                    ? "bg-[#9ee6b3] text-[#1b3022]"
                                                    : "text-[#dbe7dd] hover:text-white"
                                            }`}
                                        >
                                            Por área
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-6">
                                    {isHoursByGroupLoading ? (
                                        <div
                                            className="space-y-3"
                                            role="status"
                                            aria-live="polite"
                                            aria-busy="true"
                                        >
                                            <span className="sr-only">Cargando horas por {hoursGroupBy === "role" ? "cargo" : "área"}</span>
                                            {[1, 2, 3, 4].map((row) => (
                                                <div key={row} className="space-y-1.5">
                                                    <div className="flex items-center gap-3">
                                                        <span className="h-3 w-32 bg-[#243a2c] rounded animate-pulse" />
                                                        <span className="h-3 w-12 bg-[#243a2c] rounded animate-pulse" />
                                                    </div>
                                                    <div className="h-2.5 w-full bg-[#243a2c] rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-[#9ee6b3]/30 rounded-full animate-pulse"
                                                            style={{ width: `${100 - row * 18}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (() => {
                                        const filteredHoursByGroup = hoursByGroup

                                        if (filteredHoursByGroup.length === 0) {
                                            return (
                                                <p className="text-xs text-[#dbe7dd]">
                                                    No hay horas registradas para el periodo y filtro seleccionados.
                                                </p>
                                            )
                                        }

                                        const maxHours = filteredHoursByGroup.reduce<number>((max, item) => {
                                            return item.hours > max ? item.hours : max
                                        }, 0)

                                        const areaLabel = selectedAreaForChart || (selectedDepartment || null)

                                        return (
                                            <>
                                                <p className="text-xs text-[#dbe7dd]">
                                                    {hoursGroupBy === "role" ? "Horas por cargo" : "Horas por área"} del año
                                                    <span className="font-semibold"> {selectedYear}</span>
                                                    {areaLabel && (
                                                        <>
                                                            <span> Área </span>
                                                            <span className="font-semibold">{areaLabel}</span>
                                                        </>
                                                    )}
                                                </p>
                                                <div className="space-y-3">
                                                    {filteredHoursByGroup.map((item) => {
                                                        const label = hoursGroupBy === "role"
                                                            ? (item as TrainingHoursByRole).role
                                                            : (item as TrainingHoursByDepartment).department
                                                        const widthPercentage = maxHours > 0
                                                            ? Math.max(6, (item.hours / maxHours) * 100)
                                                            : 0

                                                        return (
                                                            <div key={label} className="space-y-1">
                                                                <div className="flex items-center gap-3 text-[11px] font-medium text-[#e2efe4]">
                                                                    <span className="flex-1 truncate" title={label}>{label}</span>
                                                                    <span className="font-semibold tabular-nums text-white bg-[#243a2c] px-2 py-0.5 rounded">
                                                                        {formatHours(item.hours)} h
                                                                    </span>
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
                                        <span className="uppercase tracking-widest font-bold">DirecciÃ³n</span>
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
                                                                onClick={() => { void handleOpenAttendeesModal(training) }}
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
                                        {" Â· "}
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
                                            {attendeesForSelectedTraining.map((participant) => {
                                                const profile = attendeesProfileMap[participant.uid]
                                                const cargoLabel = profile?.cargo?.trim() || "Sin cargo"
                                                const deptLabel = profile?.department?.trim() || "Sin área"
                                                return (
                                                    <li
                                                        key={participant.uid}
                                                        className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-[#f6f7f6]"
                                                    >
                                                        <div className="flex items-start gap-3 flex-1 min-w-0">
                                                            <div className="w-8 h-8 shrink-0 rounded-full bg-[#d6e3d5] flex items-center justify-center text-xs font-bold text-[#1b3022]">
                                                                {participant.name
                                                                    .split(" ")
                                                                    .filter((part) => part.length > 0)
                                                                    .slice(0, 2)
                                                                    .map((part) => part[0]?.toUpperCase())
                                                                    .join("")}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-semibold text-[#191c1c] leading-tight truncate">{participant.name}</p>
                                                                {participant.email && (
                                                                    <p className="text-[11px] text-slate-500 leading-tight truncate">{participant.email}</p>
                                                                )}
                                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#434843] bg-white border border-[#edeeed] px-2 py-0.5 rounded">
                                                                        <span className="text-[#5f6560]">Área:</span> {deptLabel}
                                                                    </span>
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#434843] bg-white border border-[#edeeed] px-2 py-0.5 rounded">
                                                                        <span className="text-[#5f6560]">Cargo:</span> {cargoLabel}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <span className="text-[11px] font-medium text-emerald-900 bg-[#d0e9d4] px-2.5 py-1 rounded-full capitalize shrink-0">
                                                            {participant.attendance === "late" ? "Tarde" : "Presente"}
                                                        </span>
                                                    </li>
                                                )
                                            })}
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
