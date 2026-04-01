import { get, push, ref, set, type Database } from "firebase/database"

/**
 * Estructura principal de una encuesta almacenada en Realtime Database.
 * Representa la configuración general de una encuesta sin incluir sus preguntas.
 */
export type Survey = {
    id: string
    name: string
    description?: string
    category: string
    predetermined?: boolean
    isActive: boolean
    createdAt: string
    updatedAt: string
}

/**
 * Tipos disponibles de pregunta dentro de una encuesta.
 * - "single": selección única.
 * - "multiple": selección múltiple.
 * - "text": respuesta abierta.
 * - "rating": escala numérica (por ejemplo 1-10).
 */
export type QuestionType = "single" | "multiple" | "text" | "rating"

/**
 * Pregunta asociada a una encuesta específica.
 * Cada pregunta pertenece a una encuesta a través de "surveyId".
 */
export type SurveyQuestion = {
    id: string
    surveyId: string
    order: number
    text: string
    type: QuestionType
    required: boolean
}

/**
 * Opción de respuesta para una pregunta de tipo selección o escala.
 * Se almacena por separado para permitir reutilización y ordenamiento.
 */
export type SurveyOption = {
    id: string
    questionId: string
    order: number
    text: string
    value?: number
}

/**
 * Crea una nueva encuesta en la base de datos.
 * @param data Datos de la encuesta a crear (sin el campo "id")
 * @param database Instancia de Realtime Database donde se almacenará la encuesta}
 * @return El ID generado para la nueva encuesta
 * @throws Error si no se pudo generar el ID o si la base de datos no está disponible
 * @remarks El campo "createdAt" debe ser una fecha ISO válida, y "isActive" indica si la encuesta está activa para los usuarios.
 */
export async function createSurvey(data: Omit<Survey, "id">, database: Database) {
    const newRef = push(ref(database, "surveys"))

    const newSurvey = {
        ...data,
        id: newRef.key
    }

    await set(newRef, newSurvey)

    return newRef.key as string
}

/**
 * Obtiene una encuesta específica por su identificador.
 * @param database Instancia de Realtime Database
 * @param id Identificador de la encuesta (clave en `surveys/{id}`)
 * @returns La encuesta encontrada o null si no existe.
 */
export async function getSurveyById(database: Database, id: string): Promise<Survey | null> {
    const surveyRef = ref(database, `surveys/${id}`)
    const snapshot = await get(surveyRef)

    if (!snapshot.exists()) {
        return null
    }

    const value = snapshot.val() as Survey | null
    return value ?? null
}

/**
 * Actualiza los metadatos de una encuesta existente.
 * Conserva el `createdAt` original y fuerza la actualización del campo `updatedAt`.
 * @param id Identificador de la encuesta a actualizar
 * @param data Campos a modificar (por ejemplo nombre, categoría, descripción)
 * @param database Instancia de Realtime Database
 */
export async function updateSurvey(
    id: string,
    data: Partial<Omit<Survey, "id" | "createdAt">>,
    database: Database,
): Promise<void> {
    const surveyRef = ref(database, `surveys/${id}`)
    const snapshot = await get(surveyRef)

    if (!snapshot.exists()) {
        throw new Error("La encuesta que intentas actualizar no existe.")
    }

    const current = snapshot.val() as Survey

    const updated: Survey = {
        ...current,
        ...data,
        id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
    }

    await set(surveyRef, updated)
}

/**
 * Obtiene todas las encuestas almacenadas en la base de datos.
 * @param database Instancia de Realtime Database desde la que se leerán las encuestas.
 * @returns Arreglo de encuestas tipadas, ordenadas por fecha de creación descendente.
 */
export async function getSurveys(database: Database): Promise<Survey[]> {
    const surveysRef = ref(database, "surveys")
    const snapshot = await get(surveysRef)

    const rawValue = snapshot.val() as Record<string, Survey> | null
    if (!rawValue) {
        return []
    }

    const items = Object.values(rawValue)

    return items.sort((first, second) => {
        return second.createdAt.localeCompare(first.createdAt)
    })
}

type SurveyQuestionRecord = Omit<SurveyQuestion, "id">
type SurveyOptionRecord = Omit<SurveyOption, "id">

/**
 * Obtiene todas las preguntas pertenecientes a una encuesta concreta.
 * @param database Instancia de Realtime Database
 * @param surveyId Identificador de la encuesta a la que pertenecen las preguntas
 * @returns Arreglo de preguntas ordenadas por su campo `order`.
 */
export async function getSurveyQuestionsBySurveyId(database: Database, surveyId: string): Promise<SurveyQuestion[]> {
    const questionsRef = ref(database, "surveyQuestions")
    const snapshot = await get(questionsRef)

    const rawValue = snapshot.val() as Record<string, SurveyQuestionRecord> | null
    if (!rawValue) {
        return []
    }

    const items: SurveyQuestion[] = Object.entries(rawValue)
        .filter(([, question]) => question.surveyId === surveyId)
        .map(([id, question]) => ({
            ...question,
            id,
        }))

    return items.sort((first, second) => first.order - second.order)
}

/**
 * Obtiene todas las opciones asociadas a un conjunto de preguntas.
 * @param database Instancia de Realtime Database
 * @param questionIds Identificadores de preguntas para las que se desean las opciones
 * @returns Arreglo de opciones ordenadas por su campo `order`.
 */
export async function getSurveyOptionsByQuestionIds(database: Database, questionIds: readonly string[]): Promise<SurveyOption[]> {
    if (questionIds.length === 0) {
        return []
    }

    const optionsRef = ref(database, "surveyOptions")
    const snapshot = await get(optionsRef)

    const rawValue = snapshot.val() as Record<string, SurveyOptionRecord> | null
    if (!rawValue) {
        return []
    }

    const questionIdSet = new Set(questionIds)

    const items: SurveyOption[] = Object.entries(rawValue)
        .filter(([, option]) => questionIdSet.has(option.questionId))
        .map(([id, option]) => ({
            ...option,
            id,
        }))

    return items.sort((first, second) => first.order - second.order)
}

/**
 * Crea una nueva pregunta para una encuesta específica.
 * @param data Datos de la pregunta a crear (sin el campo "id")
 * @param database Instancia de Realtime Database donde se almacenará la pregunta
 * @return El ID generado para la nueva pregunta
 * @throws Error si no se pudo generar el ID o si la base de datos no está disponible
 * @remarks El campo "surveyId" debe corresponder al ID de una encuesta existente, y "type" define el tipo de pregunta (p. ej. "single", "multiple", "text", "rating").
 */
export const createQuestion = async (data: Omit<SurveyQuestion, 'id'>, database: Database) => {
    const newRef = push(ref(database, 'surveyQuestions'))

    await set(newRef, data)

    return newRef.key as string
}

/**
 * Crea una nueva opción para una pregunta de encuesta específica.
 * @param data Datos de la opción a crear (sin el campo "id")
 * @param database Instancia de Realtime Database donde se almacenará la opción
 * @return El ID generado para la nueva opción
 * @throws Error si no se pudo generar el ID o si la base de datos no está disponible
 * @remarks El campo "questionId" debe corresponder al ID de una pregunta existente, y "value" es opcional para preguntas de tipo "rating".
 */
export const createOption = async (data: Omit<SurveyOption, 'id'>, database: Database) => {
    const newRef = push(ref(database, 'surveyOptions'))

    await set(newRef, data)

    return newRef.key as string
}