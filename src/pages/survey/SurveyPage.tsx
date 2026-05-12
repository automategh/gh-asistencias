import Layout from "@/components/layouts/layout"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import {
    findSurveyDatabaseDescriptorById,
    getSurveyById,
    getSurveyOptionsByQuestionIds,
    getSurveyQuestionsBySurveyId,
    getSurveyResponse,
    saveSurveyResponse,
    type Survey,
    type SurveyAnswerValue,
    type SurveyOption,
    type SurveyQuestion,
} from "@/services/forms.service"
import type { MeetingParticipant } from "@/types/meeting"
import { getAllAvailableDatabases } from "@/lib/firebase/databaseResolver"
import { getDatabaseForUrl } from "@/services/firebase"
import { get, ref } from "firebase/database"
import { AlertCircle } from "lucide-react"
import { PencilLine } from "lucide-react"
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"

function SurveyPage() {
    const { id, trainingId } = useParams<{ id: string; trainingId: string }>()
    const { user } = useAuth()
    const [survey, setSurvey] = useState<Survey | null>(null)
    const [questions, setQuestions] = useState<SurveyQuestion[]>([])
    const [options, setOptions] = useState<SurveyOption[]>([])
    const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue | null>>({})
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitSuccess, setSubmitSuccess] = useState<boolean>(false)
    const [hasResponded, setHasResponded] = useState<boolean>(false)
    const [hasAttendance, setHasAttendance] = useState<boolean>(false)
    const [isCheckingAttendance, setIsCheckingAttendance] = useState<boolean>(true)

    useEffect(() => {
        if (!trainingId || !user) {
            setHasAttendance(false)
            setIsCheckingAttendance(false)
            return
        }

        let cancelled = false

        const checkAttendance = async () => {
            try {
                setIsCheckingAttendance(true)

                const allDbs = getAllAvailableDatabases()

                for (const dbInfo of allDbs) {
                    if (cancelled) return

                    const db = getDatabaseForUrl(dbInfo.url)
                    if (!db) continue

                    try {
                        const snap = await get(ref(db, `meetingParticipants/${trainingId}/${user.uid}`))
                        if (cancelled) return

                        if (snap.exists()) {
                            const participant = snap.val() as MeetingParticipant
                            const attendance = participant.attendance ?? null
                            const isNoShow = Boolean(participant.noShow)
                            const valid = (attendance === "present" || attendance === "late") && !isNoShow
                            if (valid) {
                                setHasAttendance(true)
                                return
                            }
                        }
                    } catch {
                        // Continuar con la siguiente base de datos si falla la consulta
                    }
                }

                if (!cancelled) {
                    setHasAttendance(false)
                }
            } finally {
                if (!cancelled) setIsCheckingAttendance(false)
            }
        }

        void checkAttendance()

        return () => { cancelled = true }
    }, [trainingId, user])

    useEffect(() => {
        if (!id) {
            return
        }

        let cancelled = false

        const loadSurvey = async () => {
            try {
                const surveyDatabase = await findSurveyDatabaseDescriptorById(id)
                const db = surveyDatabase?.database ?? null

                if (cancelled || !db) {
                    if (!cancelled) {
                        setSurvey(null)
                        setQuestions([])
                        setOptions([])
                    }
                    return
                }

                const [foundSurvey, surveyQuestions] = await Promise.all([
                    getSurveyById(db, id),
                    getSurveyQuestionsBySurveyId(db, id),
                ])

                if (cancelled) {
                    return
                }

                setSurvey(foundSurvey)
                setQuestions(surveyQuestions)

                if (surveyQuestions.length === 0) {
                    setOptions([])
                    return
                }

                const questionIds = surveyQuestions.map((q) => q.id)
                const relatedOptions = await getSurveyOptionsByQuestionIds(db, questionIds)

                if (!cancelled) {
                    setOptions(relatedOptions)
                }

                if (!cancelled && user && trainingId) {
                    const existingResponse = await getSurveyResponse(db, {
                        surveyId: id,
                        trainingId,
                        userId: user.uid,
                    })

                    if (!cancelled && existingResponse) {
                        setHasResponded(true)
                    }
                }
            } catch {
                if (!cancelled) {
                    setSurvey(null)
                    setQuestions([])
                    setOptions([])
                }
            }
        }

        void loadSurvey()

        return () => {
            cancelled = true
        }
    }, [id, trainingId, user])

    const handleTextChange = (questionId: string, value: string): void => {
        if (hasResponded) {
            return
        }
        setAnswers((prev) => ({
            ...prev,
            [questionId]: value,
        }))
    }

    const handleRatingSelect = (questionId: string, value: number): void => {
        if (hasResponded) {
            return
        }
        setAnswers((prev) => ({
            ...prev,
            [questionId]: value,
        }))
    }

    const handleSingleSelect = (questionId: string, optionId: string): void => {
        if (hasResponded) {
            return
        }
        setAnswers((prev) => ({
            ...prev,
            [questionId]: optionId,
        }))
    }

    const handleToggleMultiple = (questionId: string, optionId: string): void => {
        if (hasResponded) {
            return
        }
        setAnswers((prev) => {
            const current = prev[questionId]
            const currentArray: string[] = Array.isArray(current) ? current : []

            const exists = currentArray.includes(optionId)
            const nextArray = exists
                ? currentArray.filter((idOption) => idOption !== optionId)
                : [...currentArray, optionId]

            return {
                ...prev,
                [questionId]: nextArray,
            }
        })
    }

    const handleSubmit = async (): Promise<void> => {
        setSubmitError(null)
        setSubmitSuccess(false)

        if (hasResponded) {
            setSubmitError("Ya has respondido esta encuesta para esta capacitación.")
            return
        }

        if (!id || !trainingId) {
            setSubmitError("Encuesta o capacitación no válidas.")
            return
        }

        if (!user) {
            setSubmitError("Debes iniciar sesión para responder la encuesta.")
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
            setSubmitError("Por favor responde todas las preguntas obligatorias antes de guardar.")
            return
        }

        setIsSubmitting(true)

        try {
            const surveyDatabase = await findSurveyDatabaseDescriptorById(id)

            if (!surveyDatabase) {
                setSubmitError("No se encontró la base de datos de la encuesta.")
                return
            }

            await saveSurveyResponse(surveyDatabase.database, {
                surveyId: id,
                trainingId,
                userId: user.uid,
                userName: user.displayName ?? null,
                userEmail: user.email ?? null,
                recinto: surveyDatabase.recinto,
                answers,
            })

            setHasResponded(true)
            setSubmitSuccess(true)
        } catch (error) {
            console.error("No fue posible guardar la respuesta de la encuesta:", error)
            setSubmitError("No fue posible guardar tus respuestas. Inténtalo nuevamente.")
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <Layout>
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>
                <header className="sticky top-0 z-20 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className='px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center'>
                        <div>
                            <span className="inline-block px-3 py-1 bg-amber-400/50 text-primary text-xs font-semibold rounded-full">
                                Encuestas de Satisfacción
                            </span>
                            <h1 className="text-3xl font-bold tracking-tight">
                                {survey?.name ?? "Encuesta"}
                            </h1>
                            <p className="font-body text-[#434843] text-sm mt-1">
                                {survey?.description ?? "Diseña y configura los parámetros de la encuesta según tus necesidades."}
                            </p>
                        </div>
                    </nav>
                </header>


                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <div className="mx-auto max-w-7xl space-y-8">
                        {isCheckingAttendance ? (
                            <div className="rounded-2xl bg-white border border-[#edeeed] px-6 py-8 text-center shadow-sm">
                                <p className="text-sm text-[#5a665a]">Verificando tu asistencia a la capacitación...</p>
                            </div>
                        ) : !hasAttendance ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-8 flex flex-col items-center gap-3 text-center shadow-sm">
                                <AlertCircle className="w-10 h-10 text-amber-500" />
                                <p className="text-base font-semibold text-amber-800">Asistencia requerida</p>
                                <p className="text-sm text-amber-700 max-w-md">
                                    Para responder esta encuesta debes tener la asistencia registrada en la capacitación correspondiente.
                                    Si crees que esto es un error, comunícate con el organizador del evento.
                                </p>
                            </div>
                        ) : (
                        <><div className="bg-[#1b3022] text-white p-8 rounded-3xl flex flex-col md:flex-row items-center gap-8 shadow-lg overflow-hidden relative">
                            <div className="relative z-10">
                                <h2 className="text-2xl font-bold mb-3">Tu experiencia nos ayuda a mejorar</h2>
                                <p className="text-[#819986] leading-relaxed">
                                    Comparte tu percepción sobre esta capacitación para que podamos fortalecer los contenidos, la metodología y el impacto en tu día a día.
                                </p>
                            </div>
                            <div className="shrink-0 relative z-10">
                                <div className="w-24 h-24 bg-[#efbe82] rounded-2xl flex items-center justify-center rotate-3 shadow-xl">
                                    <PencilLine className="w-8 h-8 text-[#1b3022]" />
                                </div>
                            </div>
                            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-20 -mt-20"></div>
                        </div>

                        <div className="space-y-6">
                            {questions.map((question) => {
                                const questionOptions = options.filter((opt) => opt.questionId === question.id)
                                const answerValue = answers[question.id]

                                const isText = question.type === "text"
                                const isRating = question.type === "rating"
                                const isSingle = question.type === "single"
                                const isMultiple = question.type === "multiple"

                                return (
                                    <section key={question.id} className="bg-white p-8 rounded-2xl shadow-sm border border-[#edeeed]">
                                        <h2 className="text-xl font-bold mb-6">
                                            {question.order}. {question.text}
                                        </h2>

                                        {isText && (
                                            <textarea
                                                className="mt-3 w-full min-h-24 rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/60"
                                                disabled={hasResponded}
                                                value={typeof answerValue === "string" ? answerValue : ""}
                                                onChange={(event) => handleTextChange(question.id, event.target.value)}
                                                placeholder="Escribe tu respuesta aquí"
                                            />
                                        )}

                                        {isRating && questionOptions.length > 0 && (
                                            <div className="mt-4 flex gap-2">
                                                {questionOptions.map((opt) => {
                                                    const numeric = typeof opt.value === "number" ? opt.value : Number(opt.text)
                                                    const selected = typeof answerValue === "number" && answerValue === numeric
                                                    return (
                                                        <button
                                                            key={opt.id}
                                                            type="button"
                                                            className={cn(
                                                                "flex-1 py-2 rounded-lg border text-sm font-medium transition-colors",
                                                                selected
                                                                    ? "bg-[#1b3022] text-white border-[#1b3022]"
                                                                    : "bg-white text-[#1b3022] border-border hover:bg-[#e2efe4]",
                                                            )}
                                                            onClick={() => handleRatingSelect(question.id, numeric)}
                                                            disabled={hasResponded}
                                                        >
                                                            {numeric}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        {(isSingle || isMultiple) && questionOptions.length > 0 && (
                                            <div className="mt-3 space-y-2">
                                                {questionOptions.map((opt) => {
                                                    const current = answers[question.id]
                                                    const selectedIds: string[] = Array.isArray(current) ? current : []
                                                    const selected = isMultiple
                                                        ? selectedIds.includes(opt.id)
                                                        : current === opt.id

                                                    const handleClick = () => {
                                                        if (isMultiple) {
                                                            handleToggleMultiple(question.id, opt.id)
                                                        } else {
                                                            handleSingleSelect(question.id, opt.id)
                                                        }
                                                    }

                                                    return (
                                                        <button
                                                            key={opt.id}
                                                            type="button"
                                                            className={cn(
                                                                "w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors",
                                                                selected
                                                                    ? "bg-[#1b3022] text-white border-[#1b3022]"
                                                                    : "bg-white text-[#434843] border-border hover:bg-[#f3f4f3]",
                                                            )}
                                                            onClick={handleClick}
                                                            disabled={hasResponded}
                                                        >
                                                            {opt.text}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </section>
                                )
                            })}
                            {submitError && (
                                <p className="text-sm text-red-600 mt-4">
                                    {submitError}
                                </p>
                            )}
                            {submitSuccess && (
                                <p className="text-sm text-emerald-700 mt-4">
                                    ¡Gracias! Tu respuesta ha sido registrada correctamente.
                                </p>
                            )}
                            {!hasResponded && (
                                <div className="mt-8 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => { void handleSubmit() }}
                                        disabled={isSubmitting || questions.length === 0}
                                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#1b3022] text-white text-sm font-semibold shadow-md hover:bg-[#14251a] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isSubmitting ? "Guardando respuestas…" : "Guardar encuesta"}
                                    </button>
                                </div>
                            )}
                        </div>
                        </>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default SurveyPage