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
  changes: Partial<Pick<MeetingParticipant, "inviteStatus" | "attendance" | "checkedInAt">>,
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

  await update(participantRef, updates)
}
