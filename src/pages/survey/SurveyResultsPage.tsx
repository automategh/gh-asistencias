import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import {
    getSurveyById,
    getSurveyOptionsByQuestionIds,
    getSurveyQuestionsBySurveyId,
    getSurveyResponsesByTraining,
    type Survey,
    type SurveyOption,
    type SurveyQuestion,
    type SurveyResponse,
} from "@/services/forms.service"
import { getMeetingById } from "@/services/meetings.service"
import type { UserProfile } from "@/types/user"
import { BarChart3, ChevronRight, Clock, MessageSquareText, Star, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { get, ref } from "firebase/database"
import { DistributionDonutCard, RatingDistributionChart, SelectionDistributionChart } from "./components/SurveyResultsCharts"
import { SurveyResponseCard } from "./components/SurveyResponseCard"
import { SurveyResponseFilters } from "./components/SurveyResponseFilters"
import type { ResultsTab, SurveyRespondentProfile, TrainingSurveySummary } from "./survey-results.types"
import {
    ALL_FILTER_VALUE,
    buildDistribution,
    buildFilterOptions,
    buildQuestionAnalytics,
    computeResponseAverageRating,
    formatAnswerValue,
    formatDateLabel,
    QUESTION_TYPE_LABELS,
    RESPONSES_PER_PAGE,
    SURVEY_CATEGORY_LABELS,
} from "./survey-results.utils"

const loadRespondentProfiles = async (
    database: NonNullable<ReturnType<typeof useDatabase>["database"]>,
    userIds: readonly string[],
): Promise<Record<string, SurveyRespondentProfile>> => {
    if (userIds.length === 0) {
        return {}
    }

    const usersRef = ref(database, "users")
    const snapshot = await get(usersRef)
    const rawUsers = snapshot.val() as Record<string, UserProfile> | null

    if (!rawUsers) {
        return {}
    }

    const targetIds = new Set(userIds)
    const profileMap: Record<string, SurveyRespondentProfile> = {}

    for (const [uid, user] of Object.entries(rawUsers)) {
        if (!targetIds.has(uid)) {
            continue
        }

        profileMap[uid] = {
            name: typeof user.name === "string" ? user.name : "",
            department: typeof user.department === "string" ? user.department : user.department ?? null,
            cargo: typeof user.cargo === "string" ? user.cargo : user.cargo ?? null,
        }
    }

    return profileMap
}

function SurveyResultsPage() {
    const { id } = useParams<{ id: string }>()
    const { database } = useDatabase()
    const [survey, setSurvey] = useState<Survey | null>(null)
    const [isLoadingSurvey, setIsLoadingSurvey] = useState<boolean>(false)
    const [isLoadingTrainings, setIsLoadingTrainings] = useState<boolean>(false)
    const [questions, setQuestions] = useState<SurveyQuestion[]>([])
    const [options, setOptions] = useState<SurveyOption[]>([])
    const [responsesByTraining, setResponsesByTraining] = useState<Record<string, SurveyResponse[]>>({})
    const [trainingSummaries, setTrainingSummaries] = useState<TrainingSurveySummary[]>([])
    const [selectedTrainingId, setSelectedTrainingId] = useState<string | null>(null)
    const [respondentProfiles, setRespondentProfiles] = useState<Record<string, SurveyRespondentProfile>>({})
    const [activeTab, setActiveTab] = useState<ResultsTab>("summary")
    const [responsesPage, setResponsesPage] = useState<number>(1)
    const [responsesSearch, setResponsesSearch] = useState<string>("")
    const [selectedRecintoFilter, setSelectedRecintoFilter] = useState<string>(ALL_FILTER_VALUE)
    const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState<string>(ALL_FILTER_VALUE)
    const [selectedCargoFilter, setSelectedCargoFilter] = useState<string>(ALL_FILTER_VALUE)

    const navigate = useNavigate()

    useEffect(() => {
        if (!database || !id) {
            setSurvey(null)
            return
        }

        let cancelled = false

        const loadSurvey = async () => {
            try {
                setIsLoadingSurvey(true)
                const found = await getSurveyById(database, id)
                if (!cancelled) {
                    setSurvey(found)
                }
            } catch (error) {
                console.error("No fue posible cargar la encuesta para resultados:", error)
                if (!cancelled) {
                    setSurvey(null)
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingSurvey(false)
                }
            }
        }

        void loadSurvey()

        return () => {
            cancelled = true
        }
    }, [database, id])

    useEffect(() => {
        if (!database || !survey) {
            setQuestions([])
            setOptions([])
            setResponsesByTraining({})
            setTrainingSummaries([])
            setSelectedTrainingId(null)
            setRespondentProfiles({})
            return
        }

        let cancelled = false

        const loadTrainingSummaries = async () => {
            try {
                setIsLoadingTrainings(true)

                const loadedQuestions = await getSurveyQuestionsBySurveyId(database, survey.id)
                if (cancelled) {
                    return
                }

                setQuestions(loadedQuestions)

                const ratingQuestionIds = loadedQuestions
                    .filter((question) => question.type === "rating")
                    .map((question) => question.id)

                const groupedResponses = await getSurveyResponsesByTraining(database, survey.id)
                if (cancelled) {
                    return
                }

                setResponsesByTraining(groupedResponses)

                const loadedOptions = await getSurveyOptionsByQuestionIds(
                    database,
                    loadedQuestions.map((question) => question.id),
                )
                if (cancelled) {
                    return
                }

                setOptions(loadedOptions)

                const trainingIds = Object.keys(groupedResponses)

                if (trainingIds.length === 0) {
                    setTrainingSummaries([])
                    setSelectedTrainingId(null)
                    return
                }

                const meetings = await Promise.all(
                    trainingIds.map(async (trainingId) => {
                        try {
                            return await getMeetingById(database, trainingId)
                        } catch {
                            return null
                        }
                    }),
                )

                const summaries: TrainingSurveySummary[] = trainingIds
                    .map((trainingId, index) => {
                        const responses = groupedResponses[trainingId] ?? []

                        let totalResponseScore = 0
                        let responseCount = 0

                        for (const response of responses) {
                            const perResponseScore = computeResponseAverageRating(response, ratingQuestionIds)
                            if (perResponseScore !== null) {
                                totalResponseScore += perResponseScore
                                responseCount += 1
                            }
                        }

                        return {
                            trainingId,
                            meeting: meetings[index] ?? null,
                            totalResponses: responses.length,
                            averageRating: responseCount > 0 ? totalResponseScore / responseCount : null,
                        }
                    })
                    .sort((first, second) => {
                        const secondStart = second.meeting?.startTime ?? 0
                        const firstStart = first.meeting?.startTime ?? 0
                        return secondStart - firstStart
                    })

                if (!cancelled) {
                    setTrainingSummaries(summaries)
                    setSelectedTrainingId((previous) => previous ?? (summaries[0]?.trainingId ?? null))
                }
            } catch (error) {
                console.error("No fue posible cargar los resultados de la encuesta por capacitación:", error)
                if (!cancelled) {
                    setTrainingSummaries([])
                    setSelectedTrainingId(null)
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingTrainings(false)
                }
            }
        }

        void loadTrainingSummaries()

        return () => {
            cancelled = true
        }
    }, [database, survey])

    useEffect(() => {
        if (!database || !selectedTrainingId) {
            setRespondentProfiles({})
            return
        }

        const selectedResponses = responsesByTraining[selectedTrainingId] ?? []
        const userIds = Array.from(new Set(selectedResponses.map((response) => response.userId.trim()).filter((uid) => uid.length > 0)))

        if (userIds.length === 0) {
            setRespondentProfiles({})
            return
        }

        let cancelled = false

        const loadProfiles = async () => {
            try {
                const profileMap = await loadRespondentProfiles(database, userIds)
                if (!cancelled) {
                    setRespondentProfiles(profileMap)
                }
            } catch (error) {
                console.error("No fue posible cargar el perfil de los respondientes:", error)
                if (!cancelled) {
                    setRespondentProfiles({})
                }
            }
        }

        void loadProfiles()

        return () => {
            cancelled = true
        }
    }, [database, selectedTrainingId, responsesByTraining])

    useEffect(() => {
        setResponsesPage(1)
    }, [selectedTrainingId])

    useEffect(() => {
        setResponsesPage(1)
    }, [responsesSearch, selectedRecintoFilter, selectedDepartmentFilter, selectedCargoFilter])

    useEffect(() => {
        setResponsesSearch("")
        setSelectedRecintoFilter(ALL_FILTER_VALUE)
        setSelectedDepartmentFilter(ALL_FILTER_VALUE)
        setSelectedCargoFilter(ALL_FILTER_VALUE)
    }, [selectedTrainingId])

    const selectedSummary = selectedTrainingId
        ? trainingSummaries.find((summary) => summary.trainingId === selectedTrainingId) ?? null
        : null
    const selectedMeeting = selectedSummary?.meeting ?? null
    const selectedResponses = selectedTrainingId ? responsesByTraining[selectedTrainingId] ?? [] : []
    const orderedResponses = [...selectedResponses].sort((first, second) => {
        return second.createdAt.localeCompare(first.createdAt)
    })
    const selectedHours = selectedMeeting
        ? Math.max(0, selectedMeeting.endTime - selectedMeeting.startTime) / (1000 * 60 * 60)
        : null
    const selectedLocation = selectedMeeting?.location?.trim() ? selectedMeeting.location : null
    const questionAnalytics = selectedResponses.length > 0
        ? questions.map((question) => buildQuestionAnalytics(question, selectedResponses, options))
        : questions.map((question) => buildQuestionAnalytics(question, [], options))
    const totalComments = questionAnalytics.reduce((sum, item) => sum + item.comments.length, 0)
    const trainerLabel = selectedMeeting?.trainerName?.trim()
        || selectedMeeting?.createdByName?.trim()
        || selectedMeeting?.createdByEmail?.trim()
        || "No disponible"
    const respondentAreaDistribution = buildDistribution(
        selectedResponses.map((response) => respondentProfiles[response.userId]?.department),
    )
    const respondentRoleDistribution = buildDistribution(
        selectedResponses.map((response) => respondentProfiles[response.userId]?.cargo),
    )
    const respondentRecintoDistribution = buildDistribution(
        selectedResponses.map((response) => response.recinto),
    )
    const responseRecintoOptions = buildFilterOptions(selectedResponses.map((response) => response.recinto))
    const responseDepartmentOptions = buildFilterOptions(
        selectedResponses.map((response) => respondentProfiles[response.userId]?.department),
    )
    const responseCargoOptions = buildFilterOptions(
        selectedResponses.map((response) => respondentProfiles[response.userId]?.cargo),
    )
    const normalizedSearch = responsesSearch.trim().toLocaleLowerCase("es-ES")
    const filteredResponses = orderedResponses.filter((response) => {
        const respondentProfile = respondentProfiles[response.userId]
        const respondentName = respondentProfile?.name?.trim()
            || response.userName?.trim()
            || response.userEmail
            || ""
        const respondentDepartment = respondentProfile?.department?.trim() || ""
        const respondentCargo = respondentProfile?.cargo?.trim() || ""
        const respondentRecinto = response.recinto?.trim() || ""
        const respondentEmail = response.userEmail?.trim() || ""

        const matchesSearch = normalizedSearch.length === 0
            || [respondentName, respondentEmail, respondentDepartment, respondentCargo, respondentRecinto]
                .some((value) => value.toLocaleLowerCase("es-ES").includes(normalizedSearch))

        const matchesRecinto = selectedRecintoFilter === ALL_FILTER_VALUE || respondentRecinto === selectedRecintoFilter
        const matchesDepartment = selectedDepartmentFilter === ALL_FILTER_VALUE || respondentDepartment === selectedDepartmentFilter
        const matchesCargo = selectedCargoFilter === ALL_FILTER_VALUE || respondentCargo === selectedCargoFilter

        return matchesSearch && matchesRecinto && matchesDepartment && matchesCargo
    })
    const totalResponsePages = Math.max(1, Math.ceil(filteredResponses.length / RESPONSES_PER_PAGE))
    const safeResponsesPage = Math.min(responsesPage, totalResponsePages)
    const paginatedResponses = filteredResponses.slice(
        (safeResponsesPage - 1) * RESPONSES_PER_PAGE,
        safeResponsesPage * RESPONSES_PER_PAGE,
    )

    return (
        <Layout>
            <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className="px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center">
                        <div>
                            <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                                <span
                                    className="hover:text-secondary cursor-pointer transition-colors"
                                    onClick={() => navigate("/survey")}
                                >
                                    Encuestas
                                </span>
                                <ChevronRight className="w-4 h-4" />
                                <span>Resultados</span>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight">Resultados de Encuesta</h1>
                            <p className="font-body text-[#434843] text-sm mt-1">
                                Analiza cada capacitación por separado y revisa sus resultados pregunta por pregunta.
                            </p>
                        </div>
                    </nav>
                </header>

                <div className="px-4 md:px-12 py-10 md:py-16 max-w-7xl mx-auto space-y-8">
                    <section className="bg-white rounded-xl  p-6">
                        {isLoadingSurvey ? (
                            <p className="text-sm text-[#434843]">Cargando encuesta...</p>
                        ) : !survey ? (
                            <p className="text-sm text-[#434843]">No se encontró la encuesta solicitada.</p>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-outline">
                                    <span className="inline-flex items-center gap-2 rounded-full bg-[#f3f4f3] px-3 py-1 uppercase tracking-widest">
                                        <Clock className="w-3.5 h-3.5" />
                                        {SURVEY_CATEGORY_LABELS[survey.category] ?? survey.category}
                                    </span>
                                    <span className="inline-flex items-center rounded-full bg-[#eef4ef] px-3 py-1 text-[#1b3022]">
                                        {trainingSummaries.length} capacitaciones con respuestas
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    <h2 className="text-2xl font-bold text-[#191c1c]">{survey.name}</h2>
                                    {survey.description && (
                                        <p className="text-sm text-[#434843] max-w-3xl">{survey.description}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="bg-white rounded-xl  p-6 space-y-5">
                        <div className="flex flex-wrap items-end justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-bold text-[#191c1c]">Capacitaciones con respuestas</h2>
                                <p className="text-xs text-[#5a665a] mt-1">
                                    Elige una capacitación para ver sus indicadores y el detalle de cada pregunta.
                                </p>
                            </div>
                            {!isLoadingTrainings && trainingSummaries.length > 0 && (
                                <p className="text-xs text-[#5a665a]">
                                    {trainingSummaries.length} capacitación{trainingSummaries.length === 1 ? "" : "es"} analizable{trainingSummaries.length === 1 ? "" : "s"}
                                </p>
                            )}
                        </div>

                        {isLoadingTrainings ? (
                            <p className="text-sm text-[#434843]">Buscando capacitaciones con respuestas...</p>
                        ) : trainingSummaries.length === 0 ? (
                            <p className="text-sm text-[#434843]">
                                Esta encuesta aún no tiene respuestas registradas por capacitación en esta base de datos.
                            </p>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {trainingSummaries.map((summary) => {
                                    const isSelected = selectedTrainingId === summary.trainingId
                                    const meeting = summary.meeting
                                    const title = meeting?.title ?? `Capacitación ${summary.trainingId}`
                                    const dateLabel = meeting ? formatDateLabel(meeting.startTime) : "Fecha no disponible"

                                    return (
                                        <button
                                            key={summary.trainingId}
                                            type="button"
                                            onClick={() => {
                                                setSelectedTrainingId(summary.trainingId)
                                                setActiveTab("summary")
                                            }}
                                            className={`rounded-2xl border p-5 text-left transition-all ${isSelected
                                                ? "border-[#1b3022] bg-[#eef4ef] shadow-[0_18px_30px_rgba(27,48,34,0.08)]"
                                                : "border-[#edeeed] bg-[#f9faf9] hover:border-[#cfd8cf] hover:shadow-sm"
                                                }`}
                                        >
                                            <div className="flex items-center justify-between gap-4">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-outline">
                                                    {dateLabel}
                                                </span>
                                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${isSelected ? "bg-[#1b3022] text-white" : "bg-white text-[#1b3022]"}`}>
                                                    {summary.totalResponses} respuestas
                                                </span>
                                            </div>
                                            <h3 className="mt-3 text-base font-bold text-[#191c1c] line-clamp-2">{title}</h3>
                                            <div className="mt-4 flex items-end justify-between gap-4">
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold">
                                                        Promedio general
                                                    </p>
                                                    <p className="text-2xl font-extrabold text-[#191c1c] mt-1">
                                                        {summary.averageRating !== null ? summary.averageRating.toFixed(1) : "—"}
                                                    </p>
                                                </div>
                                                <div className="text-right text-[11px] text-[#5a665a]">
                                                    <p>{meeting?.location ?? "Ubicación no disponible"}</p>
                                                </div>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </section>

                    {selectedSummary && (
                        <>
                            <section className="bg-white rounded-xl p-3 sm:p-4">
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab("summary")}
                                        className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${activeTab === "summary"
                                            ? "bg-[#1b3022] text-white"
                                            : "bg-[#f3f4f3] text-[#434843] hover:bg-[#e6e8e6]"
                                            }`}
                                    >
                                        Resumen
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab("responses")}
                                        className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${activeTab === "responses"
                                            ? "bg-[#1b3022] text-white"
                                            : "bg-[#f3f4f3] text-[#434843] hover:bg-[#e6e8e6]"
                                            }`}
                                    >
                                        Respuestas individuales
                                    </button>
                                </div>
                            </section>

                            {activeTab === "summary" && (
                                <>
                                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        <article className="bg-white rounded-xl p-5 space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Respuestas</p>
                                                <Users className="w-4 h-4 text-[#5a665a]" />
                                            </div>
                                            <p className="text-3xl font-extrabold text-[#191c1c]">{selectedSummary.totalResponses}</p>
                                            <p className="text-xs text-[#5a665a]">Colaboradores que completaron la encuesta para esta capacitación.</p>
                                        </article>

                                        <article className="bg-white rounded-xl p-5 space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Promedio general</p>
                                                <Star className="w-4 h-4 text-[#5a665a]" />
                                            </div>
                                            <p className="text-3xl font-extrabold text-[#191c1c]">
                                                {selectedSummary.averageRating !== null ? selectedSummary.averageRating.toFixed(1) : "—"}
                                            </p>
                                            <p className="text-xs text-[#5a665a]">Promedio calculado sobre todas las preguntas de rating respondidas.</p>
                                        </article>

                                        <article className="bg-white rounded-xl p-5 space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Duración</p>
                                                <Clock className="w-4 h-4 text-[#5a665a]" />
                                            </div>
                                            <p className="text-3xl font-extrabold text-[#191c1c]">
                                                {selectedHours !== null ? selectedHours.toFixed(1) : "—"}
                                            </p>
                                            <p className="text-xs text-[#5a665a]">Horas programadas para la capacitación seleccionada.</p>
                                        </article>

                                        <article className="bg-white rounded-xl p-5 space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Comentarios abiertos</p>
                                                <MessageSquareText className="w-4 h-4 text-[#5a665a]" />
                                            </div>
                                            <p className="text-3xl font-extrabold text-[#191c1c]">{totalComments}</p>
                                            <p className="text-xs text-[#5a665a]">Total de respuestas de texto libre registradas para esta capacitación.</p>
                                        </article>
                                    </section>

                                    <section className="bg-white rounded-xl p-6 space-y-6">
                                        <div className="space-y-4">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Capacitación seleccionada</p>
                                                <h2 className="text-2xl font-bold text-[#191c1c] mt-2">
                                                    {selectedMeeting?.title ?? `Capacitación ${selectedSummary.trainingId}`}
                                                </h2>
                                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#5a665a]">
                                                    <span>{selectedMeeting ? formatDateLabel(selectedMeeting.startTime) : "Fecha no disponible"}</span>
                                                    {selectedLocation && <span>• {selectedLocation}</span>}
                                                </div>
                                            </div>
                                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                                <div className="rounded-2xl bg-[#f3f4f3] px-4 py-3">
                                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Capacitador</p>
                                                    <p className="text-sm font-bold text-[#191c1c] mt-2">{trainerLabel}</p>
                                                </div>
                                                <div className="rounded-2xl bg-[#f3f4f3] px-4 py-3">
                                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Recintos detectados</p>
                                                    <p className="text-2xl font-extrabold text-[#191c1c] mt-1">{respondentRecintoDistribution.length}</p>
                                                    <p className="text-xs text-[#5a665a] mt-2">Recintos con al menos una respuesta registrada.</p>
                                                </div>
                                                <div className="rounded-2xl bg-[#f3f4f3] px-4 py-3">
                                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Preguntas analizadas</p>
                                                    <p className="text-2xl font-extrabold text-[#191c1c] mt-1">{questions.length}</p>
                                                </div>
                                            </div>

                                            <div className="grid gap-4 xl:grid-cols-3">
                                                <DistributionDonutCard
                                                    title="Áreas que respondieron"
                                                    subtitle="Distribución de participación por área"
                                                    items={respondentAreaDistribution}
                                                    emptyMessage="No hay áreas disponibles en los perfiles de quienes respondieron."
                                                />
                                                <DistributionDonutCard
                                                    title="Cargos que respondieron"
                                                    subtitle="Distribución de participación por cargo"
                                                    items={respondentRoleDistribution}
                                                    emptyMessage="No hay cargos disponibles en los perfiles de quienes respondieron."
                                                />
                                                <DistributionDonutCard
                                                    title="Recintos con respuestas"
                                                    subtitle="Origen de las respuestas por recinto"
                                                    items={respondentRecintoDistribution}
                                                    emptyMessage="No hay recintos registrados en las respuestas de esta capacitación."
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-5">
                                            <div className="flex items-center justify-between gap-4">
                                                <div>
                                                    <h3 className="text-lg font-bold text-[#191c1c]">Resultados por pregunta</h3>
                                                    <p className="text-xs text-[#5a665a] mt-1">
                                                        Cada bloque muestra el comportamiento de una pregunta dentro de esta capacitación.
                                                    </p>
                                                </div>
                                                <BarChart3 className="w-5 h-5 text-[#5a665a]" />
                                            </div>

                                            {questionAnalytics.length === 0 ? (
                                                <p className="text-sm text-[#434843]">Esta encuesta no tiene preguntas configuradas.</p>
                                            ) : (
                                                <div className="space-y-5">
                                                    {questionAnalytics.map((analytics, index) => (
                                                        <article key={analytics.question.id} className="rounded-2xl  bg-[#fafbfa] p-5 space-y-5">
                                                            <header className="flex flex-wrap items-start justify-between gap-4">
                                                                <div className="space-y-2">
                                                                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-outline">
                                                                        <span>Pregunta {index + 1}</span>
                                                                        <span className="rounded-full bg-white px-2.5 py-1 text-[#1b3022] border border-[#dbe5db]">
                                                                            {QUESTION_TYPE_LABELS[analytics.question.type]}
                                                                        </span>
                                                                        <span>{analytics.answeredCount} respuestas válidas</span>
                                                                    </div>
                                                                    <h4 className="text-base font-bold text-[#191c1c]">{analytics.question.text}</h4>
                                                                </div>
                                                                {analytics.question.type === "rating" && (
                                                                    <div className="rounded-2xl bg-white  px-4 py-3 min-w-32 text-center">
                                                                        <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Promedio</p>
                                                                        <p className="text-2xl font-extrabold text-[#191c1c] mt-1">
                                                                            {analytics.averageRating !== null ? analytics.averageRating.toFixed(1) : "—"}
                                                                        </p>
                                                                    </div>
                                                                )}
                                                            </header>

                                                            {analytics.question.type === "rating" && (
                                                                <RatingDistributionChart items={analytics.ratingDistribution} />
                                                            )}

                                                            {(analytics.question.type === "single" || analytics.question.type === "multiple") && (
                                                                <SelectionDistributionChart items={analytics.selectionDistribution} />
                                                            )}

                                                            {analytics.question.type === "text" && (
                                                                analytics.comments.length === 0 ? (
                                                                    <p className="text-sm text-[#5a665a]">No se registraron comentarios para esta pregunta.</p>
                                                                ) : (
                                                                    <div className="space-y-3">
                                                                        {analytics.comments.slice(0, 6).map((comment, commentIndex) => (
                                                                            <div key={`${analytics.question.id}-${commentIndex}`} className="rounded-xl  bg-white px-4 py-3">
                                                                                <p className="text-sm text-[#434843] leading-6">{comment}</p>
                                                                            </div>
                                                                        ))}
                                                                        {analytics.comments.length > 6 && (
                                                                            <p className="text-xs text-[#5a665a]">
                                                                                Se muestran 6 de {analytics.comments.length} comentarios registrados.
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                )
                                                            )}
                                                        </article>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </>
                            )}

                            {activeTab === "responses" && (
                                <section className="bg-white rounded-xl shadow-sm  p-6 space-y-4">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div>
                                            <h3 className="text-lg font-bold text-[#191c1c]">Respuestas individuales</h3>
                                            <p className="text-xs text-[#5a665a] mt-1">
                                                Este bloque concentra el detalle operativo por respondiente para no cargar la vista de resumen.
                                            </p>
                                        </div>
                                        <div className="rounded-2xl bg-[#f3f4f3] px-4 py-3 text-right">
                                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Capacitación seleccionada</p>
                                            <p className="text-sm font-bold text-[#191c1c] mt-2">
                                                {selectedMeeting?.title ?? `Capacitación ${selectedSummary.trainingId}`}
                                            </p>
                                        </div>
                                    </div>

                                    {selectedResponses.length === 0 ? (
                                        <p className="text-sm text-[#5a665a]">No se encontraron respuestas para esta capacitación.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            <SurveyResponseFilters
                                                search={responsesSearch}
                                                selectedRecinto={selectedRecintoFilter}
                                                selectedDepartment={selectedDepartmentFilter}
                                                selectedCargo={selectedCargoFilter}
                                                recintoOptions={responseRecintoOptions}
                                                departmentOptions={responseDepartmentOptions}
                                                cargoOptions={responseCargoOptions}
                                                onSearchChange={setResponsesSearch}
                                                onRecintoChange={setSelectedRecintoFilter}
                                                onDepartmentChange={setSelectedDepartmentFilter}
                                                onCargoChange={setSelectedCargoFilter}
                                                onClear={() => {
                                                    setResponsesSearch("")
                                                    setSelectedRecintoFilter(ALL_FILTER_VALUE)
                                                    setSelectedDepartmentFilter(ALL_FILTER_VALUE)
                                                    setSelectedCargoFilter(ALL_FILTER_VALUE)
                                                }}
                                            />

                                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f3f4f3] px-4 py-3 text-xs text-[#5a665a]">
                                                <span>
                                                    Mostrando <strong>{paginatedResponses.length}</strong> de <strong>{filteredResponses.length}</strong> respuestas
                                                </span>
                                                <span>
                                                    Página <strong>{safeResponsesPage}</strong> de <strong>{totalResponsePages}</strong>
                                                </span>
                                            </div>

                                            {filteredResponses.length === 0 ? (
                                                <div className="rounded-[28px] border border-dashed border-[#dbe5db] bg-[#f8faf8] px-5 py-10 text-center">
                                                    <p className="text-sm font-semibold text-[#191c1c]">No hay respuestas que coincidan con los filtros.</p>
                                                    <p className="mt-2 text-xs text-[#5a665a]">Prueba con otra combinación o limpia la búsqueda.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3 pr-1">
                                                    {paginatedResponses.map((response) => {
                                                        const respondentProfile = respondentProfiles[response.userId]
                                                        const respondentName = respondentProfile?.name?.trim()
                                                            || response.userName?.trim()
                                                            || response.userEmail
                                                            || "Colaborador sin nombre"
                                                        const respondentDepartment = respondentProfile?.department?.trim() || "No disponible"
                                                        const respondentCargo = respondentProfile?.cargo?.trim() || "No disponible"
                                                        const respondentRecinto = response.recinto?.trim() || "No disponible"
                                                        const respondentEmail = response.userEmail?.trim() || "No disponible"
                                                        const answeredQuestionList = questions.flatMap((question, questionIndex) => {
                                                            const rawValue = response.answers[question.id]
                                                            if (typeof rawValue === "undefined") {
                                                                return []
                                                            }

                                                            return [{
                                                                id: question.id,
                                                                index: questionIndex,
                                                                type: question.type,
                                                                text: question.text,
                                                                answer: formatAnswerValue(question, rawValue, options).trim() || "Sin respuesta",
                                                            }]
                                                        })

                                                        return (
                                                            <SurveyResponseCard
                                                                key={response.id}
                                                                respondentName={respondentName}
                                                                respondentDepartment={respondentDepartment}
                                                                respondentCargo={respondentCargo}
                                                                respondentRecinto={respondentRecinto}
                                                                respondentEmail={respondentEmail}
                                                                answeredQuestions={answeredQuestionList.length}
                                                                totalQuestions={questions.length}
                                                                createdAt={response.createdAt}
                                                                questions={answeredQuestionList}
                                                            />
                                                        )
                                                    })}
                                                </div>
                                            )}

                                            {filteredResponses.length > 0 && totalResponsePages > 1 && (
                                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edeeed] pt-4">
                                                    <button
                                                        type="button"
                                                        onClick={() => setResponsesPage((previous) => Math.max(1, previous - 1))}
                                                        disabled={safeResponsesPage === 1}
                                                        className="px-4 py-2 rounded-xl bg-[#f3f4f3] text-sm font-semibold text-[#434843] hover:bg-[#e6e8e6] disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        Anterior
                                                    </button>
                                                    <div className="flex flex-wrap items-center justify-center gap-2">
                                                        {Array.from({ length: totalResponsePages }, (_, index) => index + 1).map((pageNumber) => (
                                                            <button
                                                                key={pageNumber}
                                                                type="button"
                                                                onClick={() => setResponsesPage(pageNumber)}
                                                                className={`min-w-10 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${safeResponsesPage === pageNumber
                                                                    ? "bg-[#1b3022] text-white"
                                                                    : "bg-[#f3f4f3] text-[#434843] hover:bg-[#e6e8e6]"
                                                                    }`}
                                                            >
                                                                {pageNumber}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setResponsesPage((previous) => Math.min(totalResponsePages, previous + 1))}
                                                        disabled={safeResponsesPage === totalResponsePages}
                                                        className="px-4 py-2 rounded-xl bg-[#f3f4f3] text-sm font-semibold text-[#434843] hover:bg-[#e6e8e6] disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        Siguiente
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </section>
                            )}
                        </>
                    )}
                </div>
            </div>
        </Layout>
    )
}

export default SurveyResultsPage
