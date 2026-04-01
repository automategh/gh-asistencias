
import { get, query, ref, orderByChild, startAt, endAt, type Database } from "firebase/database"
import type { Meeting, MeetingKind, MeetingParticipant } from "@/types/meeting"
import type { UserProfile } from "@/types/user"
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
 * Métricas agregadas específicas para capacitaciones (type: "training")
 * en un rango anual.
 */
export interface TrainingKpiSummary {
  /** Número total de capacitaciones realizadas en el año */
  totalTrainings: number
  /** Total de horas sumadas de todas las capacitaciones (endTime - startTime) */
  totalHours: number
  /** Cantidad total de asistencias (presentes + tarde) en todas las capacitaciones del año */
  totalAttended: number
}

/**
 * Conteo de capacitaciones por departamento para un año dado.
 */
export interface DepartmentTrainingCount {
  department: string
  trainings: number
}

/**
 * Horas totales de capacitación agrupadas por cargo
 * (perfil de usuario) para un año y, opcionalmente,
 * filtrando por departamento.
 */
export interface TrainingHoursByRole {
  role: string
  hours: number
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
 * Obtiene el nombre del capacitador de una capacitación.
 * El capacitador es el participante con rol "speaker" o el primero con rol distinto de "attendee".
 * Si no se encuentra, retorna null.
 * @param participants Participantes de la capacitación
 * @returns Nombre del capacitador o null
 */
export function getTrainerNameFromParticipants(participants: readonly MeetingParticipant[]): string | null {
  if (!participants || participants.length === 0) return null;
  // Buscar speaker
  const speaker = participants.find((p) => p.role === "speaker");
  if (speaker) return speaker.name;
  // Buscar otro rol distinto de attendee
  const nonAttendee = participants.find((p) => p.role !== "attendee");
  if (nonAttendee) return nonAttendee.name;
  return null;
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

      ; (Object.keys(merged.byType) as MeetingKind[]).forEach((kind) => {
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

/**
 * Calcula la cantidad de capacitaciones (reuniones de tipo `training`)
 * programadas en un año concreto para una base de datos.
 *
 * @param database Instancia de Realtime Database sobre la que se hará la consulta
 * @param year Año calendario para el que se desean obtener las capacitaciones
 * @returns Promesa que resuelve con el número de capacitaciones encontradas
 */
export async function getTrainingCountForYear(database: Database, year: number): Promise<number> {
  const startOfYear = new Date(year, 0, 1, 0, 0, 0, 0).getTime()
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999).getTime()

  const summary = await getAttendanceSummaryForDatabase(database, {
    startTime: startOfYear,
    endTime: endOfYear,
    type: "training",
  })

  return summary.byType.training.meetings
}

/**
 * Calcula KPIs clave del plan de formación para un año concreto:
 * - total de capacitaciones
 * - total de horas dictadas
 * - porcentaje promedio de asistencia
 *
 * Se apoya en el resumen de asistencia y en los metadatos de las reuniones
 * para evitar duplicar lógica en los consumidores.
 */
export async function getTrainingKpiForYear(
  database: Database,
  year: number,
  department?: string | null,
  leaderName?: string | null,
): Promise<TrainingKpiSummary> {
  const startOfYear = new Date(year, 0, 1, 0, 0, 0, 0).getTime()
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999).getTime()

  const meetingsRef = ref(database, "meetings")
  const q = query(
    meetingsRef,
    orderByChild("startTime"),
    startAt(startOfYear),
    endAt(endOfYear),
  )

  const snapshot = await get(q)
  const meetingsMap = snapshot.val() as Record<string, Meeting> | null

  if (!meetingsMap) {
    return {
      totalTrainings: 0,
      totalHours: 0,
      totalAttended: 0,
    }
  }

  const normalizedDept = typeof department === "string" && department.trim().length > 0
    ? department.trim().toLowerCase()
    : null

  const normalizedLeader = typeof leaderName === "string" && leaderName.trim().length > 0
    ? leaderName.trim().toLowerCase()
    : null

  // Cargamos usuarios una sola vez para poder filtrar por departamento
  const usersSnap = await get(ref(database, "users"))
  const usersValue = usersSnap.val() as Record<string, Partial<UserProfile>> | null
  const usersByUid: Record<string, Partial<UserProfile>> = usersValue ?? {}

  let totalTrainings = 0
  let totalHours = 0
  let totalAttended = 0

  for (const meeting of Object.values(meetingsMap)) {
    if (meeting.type !== "training") {
      continue
    }

    const participantsSnap = await get(ref(database, `meetingParticipants/${meeting.id}`))
    const participantsValue = participantsSnap.val() as Record<string, MeetingParticipant> | null
    const participants: MeetingParticipant[] = participantsValue ? Object.values(participantsValue) : []

    let relevantParticipants: MeetingParticipant[] = participants

    if (normalizedDept) {
      relevantParticipants = relevantParticipants.filter((participant) => {
        const user = usersByUid[participant.uid]
        const deptRaw = typeof user?.department === "string" ? user.department : null
        if (!deptRaw) return false
        return deptRaw.trim().toLowerCase() === normalizedDept
      })

      if (relevantParticipants.length === 0) {
        continue
      }
    }

    if (normalizedLeader) {
      relevantParticipants = relevantParticipants.filter((participant) => {
        const user = usersByUid[participant.uid]
        const bossRaw = typeof user?.immediateBoss === "string" ? user.immediateBoss : null
        if (!bossRaw) return false
        return bossRaw.trim().toLowerCase() === normalizedLeader
      })

      if (relevantParticipants.length === 0) {
        continue
      }
    }

    totalTrainings += 1

    const durationMs = Math.max(0, meeting.endTime - meeting.startTime)
    totalHours += durationMs / (1000 * 60 * 60)

    for (const participant of relevantParticipants) {
      const attendance = participant.attendance ?? null
      if (attendance === "present" || attendance === "late") {
        totalAttended += 1
      }
    }
  }

  return {
    totalTrainings,
    totalHours,
    totalAttended,
  }
}

/**
 * Obtiene el listado de años calendario en los que existen
 * capacitaciones (reuniones de tipo `training`) registradas
 * en la base de datos indicada.
 *
 * @param database Instancia de Realtime Database
 * @returns Años únicos ordenados de más reciente a más antiguo
 */
export async function getTrainingYearsForDatabase(database: Database): Promise<number[]> {
  const meetingsRef = ref(database, "meetings")
  const snapshot = await get(meetingsRef)
  const values = snapshot.val() as Record<string, Meeting> | null

  if (!values) {
    return []
  }

  const yearsSet = new Set<number>()

  Object.values(values).forEach((meeting) => {
    if (meeting.type !== "training") {
      return
    }
    if (typeof meeting.startTime !== "number") {
      return
    }
    const year = new Date(meeting.startTime).getFullYear()
    yearsSet.add(year)
  })

  const years = Array.from(yearsSet)
  years.sort((a, b) => b - a)
  return years
}

/**
 * Obtiene, para un año específico, cuántas capacitaciones
 * (reuniones de tipo `training`) ha tenido cada departamento.
 *
 * Un departamento se considera participante de una capacitación
 * si al menos uno de sus usuarios aparece como participante
 * en esa reunión.
 */
export async function getTrainingCountsByDepartmentForYear(
  database: Database,
  year: number,
  leaderName?: string | null,
): Promise<DepartmentTrainingCount[]> {
  const startOfYear = new Date(year, 0, 1, 0, 0, 0, 0).getTime()
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999).getTime()

  const meetingsRef = ref(database, "meetings")
  const q = query(
    meetingsRef,
    orderByChild("startTime"),
    startAt(startOfYear),
    endAt(endOfYear),
  )

  const snapshot = await get(q)
  const meetingsMap = snapshot.val() as Record<string, Meeting> | null

  if (!meetingsMap) {
    return []
  }

  const usersSnap = await get(ref(database, "users"))
  const usersValue = usersSnap.val() as Record<string, Partial<UserProfile>> | null
  const usersByUid: Record<string, Partial<UserProfile>> = usersValue ?? {}

  const normalizedLeader = typeof leaderName === "string" && leaderName.trim().length > 0
    ? leaderName.trim().toLowerCase()
    : null

  const counts: Record<string, number> = {}

  for (const meeting of Object.values(meetingsMap)) {
    if (meeting.type !== "training") {
      continue
    }

    const participantsSnap = await get(ref(database, `meetingParticipants/${meeting.id}`))
    const participantsValue = participantsSnap.val() as Record<string, MeetingParticipant> | null
    const participants: MeetingParticipant[] = participantsValue ? Object.values(participantsValue) : []

    let relevantParticipants: MeetingParticipant[] = participants

    if (normalizedLeader) {
      relevantParticipants = relevantParticipants.filter((participant) => {
        const user = usersByUid[participant.uid]
        const bossRaw = typeof user?.immediateBoss === "string" ? user.immediateBoss : null
        if (!bossRaw) return false
        return bossRaw.trim().toLowerCase() === normalizedLeader
      })

      if (relevantParticipants.length === 0) {
        continue
      }
    }

    const departmentsInMeeting = new Set<string>()

    for (const participant of relevantParticipants) {
      const user = usersByUid[participant.uid]
      const deptRaw = typeof user?.department === "string" ? user.department : null
      if (!deptRaw) {
        continue
      }
      const clean = deptRaw.trim()
      if (!clean) {
        continue
      }
      departmentsInMeeting.add(clean)
    }

    for (const dept of departmentsInMeeting) {
      counts[dept] = (counts[dept] ?? 0) + 1
    }
  }

  const result: DepartmentTrainingCount[] = Object.entries(counts).map(([department, trainings]) => ({
    department,
    trainings,
  }))

  result.sort((a, b) => b.trainings - a.trainings || a.department.localeCompare(b.department))
  return result
}

/**
 * Calcula las horas totales de capacitación por cargo (role)
 * para un año concreto. Opcionalmente se puede limitar el
 * cálculo a un solo departamento.
 *
 * Un registro de horas se contabiliza para un cargo cuando
 * el usuario pertenece al departamento indicado (si se pasa)
 * y figura como participante en la capacitación.
 */
export async function getTrainingHoursByRoleForYear(
  database: Database,
  year: number,
  department?: string | null,
  leaderName?: string | null,
): Promise<TrainingHoursByRole[]> {
  const startOfYear = new Date(year, 0, 1, 0, 0, 0, 0).getTime()
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999).getTime()

