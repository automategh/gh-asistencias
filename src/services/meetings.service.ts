import { ref, push, set, update, type Database, get } from "firebase/database"
import type { Meeting, MeetingCreateInput, MeetingParticipant, ParticipantInput, MeetingStatus } from "@/types/meeting"
import type { User } from "firebase/auth"

/**
 * Asegura que la instancia de Database es válida en tiempo de ejecución.
 * Lanza un error con mensaje claro si es null.
 */
function assertDatabase(db: Database | null): asserts db is Database {
    if (!db) throw new Error("La base de datos no está disponible")
}

/**
 * Crea una nueva reunión en RTDB bajo el nodo `/meetings`.
 * - Genera un `id` con `push()` y guarda un objeto `Meeting` con estado `scheduled`.
 * - No agrega participantes (usar `addParticipants` tras la creación).
 *
 * @param database Instancia de RTDB actual (recinto resuelto)
 * @param creator Usuario autenticado (uid/displayName/email)
 * @param input Datos mínimos para crear la reunión
 * @returns Reunión persistida con `id` asignado
 */
export async function createMeeting(
    database: Database | null,
    creator: Pick<User, "uid" | "displayName" | "email">,
    input: MeetingCreateInput,
): Promise<Meeting> {
    assertDatabase(database)
    const meetingsRef = ref(database, "meetings")
    const newRef = push(meetingsRef)
    const id = newRef.key

    if (!id) {
        throw new Error("No fue posible generar el id de la reunión")
    }

    const now = Date.now()
    const meeting: Meeting = {
        id,
        title: input.title.trim(),
        type: input.type,
        customType: input.customType ?? null,
        satisfactionSurveyId: input.satisfactionSurveyId ?? null,
        description: input.description?.trim() ?? null,
        location: input.location.trim(),
        startTime: input.startTime,
        endTime: input.endTime,
        status: "scheduled",
        createdBy: creator.uid,
        createdByName: creator.displayName ?? null,
        createdByEmail: creator.email ?? null,
        managers: input.managers ?? null,
        createdAt: now,
    }

    await set(newRef, meeting)
    return meeting
}

/**
 * Añade participantes a una reunión con fan-out updates:
 * - `/meetingParticipants/{meetingId}/{uid}`: detalle del participante en la reunión
 * - `/userMeetings/{uid}/{meetingId}`: índice por usuario para listados rápidos
 *
 * @param database Instancia RTDB
 * @param meetingId ID de la reunión destino
 * @param participants Participantes a agregar (uid, name, email, role)
 * @param indexMeta Metadatos mínimos para el índice por usuario (startTime, status)
 */
export async function addParticipants(
    database: Database | null,
    meetingId: string,
    participants: ParticipantInput[],
    indexMeta: { startTime: number; status: MeetingStatus },
): Promise<void> {
    assertDatabase(database)
    const updates: Record<string, unknown> = {}

    for (const p of participants) {
        const participant: MeetingParticipant = {
            uid: p.uid,
            name: p.name,
            email: p.email,
            role: p.role,
            inviteStatus: "invited",
            attendance: null,
        }

        updates[`/meetingParticipants/${meetingId}/${p.uid}`] = participant

        updates[`/userMeetings/${p.uid}/${meetingId}`] = {
            meetingId,
            startTime: indexMeta.startTime,
            status: indexMeta.status,
            role: p.role,
            inviteStatus: "invited",
            attendance: null,
        }
    }

    await update(ref(database), updates)
}

/**
 * Actualiza el estado del participante (campos permitidos):
 * - `inviteStatus`: invitado/aceptado/declinado
 * - `attendance`: presente/ausente/tarde
 * - `checkedInAt`: marca temporal de check-in
 *
 * Útil para que el propio usuario confirme asistencia o para registrar presencia durante la sesión.
 *
 * @param database Instancia RTDB
 * @param meetingId Reunión objetivo
 * @param uid UID del participante a actualizar
 * @param changes Campos a modificar
 */
