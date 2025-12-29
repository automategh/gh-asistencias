/**
 * Tipos para el módulo de reuniones persistido en Firebase Realtime Database.
 *
 * Diseño enfocado en:
 * - Consulta eficiente (epoch ms para fechas y denormalización necesaria)
 * - Evitar any/unknown y mantener contratos tipados
 * - Documentación clara para facilitar mantenimiento y evolución
 */

/** Estado de la reunión en su ciclo de vida */
export type MeetingStatus = "draft" | "scheduled" | "closed" | "completed" | "cancelled"

/** Tipo de reunión: general, capacitación o personalizada */
export type MeetingKind = "meeting" | "training" | "custom"

/**
 * Reunión agendada.
 * Se guarda en el nodo `meetings/{meetingId}` y provee metadatos básicos
 * para listados y control de permisos de gestión/cierre.
 */
export interface Meeting {
  /** Identificador generado con push() */
  readonly id: string
  /** Título visible para los asistentes */
  readonly title: string
  /** Categoría principal de la reunión */
  readonly type: MeetingKind
  /** Etiqueta de tipo cuando `type` es "custom" */
  readonly customType?: string | null
  /** Descripción/agenda (opcional) */
  readonly description?: string | null
  /** Ubicación donde se lleva a cabo */
  readonly location: string
  /** Inicio en epoch ms (para ordenar/filtrar por fecha) */
  readonly startTime: number
  /** Fin en epoch ms (para ordenar/filtrar por fecha) */
  readonly endTime: number
  /** Estado de la reunión (programada, cerrada, etc.) */
  readonly status: MeetingStatus
  /** UID del creador de la reunión */
  readonly createdBy: string
  /** Nombre del creador (solo para conveniencia en UI) */
  readonly createdByName?: string | null
  /** Email del creador (solo para conveniencia en UI) */
  readonly createdByEmail?: string | null
  /** UIDs con permisos de gestión adicionales al creador */
  readonly managers?: readonly string[] | null
  /** Fecha de creación (epoch ms) */
  readonly createdAt: number
  /** Última actualización (epoch ms) */
  readonly updatedAt?: number
  /** Fecha de cierre (epoch ms) si aplica */
  readonly closedAt?: number
  /** UID de quien cerró la reunión si aplica */
  readonly closedBy?: string
}

/** Rol del participante dentro de la reunión */
export type ParticipantRole = "attendee" | "speaker" | "host"
/** Estado de invitación del participante */
export type InviteStatus = "invited" | "accepted" | "declined"
/** Estado de asistencia del participante */
export type AttendanceStatus = "absent" | "present" | "late"

/** Registro del participante por reunión (meetingParticipants/{meetingId}/{uid}) */
export interface MeetingParticipant {
  /** UID del participante */
  readonly uid: string
  /** Nombre del participante (snapshoot para UI rápida) */
  readonly name: string
  /** Email del participante (snapshoot para UI rápida) */
  readonly email: string
  /** Rol que desempeña en la reunión */
  readonly role: ParticipantRole
  /** Estado de la invitación */
  readonly inviteStatus: InviteStatus
  /** Estado de asistencia (opcional) */
  readonly attendance?: AttendanceStatus | null
  /** Marca temporal del check-in (epoch ms) */
  readonly checkedInAt?: number
}

/** Datos requeridos para crear una reunión */
export interface MeetingCreateInput {
  /** Título visible */
  readonly title: string
  /** Tipo principal */
  readonly type: MeetingKind
  /** Etiqueta para tipo personalizado si aplica */
  readonly customType?: string | null
  /** Descripción/agenda */
  readonly description?: string | null
  /** Ubicación */
  readonly location: string
  /** Inicio epoch ms */
  readonly startTime: number
  /** Fin epoch ms */
  readonly endTime: number
  /** UIDs con permiso de gestión */
  readonly managers?: readonly string[] | null
}

/** Datos mínimos para agregar un participante a una reunión */
export interface ParticipantInput {
  /** UID del usuario */
  readonly uid: string
  /** Nombre mostrado */
  readonly name: string
  /** Email mostrado */
  readonly email: string
  /** Rol que tendrá en la reunión */
  readonly role: ParticipantRole
}
