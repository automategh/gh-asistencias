import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import { getMeetingById } from "@/services/meetings.service"
import {
    getSurveyById,
    getSurveyQuestionsBySurveyId,
    getSurveyResponsesByTraining,
    getSurveyOptionsByQuestionIds,
    type Survey,
    type SurveyQuestion,
    type SurveyResponse,
    type SurveyOption,
    type SurveyAnswerValue,
} from "@/services/forms.service"
import type { Meeting } from "@/types/meeting"
import { ChevronRight, Clock } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

interface TrainingSurveySummary {
    trainingId: string
    meeting: Meeting | null
    totalResponses: number
    averageRating: number | null
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
            return
        }

        let cancelled = false

        const loadTrainingSummaries = async () => {
            try {
                setIsLoadingTrainings(true)

                const questions = await getSurveyQuestionsBySurveyId(database, survey.id)
                setQuestions(questions)

                const ratingQuestionIds = questions
                    .filter((question: SurveyQuestion) => question.type === "rating")
                    .map((question) => question.id)

                const groupedResponses = await getSurveyResponsesByTraining(database, survey.id)
                setResponsesByTraining(groupedResponses)

                const options = await getSurveyOptionsByQuestionIds(
                    database,
                    questions.map((question) => question.id),
                )
                setOptions(options)

                const trainingIds = Object.keys(groupedResponses)

                if (cancelled) {
                    return
                }

                if (trainingIds.length === 0) {
                    setTrainingSummaries([])
                    setSelectedTrainingId(null)
                    return
                }

                const meetings = await Promise.all(
                    trainingIds.map(async (trainingId) => {
                        try {
                            const meeting = await getMeetingById(database, trainingId)
                            return meeting
                        } catch {
                            return null
                        }
                    }),
                )

                const summaries: TrainingSurveySummary[] = trainingIds.map((trainingId, index) => {
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

                    const averageRating = responseCount > 0 ? totalResponseScore / responseCount : null

                    return {
                        trainingId,
                        meeting: meetings[index] ?? null,
                        totalResponses: responses.length,
                        averageRating,
                    }
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

    /**
     * Devuelve una representación legible de la respuesta de un colaborador
     * para una pregunta específica, resolviendo textos de opciones cuando aplica.
     */
    const formatAnswerValue = (question: SurveyQuestion, value: SurveyAnswerValue): string => {
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

        if (question.type === "multiple") {
            const valuesArray: string[] = Array.isArray(value)
                ? value
                : [typeof value === "string" ? value : String(value)]

            const labels = valuesArray.map((optionId) => {
                const option = options.find((candidate) => candidate.id === optionId)
                return option ? option.text : optionId
            })

            return labels.join(", ")
        }

        return String(value)
    }

    return (
        <Layout>
            <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className="px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center">
                        <div>
                            <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                                <span
                                    className="hover:text-secondary cursor-pointer transition-colors"
                                    onClick={() => navigate("/survey")}>Encuestas</span>
                                <ChevronRight className="w-4 h-4" />
                                <span>Resultados</span>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight">Resultados de Encuesta</h1>
                            <p className="font-body text-[#434843] text-sm mt-1">
                                Visualiza las respuestas agrupadas por capacitación para esta encuesta de satisfacción.
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
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-xs text-outline font-medium">
                                    <Clock className="w-4 h-4" />
                                    <span>{survey.category === "training" ? "Encuesta de capacitación" : "Encuesta"}</span>
                                </div>
                                <h2 className="text-2xl font-bold text-[#191c1c]">{survey.name}</h2>
                                {survey.description && (
                                    <p className="text-sm text-[#434843]">{survey.description}</p>
                                )}
                                <p className="text-xs text-[#5a665a] mt-2">
                                    Aquí se podrán explorar las respuestas por capacitación asociadas a esta encuesta.
                                </p>
                            </div>
                        )}
                    </section>

                    <section className="bg-white rounded-xl shadow-sm border border-[#edeeed] p-6 space-y-4">
                        <div className="flex flex-wrap items-end gap-4 justify-between">
                            <div className="flex-1 min-w-60">
                                <h2 className="text-lg font-bold text-[#191c1c]">Capacitaciones con respuestas</h2>
                                <p className="text-xs text-[#5a665a]">
                                    Selecciona una capacitación para ver su resumen de respuestas de satisfacción.
                                </p>
                            </div>
                            <div className="flex-1 min-w-60 flex flex-col gap-2 items-end">
                                {isLoadingTrainings ? (
                                    <p className="text-xs text-[#434843]">Buscando capacitaciones con respuestas...</p>
                                ) : trainingSummaries.length === 0 ? (
                                    <p className="text-xs text-[#434843]">
                                        Esta encuesta aún no tiene respuestas registradas por capacitación en esta base de datos.
                                    </p>
                                ) : (
                                    <div className="w-full max-w-xs">
                                        <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-1 ml-1">
                                            Capacitación
                                        </label>
                                        <select
                                            className="w-full bg-[#f9faf9] border border-[#edeeed] rounded-lg py-2 pl-3 pr-8 text-xs font-semibold text-[#191c1c] appearance-none focus:outline-none focus:ring-2 focus:ring-primary-container"
                                            value={selectedTrainingId ?? ""}
                                            onChange={(event) => setSelectedTrainingId(event.target.value || null)}
                                        >
                                            {trainingSummaries.map((summary) => {
                                                const meeting = summary.meeting
                                                const title = meeting?.title ?? `Capacitación ${summary.trainingId}`
                                                const date = meeting
                                                    ? new Date(meeting.startTime).toLocaleDateString("es-ES", {
                                                        day: "2-digit",
                                                        month: "short",
                                                        year: "numeric",
                                                    })
                                                    : "Fecha no disponible"

                                                return (
                                                    <option key={summary.trainingId} value={summary.trainingId}>
                                                        {title} · {date}
                                                    </option>
                                                )
                                            })}
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>

                        {!isLoadingTrainings && trainingSummaries.length > 0 && selectedTrainingId && (
                            (() => {
                                const current = trainingSummaries.find((summary) => summary.trainingId === selectedTrainingId) ?? null
                                if (!current) {
                                    return null
                                }

                                const meeting = current.meeting
                                const title = meeting?.title ?? `Capacitación ${current.trainingId}`
                                const date = meeting
                                    ? new Date(meeting.startTime).toLocaleDateString("es-ES", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                    })
                                    : "Fecha no disponible"

                                const hours = meeting
                                    ? Math.max(0, meeting.endTime - meeting.startTime) / (1000 * 60 * 60)
                                    : null

                                const responses = responsesByTraining[selectedTrainingId] ?? []

                                return (
                                    <div className="mt-4 space-y-6">
                                        <div className="grid gap-4 md:grid-cols-3">
                                            <div className="bg-[#f9faf9] rounded-xl border border-[#edeeed] p-4 space-y-1">
                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Capacitación</p>
                                                <p className="text-sm font-semibold text-[#191c1c]">{title}</p>
                                                <p className="text-xs text-[#5a665a]">{date}</p>
                                            </div>
                                            <div className="bg-[#f9faf9] rounded-xl border border-[#edeeed] p-4 space-y-1">
                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Respuestas recibidas</p>
                                                <p className="text-2xl font-extrabold text-[#191c1c]">{current.totalResponses}</p>
                                                <p className="text-xs text-[#5a665a]">Colaboradores que completaron la encuesta</p>
                                            </div>
                                            <div className="bg-[#f9faf9] rounded-xl border border-[#edeeed] p-4 space-y-1">
                                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Promedio de satisfacción</p>
                                                <p className="text-2xl font-extrabold text-[#191c1c]">
                                                    {current.averageRating !== null ? current.averageRating.toFixed(1) : "—"}
                                                </p>
                                                <p className="text-xs text-[#5a665a]">
                                                    Calculado sobre las preguntas de tipo rating de la encuesta.
                                                </p>
                                            </div>
                                            {hours !== null && (
                                                <div className="md:col-span-3 text-[11px] text-[#5a665a] mt-2">
                                                    Duración de la capacitación: <span className="font-semibold">{hours.toFixed(1)} horas</span>.
                                                </div>
                                            )}
                                        </div>

                                        <div className="border-t border-[#edeeed] pt-4">
                                            <h3 className="text-sm font-bold text-[#191c1c] mb-2">Respuestas individuales</h3>
                                            {responses.length === 0 ? (
                                                <p className="text-xs text-[#5a665a]">
                                                    No se encontraron respuestas para esta capacitación.
                                                </p>
                                            ) : (
                                                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                                                    {responses.map((response) => {
                                                        const createdAtDate = new Date(response.createdAt)
                                                        const createdAtLabel = Number.isNaN(createdAtDate.getTime())
                                                            ? response.createdAt
                                                            : createdAtDate.toLocaleString("es-ES", {
                                                                day: "2-digit",
                                                                month: "short",
                                                                year: "numeric",
                                                                hour: "2-digit",
                                                                minute: "2-digit",
                                                            })

                                                        return (
                                                            <article
                                                                key={response.id}
                                                                className="bg-[#f9faf9] rounded-lg border border-[#edeeed] p-3 space-y-2"
                                                            >
                                                                <header className="flex flex-wrap items-baseline justify-between gap-2">
                                                                    <div>
                                                                        <p className="text-xs font-semibold text-[#191c1c]">
                                                                            {response.userName ?? response.userEmail ?? "Colaborador sin nombre"}
                                                                        </p>
                                                                        {response.userEmail && (
                                                                            <p className="text-[11px] text-[#5a665a]">{response.userEmail}</p>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-[11px] text-[#5a665a]">{createdAtLabel}</p>
                                                                </header>

                                                                <dl className="mt-1 space-y-1">
                                                                    {questions.map((question) => {
                                                                        const rawValue = response.answers[question.id] as SurveyAnswerValue | undefined

                                                                        if (typeof rawValue === "undefined") {
                                                                            return null
                                                                        }

                                                                        const label = formatAnswerValue(question, rawValue)

                                                                        return (
                                                                            <div key={question.id} className="flex flex-col gap-0.5">
                                                                                <dt className="text-[11px] font-medium text-[#191c1c]">
                                                                                    {question.text}
                                                                                </dt>
                                                                                <dd className="text-[11px] text-[#5a665a]">
                                                                                    {label.trim().length > 0 ? label : "Sin respuesta"}
                                                                                </dd>
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </dl>
                                                            </article>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })()
                        )}
                    </section>
                </div>
            </div>
        </Layout>
    )
}

export default SurveyResultsPage