export async function updateParticipantStatus(
    database: Database | null,
    meetingId: string,
    uid: string,
    changes: Partial<Pick<MeetingParticipant, "inviteStatus" | "attendance" | "checkedInAt" | "checkinMethod" | "noShow">>,
): Promise<void> {
    assertDatabase(database)
    const participantRef = ref(database, `meetingParticipants/${meetingId}/${uid}`)
    const snapshot = await get(participantRef)
    if (!snapshot.exists()) {
        throw new Error("El participante no existe en esta reunión")
    }

    const updates: Record<string, unknown> = {}
    if (typeof changes.inviteStatus !== "undefined") {
        updates["inviteStatus"] = changes.inviteStatus
    }
    if (typeof changes.attendance !== "undefined") {
        updates["attendance"] = changes.attendance
    }
    if (typeof changes.checkedInAt !== "undefined") {
        updates["checkedInAt"] = changes.checkedInAt
    }
    if (typeof changes.checkinMethod !== "undefined") {
        updates["checkinMethod"] = changes.checkinMethod
    }
    if (typeof changes.noShow !== "undefined") {
        updates["noShow"] = changes.noShow
    }

    await update(participantRef, updates)
}

/** Obtiene una reunión por su ID.
 *
 * @param database Instancia RTDB
 * @param meetingId ID de la reunión
 * @returns Reunión o null si no existe
 * @throws Error si la reunión no existe
 */
export async function getMeetingById(
    database: Database | null,
    meetingId: string,
): Promise<Meeting | null> {
    assertDatabase(database)
    const meetingRef = ref(database, `meetings/${meetingId}`)
    const snapshot = await get(meetingRef)
    if (!snapshot.exists()) {
        throw new Error("La reunión no existe")
    }
    const meeting = snapshot.val() as Meeting
    return meeting
}

/** Cierra una reunión cambiando su estado a `closed`.
 * También propaga el estado en el índice `userMeetings/{uid}/{meetingId}` para cada participante.
 *
 * Reglas de negocio:
 * - Solo el `createdBy` o un `manager` deberían cerrar la reunión (se valida aquí y en reglas RTDB).
 * - Si ya está `closed`, `completed` o `cancelled`, no permite cerrar nuevamente.
 *
 * @param database Instancia RTDB
 * @param meetingId ID de la reunión a cerrar
 * @param closerUid UID del usuario que solicita el cierre
 * @returns Reunión actualizada
 */
export async function closeMeeting(
    database: Database | null,
    meetingId: string,
    closerUid: string,
): Promise<Meeting> {
    assertDatabase(database)

    const meetingRef = ref(database, `meetings/${meetingId}`)
    const snap = await get(meetingRef)
    if (!snap.exists()) {
        throw new Error("La reunión no existe")
    }
    const meeting = snap.val() as Meeting

    // Validación de estado
    if (meeting.status === "closed" || meeting.status === "completed" || meeting.status === "cancelled") {
        throw new Error("La reunión ya no puede cerrarse (estado final)")
    }

    // Validación de permisos básicos a nivel de cliente (reglas RTDB también protegen)
    const isCreator = meeting.createdBy === closerUid
    const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(closerUid) : false
    if (!isCreator && !isManager) {
        throw new Error("No tienes permisos para cerrar esta reunión")
    }

    const now = Date.now()

    // Construimos updates fan-out:
    // 1) Actualizar reunión
    const updates: Record<string, unknown> = {}
    updates[`/meetings/${meetingId}/status`] = "closed"
    updates[`/meetings/${meetingId}/closedAt`] = now
    updates[`/meetings/${meetingId}/closedBy`] = closerUid
    updates[`/meetings/${meetingId}/updatedAt`] = now

    // 2) Propagar estado a índices por usuario
    const participantsRef = ref(database, `meetingParticipants/${meetingId}`)
    const participantsSnap = await get(participantsRef)
    if (participantsSnap.exists()) {
        const participants = participantsSnap.val() as Record<string, MeetingParticipant>
        Object.keys(participants).forEach((uid) => {
            updates[`/userMeetings/${uid}/${meetingId}/status`] = "closed"
        })
    }

    await update(ref(database), updates)

    // Devuelve la reunión actualizada (re-lectura ligera)
    const newSnap = await get(meetingRef)
    return newSnap.val() as Meeting
}

/** Marca una reunión como `completed` (finalizada) y propaga el estado.
 * Reglas de negocio:
 * - Solo el `createdBy`, un `manager` o `Admin` pueden completar.
 * - No permite completar si ya está `completed` o `cancelled`.
 * - Permite completar si está `closed` o si la hora actual es posterior al `endTime`.
 *
 * @param database Instancia RTDB
 * @param meetingId ID de la reunión a completar
 * @param actorUid UID del usuario que solicita completar
 * @returns Reunión actualizada
 */
