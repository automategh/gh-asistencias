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