  const meetingsRef = ref(database, "meetings")
  const q = query(
    meetingsRef,
    orderByChild("startTime"),
    startAt(startOfYear),
    endAt(endOfYear),
  )

  const snapshot = await get(q)
  const meetingsMap = snapshot.val() as Record<string, Meeting> | null

  if (!meetingsMap) {
    return []
  }

  const usersSnap = await get(ref(database, "users"))
  const usersValue = usersSnap.val() as Record<string, Partial<UserProfile>> | null
  const usersByUid: Record<string, Partial<UserProfile>> = usersValue ?? {}

  const normalizedDept = typeof department === "string" && department.trim().length > 0
    ? department.trim().toLowerCase()
    : null

  const normalizedLeader = typeof leaderName === "string" && leaderName.trim().length > 0
    ? leaderName.trim().toLowerCase()
    : null

  const hoursByRole: Record<string, number> = {}

  for (const meeting of Object.values(meetingsMap)) {
    if (meeting.type !== "training") {
      continue
    }

    const durationMs = Math.max(0, meeting.endTime - meeting.startTime)
    const durationHours = durationMs / (1000 * 60 * 60)
    if (durationHours <= 0) {
      continue
    }

    const participantsSnap = await get(ref(database, `meetingParticipants/${meeting.id}`))
    const participantsValue = participantsSnap.val() as Record<string, MeetingParticipant> | null
    const participants: MeetingParticipant[] = participantsValue ? Object.values(participantsValue) : []

    for (const participant of participants) {
      const user = usersByUid[participant.uid]
      if (!user) {
        continue
      }

      const deptRaw = typeof user.department === "string" ? user.department : null
      const roleRaw = typeof user.cargo === "string" ? user.cargo : null
      const bossRaw = typeof user.immediateBoss === "string" ? user.immediateBoss : null

      if (!roleRaw) {
        continue
      }

      if (normalizedDept) {
        if (!deptRaw || deptRaw.trim().toLowerCase() !== normalizedDept) {
          continue
        }
      }

      if (normalizedLeader) {
        if (!bossRaw || bossRaw.trim().toLowerCase() !== normalizedLeader) {
          continue
        }
      }

      const role = roleRaw.trim()
      if (!role) {
        continue
      }

      hoursByRole[role] = (hoursByRole[role] ?? 0) + durationHours
    }
  }

  const result: TrainingHoursByRole[] = Object.entries(hoursByRole).map(([role, hours]) => ({
    role,
    hours,
  }))

  result.sort((a, b) => b.hours - a.hours || a.role.localeCompare(b.role))
  return result
}