export async function completeMeeting(
    database: Database | null,
    meetingId: string,
    actorUid: string,
): Promise<Meeting> {
    assertDatabase(database)

    const meetingRef = ref(database, `meetings/${meetingId}`)
    const snap = await get(meetingRef)
    if (!snap.exists()) {
        throw new Error("La reunión no existe")
    }
    const meeting = snap.val() as Meeting

    if (meeting.status === "completed" || meeting.status === "cancelled") {
        throw new Error("La reunión ya no puede completarse")
    }

    const isCreator = meeting.createdBy === actorUid
    const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(actorUid) : false
    // Nota: Admin se valida por reglas del servidor; aquí reforzamos cliente.
    if (!isCreator && !isManager) {
        throw new Error("No tienes permisos para completar esta reunión")
    }

    const now = Date.now()
    const canCompleteByTime = now >= meeting.endTime
    const canCompleteByStatus = meeting.status === "closed"
    if (!canCompleteByTime && !canCompleteByStatus) {
        throw new Error("Solo puede completarse si ya terminó o está cerrada")
    }

    const updates: Record<string, unknown> = {}
    updates[`/meetings/${meetingId}/status`] = "completed"
    updates[`/meetings/${meetingId}/updatedAt`] = now

    const participantsRef = ref(database, `meetingParticipants/${meetingId}`)
    const participantsSnap = await get(participantsRef)
    if (participantsSnap.exists()) {
        const participants = participantsSnap.val() as Record<string, MeetingParticipant>
        Object.keys(participants).forEach((uid) => {
            updates[`/userMeetings/${uid}/${meetingId}/status`] = "completed"
        })
    }

    await update(ref(database), updates)

    const newSnap = await get(meetingRef)
    return newSnap.val() as Meeting
}


export async function cancelMeeting(
    database: Database,
    meetingId: string,
    byUid: string,
    reason?: string,
): Promise<Meeting> {
    // Asegura que la reunión exista
    const meetingRef = ref(database, `meetings/${meetingId}`)
    const snap = await get(meetingRef)
    if (!snap.exists()) {
        throw new Error('La reunión no existe')
    }

    const now = Date.now()
    const patch = {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: byUid,
        cancellationReason: typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null
    }

    await update(meetingRef, patch)

    // Relee para devolver el estado consistente
    const updatedSnap = await get(meetingRef)
    const updated = updatedSnap.val() as Meeting
    return updated
}

/**
 * Reabre una reunión previamente cerrada o cancelada cambiando su estado a `scheduled`.
 * También limpia metadatos de cierre/cancelación y actualiza el índice `userMeetings`.
 *
 * Reglas de negocio:
 * - Solo el `createdBy` o un `manager` pueden reabrir.
 * - No permite reabrir reuniones completadas.
 */
export async function reopenMeeting(
    database: Database | null,
    meetingId: string,
    actorUid: string,
): Promise<Meeting> {
    assertDatabase(database)

    const meetingRef = ref(database, `meetings/${meetingId}`)
    const snapshot = await get(meetingRef)
    if (!snapshot.exists()) {
        throw new Error("La reunión no existe")
    }

    const meeting = snapshot.val() as Meeting

    if (meeting.status === "completed") {
        throw new Error("No es posible reabrir una reunión completada")
    }

    if (meeting.status !== "closed" && meeting.status !== "cancelled") {
        throw new Error("Solo pueden reabrirse reuniones cerradas o canceladas")
    }

    const isCreator = meeting.createdBy === actorUid
    const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(actorUid) : false
    if (!isCreator && !isManager) {
        throw new Error("No tienes permisos para reabrir esta reunión")
    }

    const now = Date.now()

    const updates: Record<string, unknown> = {}
    updates[`/meetings/${meetingId}/status`] = "scheduled"
    updates[`/meetings/${meetingId}/closedAt`] = null
    updates[`/meetings/${meetingId}/closedBy`] = null
    updates[`/meetings/${meetingId}/cancelledAt`] = null
    updates[`/meetings/${meetingId}/cancelledBy`] = null
    updates[`/meetings/${meetingId}/cancellationReason`] = null
    updates[`/meetings/${meetingId}/updatedAt`] = now

    const participantsRef = ref(database, `meetingParticipants/${meetingId}`)
    const participantsSnap = await get(participantsRef)
    if (participantsSnap.exists()) {
        const participants = participantsSnap.val() as Record<string, MeetingParticipant>
        Object.keys(participants).forEach((uid) => {
            updates[`/userMeetings/${uid}/${meetingId}/status`] = "scheduled"
        })
    }

    await update(ref(database), updates)

    const updatedSnap = await get(meetingRef)
    return updatedSnap.val() as Meeting
}