import { get, push, ref, set, type Database } from "firebase/database"
import { getAllAvailableDatabases } from "@/lib/firebase/databaseResolver"
import { getDatabaseForUrl } from "@/services/firebase"

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
 * Valor permitido para una respuesta de encuesta.
 * Puede ser texto libre, una lista de IDs de opciones (para selección múltiple)
 * o un valor numérico (por ejemplo para escalas de rating).
 */
export type SurveyAnswerValue = string | string[] | number

/**
 * Respuesta persistida de una encuesta.
 * Se almacena bajo `surveyResponses/{surveyId}/{trainingId}/{userId}`.
 */
export type SurveyResponse = {
    /** Identificador de la respuesta (se reutiliza el uid del colaborador) */
    id: string
    /** Encuesta a la que corresponde la respuesta */
    surveyId: string
    /** Identificador de la capacitación/reunión relacionada */
    trainingId: string
    /** UID del colaborador que respondió */
    userId: string
    /** Nombre visible del colaborador (snapshot para UI) */
    userName?: string | null
    /** Email del colaborador (snapshot para UI) */
    userEmail?: string | null
    /** Fecha de creación en formato ISO 8601 */
    createdAt: string
    /** Respuestas por id de pregunta */
    answers: Record<string, SurveyAnswerValue>
}


/**
 * Localiza en qué base de datos está almacenada una encuesta a partir de su ID.
 *
 * - Recorre todas las bases de datos configuradas (corporativo, CCCI, CCCR, CEVP, ...).
 * - Para cada una, consulta `surveys/{surveyId}`.
 * - Devuelve la primera coincidencia encontrada con su Database.
 *
 * Si no se encuentra la encuesta en ninguna base de datos, devuelve `null`.
 */
export async function findSurveyDatabaseById(surveyId: string): Promise<Database | null> {
    const cleanId = surveyId.trim()
    if (!cleanId) {
        return null
    }

    const databases = getAllAvailableDatabases()

    for (const dbInfo of databases) {
        const db = getDatabaseForUrl(dbInfo.url)
        if (!db) {
            continue
        }

        const surveyRef = ref(db, `surveys/${cleanId}`)
        const snapshot = await get(surveyRef)

        if (snapshot.exists()) {
            return db
        }
    }

    return null
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

/**
 * Obtiene, si existe, la respuesta de un colaborador para una encuesta y capacitación concretas.
 * Devuelve `null` cuando el usuario aún no ha respondido.
 */
export async function getSurveyResponse(
    database: Database,
    params: { surveyId: string; trainingId: string; userId: string },
): Promise<SurveyResponse | null> {
    const trimmedSurveyId = params.surveyId.trim()
    const trimmedTrainingId = params.trainingId.trim()
    const trimmedUserId = params.userId.trim()

    if (!trimmedSurveyId || !trimmedTrainingId || !trimmedUserId) {
        return null
    }

    const responseRef = ref(database, `surveyResponses/${trimmedSurveyId}/${trimmedTrainingId}/${trimmedUserId}`)
    const snapshot = await get(responseRef)

    if (!snapshot.exists()) {
        return null
    }

    const value = snapshot.val() as SurveyResponse | null
    return value ?? null
}

/**
 * Obtiene todas las respuestas de una encuesta agrupadas por capacitación.
 *
 * Lee el nodo `surveyResponses/{surveyId}` y devuelve un mapa donde la clave
 * es el `trainingId` y el valor es el arreglo de respuestas asociadas.
 */
export async function getSurveyResponsesByTraining(
    database: Database,
    surveyId: string,
): Promise<Record<string, SurveyResponse[]>> {
    const cleanId = surveyId.trim()
    if (!cleanId) {
        return {}
    }

    const rootRef = ref(database, `surveyResponses/${cleanId}`)
    const snapshot = await get(rootRef)

    if (!snapshot.exists()) {
        return {}
    }

    const rawValue = snapshot.val() as Record<string, Record<string, SurveyResponse>> | null
    if (!rawValue) {
        return {}
    }

    const grouped: Record<string, SurveyResponse[]> = {}

    for (const [trainingId, responsesByUser] of Object.entries(rawValue)) {
        const items = Object.values(responsesByUser ?? {})
        if (items.length > 0) {
            grouped[trainingId] = items
        }
    }

    return grouped
}

/**
 * Obtiene todas las respuestas registradas para una combinación
 * concreta de encuesta y capacitación.
 *
 * Se lee el nodo `surveyResponses/{surveyId}/{trainingId}` y se
 * devuelve un arreglo tipado de respuestas.
 */
export async function getSurveyResponsesForTraining(
    database: Database,
    params: { surveyId: string; trainingId: string },
): Promise<SurveyResponse[]> {
    const trimmedSurveyId = params.surveyId.trim()
    const trimmedTrainingId = params.trainingId.trim()

    if (!trimmedSurveyId || !trimmedTrainingId) {
        return []
    }

    const responsesRef = ref(database, `surveyResponses/${trimmedSurveyId}/${trimmedTrainingId}`)
    const snapshot = await get(responsesRef)

    if (!snapshot.exists()) {
        return []
    }

    const rawValue = snapshot.val() as Record<string, SurveyResponse> | null
    if (!rawValue) {
        return []
    }

    return Object.values(rawValue)
}

/**
 * Guarda (o sobrescribe) la respuesta de un colaborador para una encuesta dada.
 *
 * La respuesta se normaliza en el nodo:
 * `surveyResponses/{surveyId}/{trainingId}/{userId}`
 * usando el UID del usuario como clave primaria para evitar duplicados.
 */
export async function saveSurveyResponse(
    database: Database,
    params: {
        surveyId: string
        trainingId: string
        userId: string
        userName?: string | null
        userEmail?: string | null
        answers: Record<string, SurveyAnswerValue | null | undefined>
    },
): Promise<SurveyResponse> {
    const trimmedSurveyId = params.surveyId.trim()
    const trimmedTrainingId = params.trainingId.trim()
    const trimmedUserId = params.userId.trim()

    if (!trimmedSurveyId || !trimmedTrainingId || !trimmedUserId) {
        throw new Error("Los identificadores de encuesta, capacitación o usuario no son válidos.")
    }

    const normalizedAnswers: Record<string, SurveyAnswerValue> = {}

    for (const [questionId, value] of Object.entries(params.answers)) {
        if (value === null || typeof value === "undefined") {
            continue
        }

        if (typeof value === "string" && value.trim().length > 0) {
            normalizedAnswers[questionId] = value
            continue
        }

        if (typeof value === "number") {
            normalizedAnswers[questionId] = value
            continue
        }

        if (Array.isArray(value) && value.length > 0) {
            normalizedAnswers[questionId] = value
        }
    }

    const createdAt = new Date().toISOString()

    const response: SurveyResponse = {
        id: trimmedUserId,
        surveyId: trimmedSurveyId,
        trainingId: trimmedTrainingId,
        userId: trimmedUserId,
        userName: params.userName ?? null,
        userEmail: params.userEmail ?? null,
        createdAt,
        answers: normalizedAnswers,
    }

    const responseRef = ref(database, `surveyResponses/${trimmedSurveyId}/${trimmedTrainingId}/${trimmedUserId}`)

    await set(responseRef, response)

    return response
}

