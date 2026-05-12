import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import {
    getSurveyById,
    getSurveyOptionsByQuestionIds,
    getSurveyQuestionsBySurveyId,
    getSurveyResponsesByTraining,
    type Survey,
    type SurveyAnswerValue,
    type SurveyOption,
    type SurveyQuestion,
    type SurveyResponse,
} from "@/services/forms.service"
import { getMeetingById } from "@/services/meetings.service"
import type { Meeting } from "@/types/meeting"
import type { UserProfile } from "@/types/user"
import { BarChart3, ChevronRight, Clock, MessageSquareText, Star, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { get, ref } from "firebase/database"

interface TrainingSurveySummary {
    trainingId: string
    meeting: Meeting | null
    totalResponses: number
    averageRating: number | null
}

interface RatingDistributionItem {
    value: number
    count: number
    percentage: number
}

interface SelectionDistributionItem {
    optionId: string
    label: string
    count: number
    percentage: number
}

interface QuestionAnalytics {
    question: SurveyQuestion
    answeredCount: number
    averageRating: number | null
    ratingDistribution: RatingDistributionItem[]
    selectionDistribution: SelectionDistributionItem[]
    comments: string[]
}

type SurveyRespondentProfile = Pick<UserProfile, "name" | "department" | "cargo">

const QUESTION_TYPE_LABELS: Record<SurveyQuestion["type"], string> = {
    rating: "Escala de valoración",
    single: "Selección única",
    multiple: "Selección múltiple",
    text: "Texto libre",
}

const SURVEY_CATEGORY_LABELS: Record<string, string> = {
    training: "Capacitación",
    meeting: "Reunión",
    custom: "Personalizada",
}

const formatDateLabel = (value: number): string => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return "Fecha no disponible"
    }

    return date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    })
}

