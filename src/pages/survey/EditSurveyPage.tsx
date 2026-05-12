import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import { createOption, createQuestion, deleteSurveyCascade, getSurveyById, getSurveyOptionsByQuestionIds, getSurveyQuestionsBySurveyId, updateSurvey, type QuestionType, type SurveyOption, type SurveyQuestion } from "@/services/forms.service"
import type { MeetingKind } from "@/types/meeting"

import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Copy, PlusCircle, Trash } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { get as getFromDatabase, ref as databaseRef, remove } from "firebase/database"

/**
 * Borrador de opción de respuesta manejado en el editor de encuestas.
 * No incluye "id" porque ese identificador lo asigna Firebase al persistir.
 */
interface QuestionOptionDraft {
    readonly text: string
    readonly value?: number
}

/**
 * Borrador de pregunta que se utiliza solo en la UI.
 * Extiende la pregunta base sin los identificadores controlados por Firebase
 * y añade el arreglo de opciones cuando el tipo de pregunta lo requiere.
 */
interface QuestionDraft extends Omit<SurveyQuestion, "id" | "surveyId"> {
    readonly options?: QuestionOptionDraft[]
}

/**
 * Pantalla de edición de encuestas existentes.
 * Reutiliza el constructor de encuestas para permitir modificar la información
 * básica y la estructura de preguntas de una encuesta ya creada.
 */
