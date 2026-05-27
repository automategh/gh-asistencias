import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import { createOption, createQuestion, createSurvey, type QuestionType, type Survey, type SurveyQuestion } from "@/services/forms.service"
import type { MeetingKind } from "@/types/meeting"

import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, Copy, PlusCircle, Trash } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"

/**
 * Borrador de opción de respuesta manejado en el constructor de encuestas.
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
 * Pantalla de creación de nuevas encuestas.
 * Permite definir la información básica y construir dinámicamente el listado de preguntas
 * antes de persistir la configuración en Realtime Database.
 */
function NewSurveyPage() {
    const navigate = useNavigate()
    const { database } = useDatabase()

    const [data, setData] = useState({
        name: '',
        category: '',
        description: '',
        predetermined: false
    })

    // Listado de preguntas que componen la encuesta.
    // No se manejan los campos "id" ni "surveyId" aquí, ya que los asigna Firebase.
    // Para preguntas de selección se gestionan opciones locales en la propiedad "options".
    const [questions, setQuestions] = useState<QuestionDraft[]>([])
    // Estado de error contextualizado por campo para mostrar mensajes de validación en UI.
    const [error, setError] = useState({
        label: '',
        message: ''
    })

    // Bandera de éxito para mostrar modal de confirmación cuando la encuesta se crea correctamente.
    const [success, setSuccess] = useState(false)

    // Bandera de envío para evitar envíos dobles y mostrar feedback de carga.
    const [isSubmitting, setIsSubmitting] = useState(false)

    const clearErrorForLabel = (label: string): void => {
        setError(prev => (prev.label === label ? { label: '', message: '' } : prev))
    }

    /**
     * Añade una nueva pregunta vacía al final del formulario, con valores por defecto.
     */
    const handleAddQuestion = () => {
        clearErrorForLabel('Preguntas')
        setQuestions(prev => ([
            ...prev,
            {
                text: "",
                order: prev.length + 1,
                required: false,
                type: "text",
            },
        ]))
    }

    /**
     * Actualiza un campo concreto de una pregunta identificada por su índice en el arreglo.
     * Permite modificar texto, tipo y si es obligatoria sin mutar el estado original.
     */
    const handleEditQuestion = (index: number, field: keyof Omit<SurveyQuestion, "id" | "surveyId">, value: string | boolean) => {
        clearErrorForLabel('Preguntas')
        setQuestions(prev => prev.map((q, i) => {
            if (i !== index) {
                return q
            }

            // Cuando cambia el tipo de pregunta, también debemos ajustar
            // la estructura de opciones para que la UI y la persistencia
            // estén alineadas con el nuevo tipo.
            if (field === "type") {
                const nextType = value as QuestionType

                let nextOptions: QuestionOptionDraft[] | undefined

                // Para preguntas de selección (única o múltiple) se inicializa
                // un mínimo de 2 opciones. Si venimos de una escala de rating,
                // siempre se reinician para evitar arrastrar las 10 opciones numéricas.
                if (nextType === "single" || nextType === "multiple") {
                    const isComingFromRating = q.type === "rating"

                    nextOptions = !isComingFromRating && q.options && q.options.length > 0
                        ? q.options
                        : [
                            { text: "Opción 1" },
                            { text: "Opción 2" },
                        ]
                // Para preguntas de tipo rating se genera automáticamente
                // una escala fija del 1 al 10 con su valor numérico asociado.
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
                    ...q,
                    type: nextType,
                    options: nextOptions,
                }
            }

            return {
                ...q,
                [field]: value,
            }
        }))
    }

    /**
     * Duplica una pregunta existente tomando sus campos relevantes y añadiéndola al final.
     * Se recalcula el orden para mantener la numeración consistente.
     */
    const handleDuplicateQuestion = (index: number) => {
        setQuestions(prev => {
            const q = prev[index]
            if (!q) return prev
            // Duplicar sin id, solo los campos relevantes
            const { text, required, type, options } = q
            return [
                ...prev,
                {
                    text,
                    order: prev.length + 1,
                    required,
                    type,
                    options: options ? options.map((option) => ({ ...option })) : undefined,
                },
            ]
        })
    }

    /**
     * Elimina una pregunta según su índice dentro del listado actual.
     */
    const handleDeleteQuestion = (index: number) => {
        clearErrorForLabel('Preguntas')
        setQuestions(prev => prev
            .filter((_, i) => i !== index)
            .map((question, currentIndex) => ({
                ...question,
                order: currentIndex + 1,
            })))
    }

    /**
     * Añade una nueva opción al final de la lista de opciones de una pregunta
     * de tipo selección (single/multiple).
     */
    const handleAddOption = (questionIndex: number) => {
        clearErrorForLabel('Preguntas')
        setQuestions(prev => prev.map((question, index) => {
            if (index !== questionIndex) {
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

    /**
     * Actualiza el texto de una opción concreta identificada por su índice
     * dentro de una pregunta determinada.
     */
    const handleEditOption = (questionIndex: number, optionIndex: number, text: string) => {
        clearErrorForLabel('Preguntas')
        setQuestions(prev => prev.map((question, index) => {
            if (index !== questionIndex || !question.options) {
                return question
            }

            const updatedOptions = question.options.map((option, indexOption) => {
                if (indexOption !== optionIndex) {
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

    /**
     * Elimina una opción de respuesta de la pregunta indicada, manteniendo
     * el resto de opciones sin mutaciones directas del estado previo.
     */
    const handleDeleteOption = (questionIndex: number, optionIndex: number) => {
        clearErrorForLabel('Preguntas')
        setQuestions(prev => prev.map((question, index) => {
            if (index !== questionIndex || !question.options) {
                return question
            }

            const filteredOptions = question.options.filter((_, indexOption) => indexOption !== optionIndex)

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

        setQuestions(prev => reorderQuestions(prev, index, index - 1))
    }

    /**
     * Mueve una pregunta una posición hacia abajo en el listado visual.
     */
    const handleMoveQuestionDown = (index: number): void => {
        setQuestions(prev => {
            if (index >= prev.length - 1) {
                return prev
            }

            return reorderQuestions(prev, index, index + 1)
        })
    }

    // Opciones de categoría basadas en los tipos de reuniones configurados en la aplicación.
    // Se parte del tipo MeetingKind para mantener un solo origen de verdad.
    const MEETING_KIND_LABELS: Record<MeetingKind, string> = {
        meeting: "Reunión",
        training: "Capacitación",
        custom: "Personalizada",
    }

    const meetingKinds: MeetingKind[] = ["meeting", "training", "custom"]

    /**
     * Valida los datos del formulario, crea la encuesta en Realtime Database y
     * posteriormente persiste cada una de las preguntas asociadas.
     */
    const handleSubmit = async () => {
        if (isSubmitting) {
            return
        }

        setError({ label: '', message: '' })

        // Validación básica de campos obligatorios
        if (!data.name.trim()) {
            setError({ label: "Nombre", message: "El nombre es obligatorio." });
            return;
        }
        if (!data.category) {
            setError({ label: "Categoría", message: "Selecciona una categoría." });
            return;
        }
        if (questions.length === 0) {
            setError({ label: "Preguntas", message: "Agrega al menos una pregunta." });
            return;
        }
        if (questions.some(q => !q.text.trim())) {
            setError({ label: "Preguntas", message: "Todas las preguntas deben tener texto." });
            return;
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

        // preparamos los payloads para crear la encuesta y sus preguntas, luego redirigimos a la página de detalles de la encuesta recién creada}
        const surveyData: Omit<Survey, 'id'> = {
            name: data.name,
            category: data.category,
            description: data.description,
            predetermined: data.predetermined,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }

        try {
            setIsSubmitting(true)
            if (!database) {
                setError({ label: "General", message: "No hay base de datos activa para crear la encuesta." })
                return
            }

            const surveyId = await createSurvey(surveyData, database)
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i]
                const questionId = await createQuestion({
                    surveyId,
                    text: q.text,
                    type: q.type,
                    required: q.required,
                    order: i + 1,
                }, database)

                if (q.type === "single" || q.type === "multiple") {
                    const options = q.options ?? []
                    for (let indexOption = 0; indexOption < options.length; indexOption++) {
                        const option = options[indexOption]
                        await createOption({
                            questionId,
                            order: indexOption + 1,
                            text: option.text.trim() || `Opción ${indexOption + 1}`,
                            value: option.value,
                        }, database)
                    }
                } else if (q.type === "rating") {
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
            setError({ label: "General", message: err instanceof Error ? err.message : "Ocurrió un error al crear la encuesta." })
            return
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <Layout
            header={{
                breadcrumbs: [{ label: 'Encuestas', to: '/survey' }, { label: 'Nueva' }],
                title: 'Crea nueva encuesta',
                description: 'Diseña y configura los parámetros de la encuesta según tus necesidades.',
            }}
        >
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>
                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <div className="mx-auto max-w-7xl">
                        {error.label === 'General' && error.message && (
                            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                {error.message}
                            </div>
                        )}
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
                                        onChange={(e) => {
                                            clearErrorForLabel('Nombre')
                                            setData({
                                                ...data,
                                                name: e.target.value,
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
                                                onChange={(e) => {
                                                    clearErrorForLabel('Categoría')
                                                    setData({
                                                        ...data,
                                                        category: e.target.value,
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
                                            onChange={(e) => {
                                                clearErrorForLabel('General')
                                                setData({
                                                    ...data,
                                                    predetermined: e.target.checked,
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
                                        onChange={(e) => {
                                            clearErrorForLabel('General')
                                            setData({
                                                ...data,
                                                description: e.target.value,
                                            })
                                        }}
                                        value={data.description}
                                        className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] resize-none" placeholder="Describe brevemente el objetivo de esta encuesta..." rows={4}></textarea>

                                </div>
                            </div>
                        </section>


                        <div className="grid md:grid-cols-3 gap-8 mt-20">

                            {/* preguntas */}
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
                                        questions.map((q, idx) => (
                                            <div key={idx} className="bg-white rounded-2xl shadow-[0_20px_24px_-4px_rgba(25,28,28,0.04)] border border-[#e1e3e2]/30 p-6 space-y-9">
                                                <div className={`space-y-6 border-b last:border-b-0 border-[#e1e3e2]/30 pb-6 last:pb-0`}>
                                                    <div className="flex gap-6 items-center justify-center">
                                                        <input
                                                            className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] placeholder:text-outline/60"
                                                            placeholder={`Pregunta ${idx + 1}...`}
                                                            type="text"
                                                            value={q.text}
                                                            onChange={e => handleEditQuestion(idx, 'text', e.target.value)}
                                                        />
                                                        <div className="flex items-center space-x-2">
                                                            <span className="text-xs font-label uppercase tracking-widest text-outline">Obligatoria</span>
                                                            <button
                                                                type="button"
                                                                aria-pressed={q.required}
                                                                aria-label={q.required ? 'Marcar como no obligatoria' : 'Marcar como obligatoria'}
                                                                onClick={() => handleEditQuestion(idx, 'required', !q.required)}
                                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${q.required ? 'bg-primary' : 'bg-gray-300'}`}
                                                            >
                                                                <span
                                                                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${q.required ? 'translate-x-5' : 'translate-x-1'}`}
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
                                                                        value={q.type}
                                                                        onChange={e => handleEditQuestion(idx, 'type', e.target.value as QuestionType)}
                                                                    >
                                                                        <option value="single">Selección única</option>
                                                                        <option value="multiple">Selección múltiple</option>
                                                                        <option value="text">Texto libre</option>
                                                                        <option value="rating">Escala de valoración 1 - 10</option>
                                                                    </select>
                                                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-outline w-5 h-5" />
                                                                </div>
                                                            </div>

                                                            {(q.type === "single" || q.type === "multiple") && (
                                                                <div className="space-y-2 mt-4">
                                                                    <p className="text-xs font-label uppercase tracking-widest text-outline">Opciones de respuesta</p>
                                                                    <div className="space-y-2">
                                                                        {(q.options ?? []).map((option, indexOption) => (
                                                                            <div key={indexOption} className="flex items-center gap-2">
                                                                                <input
                                                                                    className="flex-1 px-3 py-2 bg-[#f5f5f5] border-none rounded-lg focus:ring-2 focus:ring-[#1b3022]/10 text-sm"
                                                                                    placeholder={`Opción ${indexOption + 1}`}
                                                                                    value={option.text}
                                                                                    onChange={(event) => handleEditOption(idx, indexOption, event.target.value)}
                                                                                />
                                                                                <button
                                                                                    type="button"
                                                                                    className="p-2 text-error hover:bg-[#ffdad6] rounded-lg transition-all"
                                                                                    title="Eliminar opción"
                                                                                    onClick={() => handleDeleteOption(idx, indexOption)}
                                                                                >
                                                                                    <Trash className="w-4 h-4 text-red-500 hover:text-[#93000a]" />
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        className="mt-2 text-xs font-semibold text-primary hover:underline"
                                                                        onClick={() => handleAddOption(idx)}
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
                                                                onClick={() => handleMoveQuestionUp(idx)}
                                                                disabled={idx === 0}
                                                            >
                                                                <ArrowUp className="w-5 h-5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="p-2.5 text-outline hover:bg-[#edeeed] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                                                title="Mover pregunta hacia abajo"
                                                                onClick={() => handleMoveQuestionDown(idx)}
                                                                disabled={idx === questions.length - 1}
                                                            >
                                                                <ArrowDown className="w-5 h-5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="p-2.5 text-outline hover:bg-[#edeeed] rounded-lg transition-all"
                                                                title="Duplicar pregunta"
                                                                onClick={() => handleDuplicateQuestion(idx)}
                                                            >
                                                                <Copy className="w-5 h-5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="p-2.5 text-error hover:bg-[#ffdad6] rounded-lg transition-all"
                                                                title="Eliminar pregunta"
                                                                onClick={() => handleDeleteQuestion(idx)}
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


                            {/* herramientas */}
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
                                                <span className="font-bold">{questions.filter(q => q.required).length}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>


                                <div className="mt-12">
                                    <button
                                        onClick={handleSubmit}
                                        type="button"
                                        disabled={isSubmitting}
                                        className="w-full px-6 py-4 bg-primary text-white font-semibold rounded-3xl transition-all duration-300 hover:bg-primary-light disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting ? 'Guardando encuesta...' : 'Guardar Encuesta'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {success && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-8 max-w-sm text-center">
                        <h2 className="text-2xl font-bold mb-4">¡Encuesta creada con éxito!</h2>
                        <p className="text-gray-600 mb-6">Tu nueva encuesta ha sido guardada correctamente.</p>
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

export default NewSurveyPage