const formatDateTimeLabel = (value: string): string => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }

    return date.toLocaleString("es-ES", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

const computeResponseAverageRating = (
    response: SurveyResponse,
    ratingQuestionIds: readonly string[],
): number | null => {
    if (ratingQuestionIds.length === 0) {
        return null
    }

    let sum = 0
    let count = 0

    for (const questionId of ratingQuestionIds) {
        const value = response.answers[questionId]
        if (typeof value === "number") {
            sum += value
            count += 1
        }
    }

    if (count === 0) {
        return null
    }

    return sum / count
}

const getQuestionOptions = (
    questionId: string,
    options: readonly SurveyOption[],
): SurveyOption[] => options.filter((option) => option.questionId === questionId)

const formatAnswerValue = (
    question: SurveyQuestion,
    value: SurveyAnswerValue,
    options: readonly SurveyOption[],
): string => {
    if (question.type === "text") {
        if (typeof value === "string") {
            return value
        }
        return String(value)
    }

    if (question.type === "rating") {
        if (typeof value === "number") {
            return value.toString()
        }
        const numeric = Number(value)
        return Number.isNaN(numeric) ? String(value) : numeric.toString()
    }

    if (question.type === "single") {
        const option = options.find((candidate) => candidate.id === value)
        if (option) {
            return option.text
        }
        return typeof value === "string" ? value : String(value)
    }

    const valuesArray: string[] = Array.isArray(value)
        ? value
        : [typeof value === "string" ? value : String(value)]

    const labels = valuesArray.map((optionId) => {
        const option = options.find((candidate) => candidate.id === optionId)
        return option ? option.text : optionId
    })

    return labels.join(", ")
}

const buildQuestionAnalytics = (
    question: SurveyQuestion,
    responses: readonly SurveyResponse[],
    options: readonly SurveyOption[],
): QuestionAnalytics => {
    const questionOptions = getQuestionOptions(question.id, options)
    let answeredCount = 0
    let ratingTotal = 0
    let ratingCount = 0
    const ratingMap = new Map<number, number>()
    const selectionMap = new Map<string, number>()
    const comments: string[] = []

    for (const response of responses) {
        const rawValue = response.answers[question.id]

        if (typeof rawValue === "undefined") {
            continue
        }

        if (question.type === "text") {
            const value = typeof rawValue === "string" ? rawValue.trim() : String(rawValue).trim()
            if (value.length > 0) {
                answeredCount += 1
                comments.push(value)
            }
            continue
        }

        if (question.type === "rating") {
            const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue)
            if (!Number.isNaN(numericValue)) {
                answeredCount += 1
                ratingTotal += numericValue
                ratingCount += 1
                ratingMap.set(numericValue, (ratingMap.get(numericValue) ?? 0) + 1)
            }
            continue
        }

        if (question.type === "single") {
            const optionId = typeof rawValue === "string" ? rawValue : String(rawValue)
            if (optionId.trim().length > 0) {
                answeredCount += 1
                selectionMap.set(optionId, (selectionMap.get(optionId) ?? 0) + 1)
            }
            continue
        }

        const selectedOptionIds = Array.isArray(rawValue)
            ? rawValue.map((value) => String(value)).filter((value) => value.trim().length > 0)
            : [String(rawValue)].filter((value) => value.trim().length > 0)

        if (selectedOptionIds.length > 0) {
            answeredCount += 1
            for (const optionId of selectedOptionIds) {
                selectionMap.set(optionId, (selectionMap.get(optionId) ?? 0) + 1)
            }
        }
    }

    const ratingDistribution: RatingDistributionItem[] = question.type === "rating"
        ? Array.from({ length: 10 }, (_, index) => {
            const value = index + 1
            const count = ratingMap.get(value) ?? 0
            return {
                value,
                count,
                percentage: answeredCount > 0 ? (count / answeredCount) * 100 : 0,
            }
        })
        : []

    const selectionDistribution: SelectionDistributionItem[] =
        question.type === "single" || question.type === "multiple"
            ? questionOptions.map((option) => {
                const count = selectionMap.get(option.id) ?? 0
                return {
                    optionId: option.id,
                    label: option.text,
                    count,
                    percentage: answeredCount > 0 ? (count / answeredCount) * 100 : 0,
                }
            })
            : []

    return {
        question,
        answeredCount,
        averageRating: ratingCount > 0 ? ratingTotal / ratingCount : null,
        ratingDistribution,
        selectionDistribution,
        comments,
    }
}

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

    const selectedSummary = selectedTrainingId
        ? trainingSummaries.find((summary) => summary.trainingId === selectedTrainingId) ?? null
        : null
    const selectedMeeting = selectedSummary?.meeting ?? null
    const selectedResponses = selectedTrainingId ? responsesByTraining[selectedTrainingId] ?? [] : []
    const selectedHours = selectedMeeting
        ? Math.max(0, selectedMeeting.endTime - selectedMeeting.startTime) / (1000 * 60 * 60)
        : null
    const selectedLocation = selectedMeeting?.location?.trim() ? selectedMeeting.location : null
    const questionAnalytics = selectedResponses.length > 0
        ? questions.map((question) => buildQuestionAnalytics(question, selectedResponses, options))
        : questions.map((question) => buildQuestionAnalytics(question, [], options))
    const totalComments = questionAnalytics.reduce((sum, item) => sum + item.comments.length, 0)
    const selectedRecinto = selectedResponses.find((response) => response.recinto)?.recinto ?? null
    const trainerLabel = selectedMeeting?.trainerName?.trim()
        || selectedMeeting?.createdByName?.trim()
        || selectedMeeting?.createdByEmail?.trim()
        || "No disponible"

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
                    <section className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-6">
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

                    <section className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-6 space-y-5">
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
                                            onClick={() => setSelectedTrainingId(summary.trainingId)}
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
                            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <article className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-5 space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Respuestas</p>
                                        <Users className="w-4 h-4 text-[#5a665a]" />
                                    </div>
                                    <p className="text-3xl font-extrabold text-[#191c1c]">{selectedSummary.totalResponses}</p>
                                    <p className="text-xs text-[#5a665a]">Colaboradores que completaron la encuesta para esta capacitación.</p>
                                </article>

                                <article className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-5 space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Promedio general</p>
                                        <Star className="w-4 h-4 text-[#5a665a]" />
                                    </div>
                                    <p className="text-3xl font-extrabold text-[#191c1c]">
                                        {selectedSummary.averageRating !== null ? selectedSummary.averageRating.toFixed(1) : "—"}
                                    </p>
                                    <p className="text-xs text-[#5a665a]">Promedio calculado sobre todas las preguntas de rating respondidas.</p>
                                </article>

                                <article className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-5 space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Duración</p>
                                        <Clock className="w-4 h-4 text-[#5a665a]" />
                                    </div>
                                    <p className="text-3xl font-extrabold text-[#191c1c]">
                                        {selectedHours !== null ? selectedHours.toFixed(1) : "—"}
                                    </p>
                                    <p className="text-xs text-[#5a665a]">Horas programadas para la capacitación seleccionada.</p>
                                </article>

                                <article className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-5 space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Comentarios abiertos</p>
                                        <MessageSquareText className="w-4 h-4 text-[#5a665a]" />
                                    </div>
                                    <p className="text-3xl font-extrabold text-[#191c1c]">{totalComments}</p>
                                    <p className="text-xs text-[#5a665a]">Total de respuestas de texto libre registradas para esta capacitación.</p>
                                </article>
                            </section>

                            <section className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-6 space-y-6">
                                <div className="flex flex-wrap items-start justify-between gap-4">
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
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div className="rounded-2xl bg-[#f3f4f3] px-4 py-3">
                                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Capacitador</p>
                                            <p className="text-sm font-bold text-[#191c1c] mt-2">{trainerLabel}</p>
                                        </div>
                                        <div className="rounded-2xl bg-[#f3f4f3] px-4 py-3">
                                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Recinto</p>
                                            <p className="text-sm font-bold text-[#191c1c] mt-2">{selectedRecinto ?? "No disponible"}</p>
                                        </div>
                                        <div className="rounded-2xl bg-[#f3f4f3] px-4 py-3 text-right">
                                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Preguntas analizadas</p>
                                            <p className="text-2xl font-extrabold text-[#191c1c] mt-1">{questions.length}</p>
                                        </div>
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
                                                <article key={analytics.question.id} className="rounded-2xl border border-[#edeeed] bg-[#fafbfa] p-5 space-y-5">
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
                                                            <div className="rounded-2xl bg-white border border-[#edeeed] px-4 py-3 min-w-32 text-center">
                                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Promedio</p>
                                                                <p className="text-2xl font-extrabold text-[#191c1c] mt-1">
                                                                    {analytics.averageRating !== null ? analytics.averageRating.toFixed(1) : "—"}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </header>

                                                    {analytics.question.type === "rating" && (
                                                        <div className="space-y-3">
                                                            {analytics.ratingDistribution.map((item) => (
                                                                <div key={item.value} className="grid grid-cols-[40px_1fr_72px] items-center gap-3">
                                                                    <span className="text-sm font-semibold text-[#191c1c]">{item.value}</span>
                                                                    <div className="h-3 rounded-full bg-[#e8ebe8] overflow-hidden">
                                                                        <div
                                                                            className="h-full rounded-full bg-[#1b3022] transition-all"
                                                                            style={{ width: `${item.percentage}%` }}
                                                                        />
                                                                    </div>
                                                                    <span className="text-xs text-[#5a665a] text-right">
                                                                        {item.count} · {item.percentage.toFixed(0)}%
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {(analytics.question.type === "single" || analytics.question.type === "multiple") && (
                                                        <div className="space-y-3">
                                                            {analytics.selectionDistribution.map((item) => (
                                                                <div key={item.optionId} className="space-y-1.5">
                                                                    <div className="flex items-center justify-between gap-4 text-xs">
                                                                        <span className="font-medium text-[#191c1c]">{item.label}</span>
                                                                        <span className="text-[#5a665a]">
                                                                            {item.count} selección{item.count === 1 ? "" : "es"} · {item.percentage.toFixed(0)}%
                                                                        </span>
                                                                    </div>
                                                                    <div className="h-3 rounded-full bg-[#e8ebe8] overflow-hidden">
                                                                        <div
                                                                            className="h-full rounded-full bg-[#588157] transition-all"
                                                                            style={{ width: `${item.percentage}%` }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {analytics.question.type === "text" && (
                                                        analytics.comments.length === 0 ? (
                                                            <p className="text-sm text-[#5a665a]">No se registraron comentarios para esta pregunta.</p>
                                                        ) : (
                                                            <div className="space-y-3">
                                                                {analytics.comments.slice(0, 6).map((comment, commentIndex) => (
                                                                    <div key={`${analytics.question.id}-${commentIndex}`} className="rounded-xl border border-[#edeeed] bg-white px-4 py-3">
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

                            <section className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-6 space-y-4">
                                <div>
                                    <h3 className="text-lg font-bold text-[#191c1c]">Respuestas individuales</h3>
                                    <p className="text-xs text-[#5a665a] mt-1">
                                        Este bloque sirve como respaldo detallado para revisar lo que respondió cada colaborador.
                                    </p>
                                </div>

                                {selectedResponses.length === 0 ? (
                                    <p className="text-sm text-[#5a665a]">No se encontraron respuestas para esta capacitación.</p>
                                ) : (
                                    <div className="space-y-3 max-h-140 overflow-y-auto pr-1">
                                        {selectedResponses.map((response) => (
                                            <details
                                                key={response.id}
                                                className="group rounded-xl border border-[#edeeed] bg-[#fafbfa] overflow-hidden"
                                            >
                                                {(() => {
                                                    const respondentProfile = respondentProfiles[response.userId]
                                                    const respondentName = respondentProfile?.name?.trim()
                                                        || response.userName?.trim()
                                                        || response.userEmail
                                                        || "Colaborador sin nombre"
                                                    const respondentDepartment = respondentProfile?.department?.trim() || "No disponible"
                                                    const respondentCargo = respondentProfile?.cargo?.trim() || "No disponible"

                                                    return (
                                                <summary className="list-none cursor-pointer px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold text-[#191c1c]">
                                                            {respondentName}
                                                        </p>
                                                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[#5a665a]">
                                                            {response.userEmail && <span>{response.userEmail}</span>}
                                                            {response.recinto && <span>• {response.recinto}</span>}
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                                            <span className="rounded-full bg-white px-2.5 py-1 text-[#434843] border border-[#edeeed]">
                                                                Cargo: {respondentCargo}
                                                            </span>
                                                            <span className="rounded-full bg-white px-2.5 py-1 text-[#434843] border border-[#edeeed]">
                                                                Área: {respondentDepartment}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-[11px] text-[#5a665a]">Respondida el</p>
                                                        <p className="text-xs font-medium text-[#191c1c]">{formatDateTimeLabel(response.createdAt)}</p>
                                                    </div>
                                                </summary>
                                                    )
                                                })()}

                                                <div className="border-t border-[#edeeed] px-4 py-4 space-y-3 bg-white">
                                                    {questions.map((question) => {
                                                        const rawValue = response.answers[question.id]

                                                        if (typeof rawValue === "undefined") {
                                                            return null
                                                        }

                                                        const label = formatAnswerValue(question, rawValue, options)

                                                        return (
                                                            <div key={question.id} className="space-y-1">
                                                                <p className="text-xs font-semibold text-[#191c1c]">{question.text}</p>
                                                                <p className="text-sm text-[#5a665a] leading-6">
                                                                    {label.trim().length > 0 ? label : "Sin respuesta"}
                                                                </p>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </details>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </div>
        </Layout>
    )
}

export default SurveyResultsPage