function EditSurveyPage() {
    const navigate = useNavigate()
    const { id: surveyId } = useParams<{ id: string }>()
    const { database } = useDatabase()

    const [data, setData] = useState({
        name: "",
        category: "",
        description: "",
        predetermined: false,
    })

    const [questions, setQuestions] = useState<QuestionDraft[]>([])
    const [error, setError] = useState({
        label: "",
        message: "",
    })
    const [success, setSuccess] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isLoading, setIsLoading] = useState<boolean>(true)
    const [isDeleting, setIsDeleting] = useState<boolean>(false)

    const clearErrorForLabel = (label: string): void => {
        setError((previous) => (previous.label === label ? { label: "", message: "" } : previous))
    }

    const handleAddQuestion = () => {
        clearErrorForLabel("Preguntas")
        setQuestions((previous) => ([
            ...previous,
            {
                text: "",
                order: previous.length + 1,
                required: false,
                type: "text",
            },
        ]))
    }

    const handleEditQuestion = (index: number, field: keyof Omit<SurveyQuestion, "id" | "surveyId">, value: string | boolean) => {
        clearErrorForLabel("Preguntas")
        setQuestions((previous) => previous.map((question, currentIndex) => {
            if (currentIndex !== index) {
                return question
            }

            if (field === "type") {
                const nextType = value as QuestionType

                let nextOptions: QuestionOptionDraft[] | undefined

                if (nextType === "single" || nextType === "multiple") {
                    const isComingFromRating = question.type === "rating"

                    nextOptions = !isComingFromRating && question.options && question.options.length > 0
                        ? question.options
                        : [
                            { text: "Opción 1" },
                            { text: "Opción 2" },
                        ]
                } else if (nextType === "rating") {
                    nextOptions = Array.from({ length: 10 }, (_, indexOption) => {
                        const numericValue = indexOption + 1
                        return {
                            text: String(numericValue),
                            value: numericValue,
                        }
                    })
                }

                return {
                    ...question,
                    type: nextType,
                    options: nextOptions,
                }
            }

            return {
                ...question,
                [field]: value,
            }
        }))
    }

    const handleDuplicateQuestion = (index: number) => {
        setQuestions((previous) => {
            const question = previous[index]
            if (!question) return previous
            const { text, required, type, options } = question
            return [
                ...previous,
                {
                    text,
                    order: previous.length + 1,
                    required,
                    type,
                    options: options ? options.map((option) => ({ ...option })) : undefined,
                },
            ]
        })
    }

    const handleDeleteQuestion = (index: number) => {
        clearErrorForLabel("Preguntas")
        setQuestions((previous) => previous
            .filter((_, currentIndex) => currentIndex !== index)
            .map((question, currentIndex) => ({
                ...question,
                order: currentIndex + 1,
            })))
    }

    const handleAddOption = (questionIndex: number) => {
        clearErrorForLabel("Preguntas")
        setQuestions((previous) => previous.map((question, currentIndex) => {
            if (currentIndex !== questionIndex) {
                return question
            }

            const currentOptions = question.options ?? []
            const nextOrder = currentOptions.length + 1
            const nextOption: QuestionOptionDraft = {
                text: `Opción ${nextOrder}`,
            }

            return {
                ...question,
                options: [...currentOptions, nextOption],
            }
        }))
    }

    const handleEditOption = (questionIndex: number, optionIndex: number, text: string) => {
        clearErrorForLabel("Preguntas")
        setQuestions((previous) => previous.map((question, currentIndex) => {
            if (currentIndex !== questionIndex || !question.options) {
                return question
            }

            const updatedOptions = question.options.map((option, currentOptionIndex) => {
                if (currentOptionIndex !== optionIndex) {
                    return option
                }

                return {
                    ...option,
                    text,
                }
            })

            return {
                ...question,
                options: updatedOptions,
            }
        }))
    }

    const handleDeleteOption = (questionIndex: number, optionIndex: number) => {
        clearErrorForLabel("Preguntas")
        setQuestions((previous) => previous.map((question, currentIndex) => {
            if (currentIndex !== questionIndex || !question.options) {
                return question
            }

            const filteredOptions = question.options.filter((_, currentOptionIndex) => currentOptionIndex !== optionIndex)

            return {
                ...question,
                options: filteredOptions,
            }
        }))
    }

    /**
     * Reordena el arreglo de preguntas moviendo un elemento de una posición a otra
     * y recalcula el campo `order` para mantener la numeración consistente.
     */
    const reorderQuestions = (items: QuestionDraft[], fromIndex: number, toIndex: number): QuestionDraft[] => {
        const nextItems = [...items]
        const [moved] = nextItems.splice(fromIndex, 1)
        nextItems.splice(toIndex, 0, moved)

        return nextItems.map((question, currentIndex) => ({
            ...question,
            order: currentIndex + 1,
        }))
    }

    /**
     * Mueve una pregunta una posición hacia arriba en el listado visual.
     */
    const handleMoveQuestionUp = (index: number): void => {
        if (index === 0) {
            return
        }

        setQuestions(previous => reorderQuestions(previous, index, index - 1))
    }

    /**
     * Mueve una pregunta una posición hacia abajo en el listado visual.
     */
    const handleMoveQuestionDown = (index: number): void => {
        setQuestions(previous => {
            if (index >= previous.length - 1) {
                return previous
            }

            return reorderQuestions(previous, index, index + 1)
        })
    }

    const MEETING_KIND_LABELS: Record<MeetingKind, string> = {
        meeting: "Reunión",
        training: "Capacitación",
        custom: "Personalizada",
    }

    const meetingKinds: MeetingKind[] = ["meeting", "training", "custom"]

    const deleteExistingQuestionsAndOptions = async (currentSurveyId: string): Promise<void> => {
        if (!database) {
            return
        }

        const questionsRef = databaseRef(database, "surveyQuestions")
        const questionsSnapshot = await getFromDatabase(questionsRef)
        const questionsValue = questionsSnapshot.val() as Record<string, Omit<SurveyQuestion, "id">> | null

        if (!questionsValue) {
            return
        }

        const questionsToRemove = Object.entries(questionsValue).filter(([, question]) => question.surveyId === currentSurveyId)

        if (questionsToRemove.length === 0) {
            return
        }

        const optionsRef = databaseRef(database, "surveyOptions")
        const optionsSnapshot = await getFromDatabase(optionsRef)
        const optionsValue = optionsSnapshot.val() as Record<string, Omit<SurveyOption, "id">> | null

        const optionEntries = optionsValue ? Object.entries(optionsValue) : []

        for (const [questionKey] of questionsToRemove) {
            for (const [optionKey, option] of optionEntries) {
                if (option.questionId === questionKey) {
                    await remove(databaseRef(database, `surveyOptions/${optionKey}`))
                }
            }
            await remove(databaseRef(database, `surveyQuestions/${questionKey}`))
        }
    }

    useEffect(() => {
        if (!database || !surveyId) {
            setIsLoading(false)
            if (!surveyId) {
                setError({ label: "General", message: "No se encontró el identificador de la encuesta." })
            }
            return
        }

        let cancelled = false

        const loadSurvey = async () => {
            try {
                setIsLoading(true)

                const survey = await getSurveyById(database, surveyId)
                if (!survey) {
                    if (!cancelled) {
                        setError({ label: "General", message: "No se encontró la encuesta solicitada." })
                    }
                    return
                }

                if (cancelled) {
                    return
                }

                setData({
                    name: survey.name,
                    category: survey.category,
                    description: survey.description ?? "",
                    predetermined: Boolean(survey.predetermined),
                })

                const loadedQuestions = await getSurveyQuestionsBySurveyId(database, surveyId)
                if (cancelled) {
                    return
                }

                const questionIds = loadedQuestions.map((question) => question.id)
                const loadedOptions = await getSurveyOptionsByQuestionIds(database, questionIds)
                if (cancelled) {
                    return
                }

                const updatedQuestions: QuestionDraft[] = loadedQuestions
                    .map((question) => {
                        const optionsForQuestion = loadedOptions
                            .filter((option) => option.questionId === question.id)
                            .sort((first, second) => first.order - second.order)
                            .map<QuestionOptionDraft>((option) => ({
                                text: option.text,
                                value: option.value,
                            }))

                        return {
                            text: question.text,
                            order: question.order,
                            required: question.required,
                            type: question.type,
                            options: optionsForQuestion.length > 0 ? optionsForQuestion : undefined,
                        }
                    })
                    .sort((first, second) => first.order - second.order)

                setQuestions(updatedQuestions)
            } catch (err) {
                if (!cancelled) {
                    setError({
                        label: "General",
                        message: err instanceof Error ? err.message : "No fue posible cargar la encuesta para edición.",
                    })
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }

        void loadSurvey()

        return () => {
            cancelled = true
        }
    }, [database, surveyId])

    const handleSubmit = async () => {
        if (isSubmitting) {
            return
        }

        if (!surveyId) {
            setError({ label: "General", message: "No se encontró el identificador de la encuesta." })
            return
        }

        setError({ label: "", message: "" })

        if (!data.name.trim()) {
            setError({ label: "Nombre", message: "El nombre es obligatorio." })
            return
        }

        if (!data.category) {
            setError({ label: "Categoría", message: "Selecciona una categoría." })
            return
        }

        if (questions.length === 0) {
            setError({ label: "Preguntas", message: "Agrega al menos una pregunta." })
            return
        }

        if (questions.some((question) => !question.text.trim())) {
            setError({ label: "Preguntas", message: "Todas las preguntas deben tener texto." })
            return
        }

        const hasInvalidSelectionQuestion = questions.some((question) => {
            if (question.type !== "single" && question.type !== "multiple") {
                return false
            }

            if (!question.options || question.options.length === 0) {
                return true
            }

            return question.options.some((option) => !option.text.trim())
        })

        if (hasInvalidSelectionQuestion) {
            setError({ label: "Preguntas", message: "Las preguntas de selección deben tener opciones con texto." })
            return
        }

        if (!database) {
            setError({ label: "General", message: "No hay base de datos activa para actualizar la encuesta." })
            return
        }

        try {
            setIsSubmitting(true)

            await updateSurvey(surveyId, {
                name: data.name,
                category: data.category,
                description: data.description,
                predetermined: data.predetermined,
            }, database)

            await deleteExistingQuestionsAndOptions(surveyId)

            for (let index = 0; index < questions.length; index++) {
                const question = questions[index]
                const questionId = await createQuestion({
                    surveyId,
                    text: question.text,
                    type: question.type,
                    required: question.required,
                    order: index + 1,
                }, database)

                if (question.type === "single" || question.type === "multiple") {
                    const options = question.options ?? []
                    for (let indexOption = 0; indexOption < options.length; indexOption++) {
                        const option = options[indexOption]
                        await createOption({
                            questionId,
                            order: indexOption + 1,
                            text: option.text.trim() || `Opción ${indexOption + 1}`,
                            value: option.value,
                        }, database)
                    }
                } else if (question.type === "rating") {
                    for (let numericValue = 1; numericValue <= 10; numericValue++) {
                        await createOption({
                            questionId,
                            order: numericValue,
                            text: String(numericValue),
                            value: numericValue,
                        }, database)
                    }
                }
            }

            setSuccess(true)
        } catch (err) {
            setError({ label: "General", message: err instanceof Error ? err.message : "Ocurrió un error al actualizar la encuesta." })
            return
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDeleteSurvey = async (): Promise<void> => {
        if (isDeleting || isSubmitting) {
            return
        }

        if (!surveyId) {
            setError({ label: "General", message: "No se encontró el identificador de la encuesta." })
            return
        }

        if (!database) {
            setError({ label: "General", message: "No hay base de datos activa para eliminar la encuesta." })
            return
        }

        const confirmed = window.confirm(
            "Esta acción eliminará la encuesta, todas sus preguntas y todas las respuestas registradas. ¿Deseas continuar?",
        )

        if (!confirmed) {
            return
        }

        try {
            setIsDeleting(true)
            setError({ label: "", message: "" })
            await deleteSurveyCascade(database, surveyId)
            navigate("/survey")
        } catch (err) {
            setError({
                label: "General",
                message: err instanceof Error ? err.message : "No fue posible eliminar la encuesta.",
            })
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <Layout>
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className='px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center'>
                        <div>
                            <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                                <span
                                    className="hover:text-secondary cursor-pointer transition-colors"
                                    onClick={() => navigate("/survey")}>Encuestas</span>
                                <ChevronRight className="w-4 h-4" />
                                <span>Editar</span>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight">Edita encuesta</h1>
                            <p className="font-body text-[#434843] text-sm mt-1">Actualiza la configuración y las preguntas de tu encuesta.</p>
                        </div>
                    </nav>
                </header>


                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <div className="mx-auto max-w-7xl">
                        {error.label === "General" && error.message && (
                            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                {error.message}
                            </div>
                        )}

                        {isLoading ? (
                            <section className="bg-white rounded-xl shadow-[0_20px_24px_-4px_rgba(25,28,28,0.04)] overflow-hidden p-8">
                                <div className="animate-pulse space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <span className="w-8 h-8 rounded-full bg-[#e1e3e2]" />
                                            <div className="space-y-2">
                                                <div className="h-4 bg-[#edeeed] rounded w-40" />
                                                <div className="h-3 bg-[#edeeed] rounded w-64" />
                                            </div>
                                        </div>
                                        <span className="h-6 w-24 bg-[#edeeed] rounded-full" />
                                    </div>

                                    <div className="space-y-4 pt-4">
                                        <div className="space-y-2">
                                            <div className="h-3 bg-[#edeeed] rounded w-48" />
                                            <div className="h-11 bg-[#edeeed] rounded-xl" />
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <div className="h-3 bg-[#edeeed] rounded w-36" />
                                                <div className="h-11 bg-[#edeeed] rounded-xl" />
                                            </div>
                                            <div className="flex items-center gap-3 mt-6">
                                                <span className="w-5 h-5 rounded bg-[#edeeed]" />
                                                <div className="h-3 bg-[#edeeed] rounded w-40" />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="h-3 bg-[#edeeed] rounded w-32" />
                                            <div className="h-24 bg-[#edeeed] rounded-xl" />
                                        </div>
                                    </div>
                                </div>
                            </section>
                        ) : (
                            <section className="bg-white rounded-xl shadow-[0_20px_24px_-4px_rgba(25,28,28,0.04)] overflow-hidden">
                                <div className="p-8 border-b border-[#e1e3e2]/30 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm">1</span>
                                        <h3 className="font-headline font-bold text-xl text-primary">Información Básica</h3>
                                    </div>
                                    <span className="text-xs font-label uppercase tracking-widest text-outline bg-[#edeeed] px-3 py-1 rounded-full">Requerido</span>
                                </div>


                                <div className="p-8 space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-[#434843] ml-1">Nombre de la Encuesta</label>
                                        <input
                                            onChange={(event) => {
                                                clearErrorForLabel("Nombre")
                                                setData({
                                                    ...data,
                                                    name: event.target.value,
                                                })
                                            }}
                                            value={data.name}
                                            className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] placeholder:text-outline/60" placeholder="Ej: Encuesta de satisfacción 2026" type="text" />
                                        {error.label === "Nombre" && <p className="text-sm text-red-500 mt-1">{error.message}</p>}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-sm font-bold text-[#434843] ml-1">Categoría</label>
                                            <div className="relative">
                                                <select
                                                    onChange={(event) => {
                                                        clearErrorForLabel("Categoría")
                                                        setData({
                                                            ...data,
                                                            category: event.target.value,
                                                        })
                                                    }}
                                                    value={data.category}
                                                    className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-primary-container/10 appearance-none transition-all text-[#191c1c]">
                                                    <option value="">Seleccionar categoría...</option>
                                                    {meetingKinds.map((kind) => (
                                                        <option key={kind} value={kind}>{MEETING_KIND_LABELS[kind]}</option>
                                                    ))}
                                                </select>
                                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline w-5 h-5" />
                                                {error.label === "Categoría" && <p className="text-sm text-red-500 mt-1">{error.message}</p>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 mt-6">
                                            <input
                                                onChange={(event) => {
                                                    clearErrorForLabel("General")
                                                    setData({
                                                        ...data,
                                                        predetermined: event.target.checked,
                                                    })
                                                }}
                                                checked={data.predetermined}
                                                id="default-category"
                                                type="checkbox"
                                                className="w-5 h-5 text-primary focus:ring-[#1b3022]/10 rounded transition-all"
                                            />
                                            <label htmlFor="default-category" className="text-sm font-bold text-[#434843] select-none cursor-pointer">
                                                ¿Predeterminado para esta categoría?
                                            </label>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-[#434843] ml-1">Descripción</label>
                                        <textarea
                                            onChange={(event) => {
                                                clearErrorForLabel("General")
                                                setData({
                                                    ...data,
                                                    description: event.target.value,
                                                })
                                            }}
                                            value={data.description}
                                            className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] resize-none" placeholder="Describe brevemente el objetivo de esta encuesta..." rows={4}></textarea>

                                    </div>
                                </div>
                            </section>
                        )}


                        {!isLoading && (
                            <div className="grid md:grid-cols-3 gap-8 mt-20">

                                <div className="md:col-span-2">
                                    <div className="p-8 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm">2</span>
                                            <h3 className="font-headline font-bold text-xl text-primary">Preguntas</h3>
                                        </div>
                                        <span className="text-xs font-label uppercase tracking-widest text-outline bg-[#edeeed] px-3 py-1 rounded-full">Requerido</span>
                                    </div>
                                    <div className="p-8 space-y-8">
                                        {error.label === "Preguntas" && <p className="text-sm text-red-500">{error.message}</p>}
                                        {questions.length === 0 ? (
                                            <div className="text-center text-outline text-sm py-8">Agrega tu primera pregunta usando el botón de la derecha.</div>
                                        ) : (
                                            questions.map((question, index) => (
                                                <div key={index} className="bg-white rounded-2xl shadow-[0_20px_24px_-4px_rgba(25,28,28,0.04)] border border-[#e1e3e2]/30 p-6 space-y-9">
                                                    <div className="space-y-6 border-b last:border-b-0 border-[#e1e3e2]/30 pb-6 last:pb-0">
                                                        <div className="flex gap-6 items-center justify-center">
                                                            <input
                                                                className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] placeholder:text-outline/60"
                                                                placeholder={`Pregunta ${index + 1}...`}
                                                                type="text"
                                                                value={question.text}
                                                                onChange={(event) => handleEditQuestion(index, "text", event.target.value)}
                                                            />
                                                            <div className="flex items-center space-x-2">
                                                                <span className="text-xs font-label uppercase tracking-widest text-outline">Obligatoria</span>
                                                                <button
                                                                    type="button"
                                                                    aria-pressed={question.required}
                                                                    aria-label={question.required ? "Marcar como no obligatoria" : "Marcar como obligatoria"}
                                                                    onClick={() => handleEditQuestion(index, "required", !question.required)}
                                                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${question.required ? "bg-primary" : "bg-gray-300"}`}
                                                                >
                                                                    <span
                                                                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${question.required ? "translate-x-5" : "translate-x-1"}`}
                                                                    />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-6 items-start">
                                                            <div className="space-y-3">
                                                                <div className="space-y-2">
                                                                    <label className="text-xs uppercase tracking-widest text-outline">Tipo de pregunta</label>
                                                                    <div className="relative">
                                                                        <select
                                                                            className="w-full bg-[#edeeed] border-none rounded-md px-4 py-2.5 appearance-none focus:ring-2 focus:ring-[#1b3022] font-medium text-sm"
                                                                            value={question.type}
                                                                            onChange={(event) => handleEditQuestion(index, "type", event.target.value as QuestionType)}
                                                                        >
                                                                            <option value="single">Selección única</option>
                                                                            <option value="multiple">Selección múltiple</option>
                                                                            <option value="text">Texto libre</option>
                                                                            <option value="rating">Escala de valoración 1 - 10</option>
                                                                        </select>
                                                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-outline w-5 h-5" />
                                                                    </div>
                                                                </div>

                                                                {(question.type === "single" || question.type === "multiple") && (
                                                                    <div className="space-y-2 mt-4">
                                                                        <p className="text-xs font-label uppercase tracking-widest text-outline">Opciones de respuesta</p>
                                                                        <div className="space-y-2">
                                                                            {(question.options ?? []).map((option, optionIndex) => (
                                                                                <div key={optionIndex} className="flex items-center gap-2">
                                                                                    <input
                                                                                        className="flex-1 px-3 py-2 bg-[#f5f5f5] border-none rounded-lg focus:ring-2 focus:ring-[#1b3022]/10 text-sm"
                                                                                        placeholder={`Opción ${optionIndex + 1}`}
                                                                                        value={option.text}
                                                                                        onChange={(event) => handleEditOption(index, optionIndex, event.target.value)}
                                                                                    />
                                                                                    <button
                                                                                        type="button"
                                                                                        className="p-2 text-error hover:bg-[#ffdad6] rounded-lg transition-all"
                                                                                        title="Eliminar opción"
                                                                                        onClick={() => handleDeleteOption(index, optionIndex)}
                                                                                    >
                                                                                        <Trash className="w-4 h-4 text-red-500 hover:text-[#93000a]" />
                                                                                    </button>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            className="mt-2 text-xs font-semibold text-primary hover:underline"
                                                                            onClick={() => handleAddOption(index)}
                                                                        >
                                                                            Añadir opción
                                                                        </button>
                                                                    </div>
                                                                )}

                                                            </div>
                                                            <div className="flex justify-end space-x-3 self-end">
                                                                <button
                                                                    type="button"
                                                                    className="p-2.5 text-outline hover:bg-[#edeeed] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                                                    title="Mover pregunta hacia arriba"
                                                                    onClick={() => handleMoveQuestionUp(index)}
                                                                    disabled={index === 0}
                                                                >
                                                                    <ArrowUp className="w-5 h-5" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="p-2.5 text-outline hover:bg-[#edeeed] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                                                    title="Mover pregunta hacia abajo"
                                                                    onClick={() => handleMoveQuestionDown(index)}
                                                                    disabled={index === questions.length - 1}
                                                                >
                                                                    <ArrowDown className="w-5 h-5" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="p-2.5 text-outline hover:bg-[#edeeed] rounded-lg transition-all"
                                                                    title="Duplicar pregunta"
                                                                    onClick={() => handleDuplicateQuestion(index)}
                                                                >
                                                                    <Copy className="w-5 h-5" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="p-2.5 text-error hover:bg-[#ffdad6] rounded-lg transition-all"
                                                                    title="Eliminar pregunta"
                                                                    onClick={() => handleDeleteQuestion(index)}
                                                                >
                                                                    <Trash className="w-5 h-5 text-red-500 hover:text-[#93000a]" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>


                                <div className=" sticky top-24 space-y-6">
                                    <div className="bg-[#f3f4f3] rounded-xl p-8 border border-[#e1e3e2]/30">
                                        <h4 className="font-headline font-bold text-lg mb-6">Herramientas</h4>
                                        <div className="space-y-4">
                                            <button
                                                type="button"
                                                onClick={handleAddQuestion}
                                                className="w-full group bg-white p-4 rounded-xl flex items-center justify-between hover:bg-[#1b3022] hover:text-white transition-all duration-300"
                                            >
                                                <div className="flex items-center space-x-4">
                                                    <PlusCircle className="w-5 h-5 text-[#1b3022] group-hover:text-white" />
                                                    <span className="font-semibold">Añadir Pregunta</span>
                                                </div>
                                                <ArrowRight className="w-5 h-5 text-[#1b3022] group-hover:text-white" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleDeleteSurvey}
                                                disabled={isDeleting || isSubmitting}
                                                className="w-full group bg-white p-4 rounded-xl flex items-center justify-between border border-[#ffd9d6] text-[#93000a] hover:bg-[#93000a] hover:text-white transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                                            >
                                                <div className="flex items-center space-x-4">
                                                    <Trash className="w-5 h-5 text-[#93000a] group-hover:text-white" />
                                                    <span className="font-semibold">{isDeleting ? "Eliminando encuesta..." : "Eliminar Encuesta"}</span>
                                                </div>
                                                <ArrowRight className="w-5 h-5 text-[#93000a] group-hover:text-white" />
                                            </button>
                                        </div>
                                        <div className="mt-8 pt-8 border-t border-[#e1e3e2]/50">
                                            <p className="text-xs font-label uppercase tracking-widest text-outline mb-4">Estadísticas de Estructura</p>
                                            <div className="space-y-3">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-on-surface-variant">Total Preguntas</span>
                                                    <span className="font-bold">{questions.length}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-on-surface-variant">Tiempo Estimado</span>
                                                    <span className="font-bold">{Math.max(1, Math.ceil(questions.length * 0.33))} min</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-on-surface-variant">Obligatorias</span>
                                                    <span className="font-bold">{questions.filter((question) => question.required).length}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>


                                    <div className="mt-12">
                                        <button
                                            onClick={handleSubmit}
                                            type="button"
                                            disabled={isSubmitting || isDeleting}
                                            className="w-full px-6 py-4 bg-primary text-white font-semibold rounded-3xl transition-all duration-300 hover:bg-primary-light disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {isSubmitting ? "Guardando encuesta..." : "Guardar Cambios"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </div>

            {success && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-8 max-w-sm text-center">
                        <h2 className="text-2xl font-bold mb-4">¡Encuesta actualizada con éxito!</h2>
                        <p className="text-gray-600 mb-6">Los cambios se han guardado correctamente.</p>
                        <button
                            onClick={() => navigate("/survey")}
                            className="px-6 py-3 bg-primary text-white font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light"
                        >Volver a Encuestas</button>
                    </div>
                </div>
            )}
        </Layout >
    )
}

export default EditSurveyPage
