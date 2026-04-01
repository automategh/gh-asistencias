import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import { createQuestion, createSurvey, type Survey, type SurveyQuestion } from "@/services/forms.service"
import type { MeetingKind } from "@/types/meeting"

import { ArrowRight, ChevronDown, ChevronRight, Copy, PlusCircle, Trash } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"

/**
 * Tipos de pregunta soportados por el constructor visual de encuestas.
 * Se utilizan para controlar el renderizado y la validación en el formulario.
 */
type QuestionType = "nps" | "scale" | "text"

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
    const [questions, setQuestions] = useState<Omit<SurveyQuestion, 'id' | 'surveyId'>[]>([])
    // Estado de error contextualizado por campo para mostrar mensajes de validación en UI.
    const [error, setError] = useState({
        label: '',
        message: ''
    })

    // Bandera de éxito para mostrar modal de confirmación cuando la encuesta se crea correctamente.
    const [success, setSuccess] = useState(false)

    /**
     * Añade una nueva pregunta vacía al final del formulario, con valores por defecto.
     */
    const handleAddQuestion = () => {
        setQuestions(prev => ([
            ...prev,
            {
                text: '',
                order: prev.length + 1,
                required: false,
                type: 'text',
            }
        ]))
    }

    /**
     * Actualiza un campo concreto de una pregunta identificada por su índice en el arreglo.
     * Permite modificar texto, tipo y si es obligatoria sin mutar el estado original.
     */
    const handleEditQuestion = (index: number, field: keyof Omit<SurveyQuestion, 'id' | 'surveyId'>, value: string | boolean) => {
        setQuestions(prev => prev.map((q, i) =>
            i === index ? { ...q, [field]: value } : q
        ))
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
            const { text, required, type } = q
            return [
                ...prev,
                { text, order: prev.length + 1, required, type }
            ]
        })
    }

    /**
     * Elimina una pregunta según su índice dentro del listado actual.
     */
    const handleDeleteQuestion = (index: number) => {
        setQuestions(prev => prev.filter((_, i) => i !== index))
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
            const surveyId = await createSurvey(surveyData, database!)
            // Aquí podríamos crear las preguntas asociadas a la encuesta usando createQuestion y luego redirigir a la página de detalles de la encuesta recién creada

            for (let i = 0; i < questions.length; i++) {
                const q = questions[i]
                await createQuestion({
                    surveyId,
                    text: q.text,
                    type: q.type,
                    required: q.required,
                    order: q.order
                }, database!)
            }

            setSuccess(true)
        } catch (err) {
            setError({ label: "General", message: err instanceof Error ? err.message : "Ocurrió un error al crear la encuesta." })
            return
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
                                <span>Nueva</span>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight">Crea nueva encuesta</h1>
                            <p className="font-body text-[#434843] text-sm mt-1">Diseña y configura los parámetros de la encuesta según tus necesidades.</p>
                        </div>
                    </nav>
                </header>


                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <div className="mx-auto max-w-7xl">
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
                                        onChange={(e) => setData({
                                            ...data, name: e.target.value
                                        })}
                                        value={data.name}
                                        className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] placeholder:text-outline/60" placeholder="Ej: Encuesta de satisfacción 2026" type="text" />
                                    {error.label === "Nombre" && <p className="text-sm text-red-500 mt-1">{error.message}</p>}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-[#434843] ml-1">Categoría</label>
                                        <div className="relative">
                                            <select
                                                onChange={(e) => setData({
                                                    ...data, category: e.target.value
                                                })}
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
                                            onChange={(e) => setData({
                                                ...data, predetermined: e.target.checked
                                            })}
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
                                        onChange={(e) => setData({
                                            ...data, description: e.target.value
                                        })}
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
                                                    <div className="grid grid-cols-2 gap-6 items-end">
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
                                                        <div className="flex justify-end space-x-3">
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
                                    <button onClick={handleSubmit} type="button" className="w-full px-6 py-4 bg-primary text-white font-semibold rounded-3xl transition-all duration-300 hover:bg-primary-light">Guardar Encuesta</button>
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