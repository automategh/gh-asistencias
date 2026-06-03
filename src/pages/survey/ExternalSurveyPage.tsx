import { cn } from "@/lib/utils"
import {
    getExternalSurveyForCheckin,
    submitExternalSurveyResponse,
    type Survey,
    type SurveyAnswerValue,
    type SurveyOption,
    type SurveyQuestion,
} from "@/services/forms.service"
import { AlertCircle, PencilLine } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"

function ExternalSurveyPage() {
    const { id, trainingId } = useParams<{ id: string; trainingId: string }>()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()

    const sourceDatabaseUrl = searchParams.get("db")
    const externalId = searchParams.get("externalId")

    const [survey, setSurvey] = useState<Survey | null>(null)
    const [questions, setQuestions] = useState<SurveyQuestion[]>([])
    const [options, setOptions] = useState<SurveyOption[]>([])
    const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue | null>>({})
    const [loading, setLoading] = useState<boolean>(true)
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [success, setSuccess] = useState<boolean>(false)
    const [showErrorModal, setShowErrorModal] = useState<boolean>(false)
    const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false)
    const [showAlreadyAnsweredModal, setShowAlreadyAnsweredModal] = useState<boolean>(false)

    const canLoadSurvey = Boolean(id && trainingId && sourceDatabaseUrl && externalId)

    useEffect(() => {
        let cancelled = false

        async function loadSurvey(): Promise<void> {
            if (!id || !trainingId || !sourceDatabaseUrl || !externalId) {
                setLoading(false)
                setSubmitError("No fue posible validar el acceso a la encuesta externa.")
                setShowErrorModal(true)
                return
            }

            try {
                setLoading(true)
                setSubmitError(null)

                const response = await getExternalSurveyForCheckin({
                    surveyId: id,
                    trainingId,
                    meetingDatabaseUrl: sourceDatabaseUrl,
                    externalId,
                })

                if (cancelled) {
                    return
                }

                setSurvey(response.survey)
                setQuestions(response.questions)
                setOptions(response.options)
            } catch (error) {
                if (!cancelled) {
                    setSubmitError(error instanceof Error ? error.message : "No fue posible cargar la encuesta")
                    setShowErrorModal(true)
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        void loadSurvey()

        return () => {
            cancelled = true
        }
    }, [id, trainingId, sourceDatabaseUrl, externalId])

    const optionsByQuestion = useMemo(() => {
        const grouped = new Map<string, SurveyOption[]>()
        options.forEach((option) => {
            const current = grouped.get(option.questionId) ?? []
            current.push(option)
            grouped.set(option.questionId, current)
        })
        return grouped
    }, [options])

    const handleTextChange = (questionId: string, value: string): void => {
        setAnswers((prev) => ({
            ...prev,
            [questionId]: value,
        }))
    }

    const handleRatingSelect = (questionId: string, value: number): void => {
        setAnswers((prev) => ({
            ...prev,
            [questionId]: value,
        }))
    }

    const handleSingleSelect = (questionId: string, optionId: string): void => {
        setAnswers((prev) => ({
            ...prev,
            [questionId]: optionId,
        }))
    }

    const handleToggleMultiple = (questionId: string, optionId: string): void => {
        setAnswers((prev) => {
            const current = prev[questionId]
            const currentArray: string[] = Array.isArray(current) ? current : []
            const exists = currentArray.includes(optionId)

            return {
                ...prev,
                [questionId]: exists
                    ? currentArray.filter((item) => item !== optionId)
                    : [...currentArray, optionId],
            }
        })
    }

    const handleSubmit = async (): Promise<void> => {
        if (!id || !trainingId || !sourceDatabaseUrl || !externalId) {
            setSubmitError("No fue posible validar el acceso a la encuesta externa.")
            setShowErrorModal(true)
            return
        }

        const missingRequired = questions.filter((question) => {
            if (!question.required) {
                return false
            }

            const value = answers[question.id]
            if (value === null || typeof value === "undefined") {
                return true
            }
            if (typeof value === "string") {
                return value.trim().length === 0
            }
            if (Array.isArray(value)) {
                return value.length === 0
            }
            return false
        })

        if (missingRequired.length > 0) {
            setSubmitError("Por favor responde todas las preguntas obligatorias.")
            setShowErrorModal(true)
            return
        }

        try {
            setIsSubmitting(true)
            setSubmitError(null)

            await submitExternalSurveyResponse({
                surveyId: id,
                trainingId,
                meetingDatabaseUrl: sourceDatabaseUrl,
                externalId,
                answers,
            })

            setSuccess(true)
            setShowSuccessModal(true)
        } catch (error) {
            const code = (error && (error as { code?: string }).code) ?? null
            if (code === "already-exists") {
                // Encuesta ya respondida por este externo
                setShowAlreadyAnsweredModal(true)
                return
            }

            setSubmitError(error instanceof Error ? error.message : "No fue posible guardar la encuesta")
            setShowErrorModal(true)
        } finally {
            setIsSubmitting(false)
        }
    }

    if (!canLoadSurvey) {
        return (
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background px-4 py-10">
                <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 px-6 py-6 text-red-800">
                    No fue posible abrir la encuesta externa. Verifica que el enlace de check-in sea válido.
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background px-4 py-10">
            <div className="mx-auto max-w-4xl space-y-6">
                {submitError && showErrorModal && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
                        <div className="w-full max-w-md rounded-3xl border border-red-200 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden">
                            <div className="px-6 py-5 border-b border-red-100 bg-red-50">
                                <h2 className="text-xl font-bold text-red-800 flex items-center gap-2">
                                    <AlertCircle className="w-5 h-5" />
                                    Error de validación
                                </h2>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-red-700 font-medium">{submitError}</p>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowErrorModal(false)
                                            setSubmitError(null)
                                        }}
                                        className="inline-flex items-center justify-center rounded-xl bg-[#1b3022] px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#14251a] transition-colors"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {success && showSuccessModal && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
                        <div className="w-full max-w-md rounded-3xl border border-[#edeeed] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden">
                            <div className="px-6 py-5 border-b border-[#edeeed] bg-[#f8faf8]">
                                <h2 className="text-xl font-bold text-[#191c1c]">Encuesta enviada</h2>
                                <p className="text-sm text-[#5f6560] mt-2">Gracias por completar la encuesta de satisfacción.</p>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-[#5f6560]">Tu proceso quedó finalizado. Puedes cerrar esta ventana.</p>
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowSuccessModal(false)
                                        }}
                                        className="inline-flex items-center justify-center rounded-xl border border-[#d4d7d5] bg-white px-5 py-3 text-sm font-semibold text-[#1b3022] hover:bg-[#f2f4f3] transition-colors"
                                    >
                                        Cerrar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => navigate("/")}
                                        className="inline-flex items-center justify-center rounded-xl bg-[#1b3022] px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#14251a] transition-colors"
                                    >
                                        Finalizar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {showAlreadyAnsweredModal && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
                        <div className="w-full max-w-md rounded-3xl border border-[#edeeed] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden">
                            <div className="px-6 py-5 border-b border-[#edeeed] bg-[#f8faf8]">
                                <h2 className="text-xl font-bold text-[#191c1c]">Encuesta ya respondida</h2>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-[#5f6560]">Ya completaste esta encuesta para la capacitación seleccionada.</p>
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowAlreadyAnsweredModal(false)
                                            navigate('/')
                                        }}
                                        className="inline-flex items-center justify-center rounded-xl bg-[#1b3022] px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#14251a] transition-colors"
                                    >
                                        Ir al inicio
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="rounded-3xl bg-[#1b3022] p-8 text-white shadow-lg">
                    <h1 className="text-2xl font-bold">{survey?.name ?? "Encuesta de satisfacción"}</h1>
                    <p className="mt-2 text-sm text-[#d6e4d8]">
                        Gracias por registrar tu asistencia. Completa esta encuesta para finalizar tu proceso.
                    </p>
                </div>

                {loading && (
                    <div className="rounded-2xl border border-border bg-white px-6 py-8 text-sm text-muted-foreground">
                        Cargando encuesta...
                    </div>
                )}

                {!loading && !success && survey && (
                    <div className="space-y-5">
                        {questions.map((question) => {
                            const questionOptions = optionsByQuestion.get(question.id) ?? []
                            const answerValue = answers[question.id]
                            const isText = question.type === "text"
                            const isRating = question.type === "rating"
                            const isSingle = question.type === "single"
                            const isMultiple = question.type === "multiple"

                            return (
                                <section key={question.id} className="rounded-2xl border border-[#edeeed] bg-white p-6 shadow-sm">
                                    <h2 className="text-lg font-bold text-[#1b3022]">
                                        {question.order}. {question.text}
                                    </h2>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {question.required ? "Obligatoria" : "Opcional"}
                                    </p>

                                    {isText && (
                                        <textarea
                                            className="mt-4 min-h-24 w-full rounded-xl border border-border px-3 py-2 text-sm"
                                            value={typeof answerValue === "string" ? answerValue : ""}
                                            onChange={(event) => handleTextChange(question.id, event.target.value)}
                                            placeholder="Escribe tu respuesta"
                                        />
                                    )}

                                    {isRating && questionOptions.length > 0 && (
                                        <div className="mt-4 grid gap-2 grid-cols-5 sm:grid-cols-6 md:flex md:flex-wrap md:gap-2">
                                            {questionOptions.map((option) => {
                                                const numeric = typeof option.value === "number" ? option.value : Number(option.text)
                                                const selected = typeof answerValue === "number" && answerValue === numeric
                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        className={cn(
                                                            "w-full md:flex-1 min-w-11 flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
                                                            selected
                                                                ? "border-[#1b3022] bg-[#1b3022] text-white"
                                                                : "border-border bg-white text-[#1b3022] hover:bg-[#e2efe4]",
                                                        )}
                                                        onClick={() => handleRatingSelect(question.id, numeric)}
                                                    >
                                                        {numeric}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}

                                    {isSingle && questionOptions.length > 0 && (
                                        <div className="mt-4 space-y-2">
                                            {questionOptions.map((option) => (
                                                <button
                                                    key={option.id}
                                                    type="button"
                                                    className={cn(
                                                        "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                                                        answerValue === option.id
                                                            ? "border-[#1b3022] bg-[#1b3022] text-white"
                                                            : "border-border bg-white text-foreground hover:bg-muted",
                                                    )}
                                                    onClick={() => handleSingleSelect(question.id, option.id)}
                                                >
                                                    {option.text}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {isMultiple && questionOptions.length > 0 && (
                                        <div className="mt-4 space-y-2">
                                            {questionOptions.map((option) => {
                                                const selectedValues = Array.isArray(answerValue) ? answerValue : []
                                                const selected = selectedValues.includes(option.id)

                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        className={cn(
                                                            "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                                                            selected
                                                                ? "border-[#1b3022] bg-[#1b3022] text-white"
                                                                : "border-border bg-white text-foreground hover:bg-muted",
                                                        )}
                                                        onClick={() => handleToggleMultiple(question.id, option.id)}
                                                    >
                                                        {option.text}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                </section>
                            )
                        })}

                        <div className="rounded-2xl border border-[#edeeed] bg-white p-6 shadow-sm">
                            <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => { void handleSubmit() }}
                                className="w-full rounded-xl bg-[#1b3022] px-4 py-3 text-sm font-semibold text-white hover:bg-[#14251a] transition-colors disabled:opacity-60"
                            >
                                {isSubmitting ? "Enviando encuesta..." : "Enviar encuesta"}
                            </button>
                        </div>
                    </div>
                )}

                {!loading && !success && !survey && !submitError && (
                    <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground">
                        No se encontró la encuesta para esta capacitación.
                    </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <PencilLine className="h-4 w-4" />
                    Tus respuestas son confidenciales y se registran para mejorar futuras capacitaciones.
                </div>
            </div>
        </div>
    )
}

export default ExternalSurveyPage
