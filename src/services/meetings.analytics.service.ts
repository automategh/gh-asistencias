import { get, query, ref, orderByChild, startAt, endAt, type Database } from "firebase/database"
import type { Meeting, MeetingKind, MeetingParticipant } from "@/types/meeting"
import type { RecintoKey } from "@/lib/firebase/databaseResolver"
import { getDatabaseForUrl } from "@/services/firebase"

/**
 * Estadísticas de asistencia agregadas por tipo de reunión.
 * Incluye conteos de eventos, citados y su distribución de asistencia.
 */
export interface MeetingKindStats {
  meetings: number
  invited: number
  present: number
  late: number
  absent: number
}

/**
 * Resumen de asistencia para un rango de fechas.
 * Combina métricas globales y por tipo de evento.
 */
export interface AttendanceSummary {
  totalMeetings: number
  totalInvited: number
  totalPresent: number
  totalLate: number
  totalAbsent: number
  byType: Record<MeetingKind, MeetingKindStats>
}

/**
 * Opciones de consulta para calcular métricas de asistencia.
 * `startTime` y `endTime` se expresan en epoch ms.
 */
export interface AttendanceQueryOptions {
  startTime: number
  endTime: number
  type?: MeetingKind | "ALL"
}

/**
 * Crea un objeto de estadísticas vacío para un tipo de reunión.
 */
function createEmptyKindStats(): MeetingKindStats {
  return {
    meetings: 0,
    invited: 0,
    present: 0,
    late: 0,
    absent: 0,
  }
}

/**
 * Crea un resumen de asistencia vacío inicializado para todos los tipos.
 */
function createEmptySummary(): AttendanceSummary {
  return {
    totalMeetings: 0,
    totalInvited: 0,
    totalPresent: 0,
    totalLate: 0,
    totalAbsent: 0,
    byType: {
      meeting: createEmptyKindStats(),
      training: createEmptyKindStats(),
      custom: createEmptyKindStats(),
    },
  }
}

/**
 * Acumula en un resumen la información de una reunión y sus participantes.
 *
 * @param summary Resumen global a actualizar
 * @param meeting Reunión procesada
 * @param participants Participantes de la reunión
 */
function accumulateMeeting(
  summary: AttendanceSummary,
  meeting: Meeting,
  participants: readonly MeetingParticipant[],
): void {
  const kindStats = summary.byType[meeting.type]
  summary.totalMeetings += 1
  kindStats.meetings += 1

  for (const p of participants) {
    summary.totalInvited += 1
    kindStats.invited += 1

    const attendance = p.attendance ?? null
    if (attendance === "present") {
      summary.totalPresent += 1
      kindStats.present += 1
    } else if (attendance === "late") {
      summary.totalLate += 1
      kindStats.late += 1
    } else {
      summary.totalAbsent += 1
      kindStats.absent += 1
    }
  }
}

/**
 * Calcula el resumen de asistencias para una sola base de datos
 * en un rango de fechas y, opcionalmente, filtrando por tipo.
 *
 * @param database Instancia de Realtime Database
 * @param options Rango temporal y tipo de evento a considerar
 */
export async function getAttendanceSummaryForDatabase(
  database: Database,
  options: AttendanceQueryOptions,
): Promise<AttendanceSummary> {
  const { startTime, endTime, type } = options

  const meetingsRef = ref(database, "meetings")
  const q = query(
    meetingsRef,
    orderByChild("startTime"),
    startAt(startTime),
    endAt(endTime),
  )

  const snapshot = await get(q)
  const values = snapshot.val() as Record<string, Meeting> | null

  if (!values) {
    return createEmptySummary()
  }

  const summary = createEmptySummary()

  const meetings = Object.values(values).filter((meeting) => {
    if (typeof type !== "undefined" && type !== "ALL" && meeting.type !== type) {
      return false
    }
    return true
  })

  for (const meeting of meetings) {
    const participantsSnap = await get(ref(database, `meetingParticipants/${meeting.id}`))
    const participantsValue = participantsSnap.val() as Record<string, MeetingParticipant> | null
    const participants: MeetingParticipant[] = participantsValue ? Object.values(participantsValue) : []
    accumulateMeeting(summary, meeting, participants)
  }

  return summary
}

/**
 * Calcula el resumen de asistencias agregando resultados de múltiples
 * bases de datos (multi-recinto) en un solo objeto.
 *
 * @param recintos Lista de recintos (url y key) a consultar
 * @param options Rango temporal y tipo de evento a considerar
 */
export async function getAttendanceSummaryAcrossDatabases(
  recintos: Array<{ url: string; key: RecintoKey }>,
  options: AttendanceQueryOptions,
): Promise<AttendanceSummary> {
  if (recintos.length === 0) {
    return createEmptySummary()
  }

  const summaries = await Promise.all(
    recintos.map(async (recinto) => {
      const db = getDatabaseForUrl(recinto.url)
      if (!db) {
        return createEmptySummary()
      }
      return getAttendanceSummaryForDatabase(db, options)
    }),
  )

  const merged = createEmptySummary()

  for (const s of summaries) {
    merged.totalMeetings += s.totalMeetings
    merged.totalInvited += s.totalInvited
    merged.totalPresent += s.totalPresent
    merged.totalLate += s.totalLate
    merged.totalAbsent += s.totalAbsent

    ;(Object.keys(merged.byType) as MeetingKind[]).forEach((kind) => {
      const target = merged.byType[kind]
      const source = s.byType[kind]
      target.meetings += source.meetings
      target.invited += source.invited
      target.present += source.present
      target.late += source.late
      target.absent += source.absent
    })
  }

  return merged
}

/**
 * Devuelve un resumen de asistencia vacío, útil como valor inicial
 * o para manejar estados sin datos sin comprobar null.
 */
export function getEmptyAttendanceSummary(): AttendanceSummary {
  return createEmptySummary()
}
