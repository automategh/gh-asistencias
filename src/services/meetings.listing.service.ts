import type { Database } from 'firebase/database'
import { get, query, ref, orderByChild, limitToFirst, equalTo, startAt } from 'firebase/database'
import { httpsCallable } from 'firebase/functions'
import type { Meeting, MeetingStatus } from '@/types/meeting'
import type { RecintoKey } from '@/lib/firebase/databaseResolver'
import { functions, getDatabaseForUrl } from '@/services/firebase'

export interface UserMeetingIndex {
  readonly meetingId: string
  readonly startTime: number
  readonly status: MeetingStatus
  readonly role: 'attendee' | 'speaker' | 'host'
  readonly inviteStatus: 'invited' | 'accepted' | 'declined'
  readonly attendance?: 'absent' | 'present' | 'late' | null
}

export interface MeetingWithIndex extends Meeting {
  readonly index?: UserMeetingIndex | null
  readonly source?: { url: string; recinto: RecintoKey } | null
}

interface UserMeetingsFunctionRequest {
  readonly now: number
  readonly lookbackMs: number
  readonly statuses: readonly MeetingStatus[]
  readonly recintos: Array<{ url: string; key: RecintoKey }>
}

interface UserMeetingsFunctionResponse {
  readonly invited: readonly MeetingWithIndex[]
  readonly created: readonly MeetingWithIndex[]
  readonly omittedRecintos: readonly string[]
}

const DEFAULT_LIMIT = 0 // 0 = sin límite

/**
 * Carga reuniones del usuario vía Cloud Functions para mover el fan-out
 * multi-recinto al backend y reducir latencia en cliente.
 */
export async function getUserMeetingsFromCloudFunction(
  recintos: Array<{ url: string; key: RecintoKey }>,
  now: number,
  lookbackMs: number,
  statuses: ReadonlyArray<MeetingStatus> = ['scheduled']
): Promise<{ invited: MeetingWithIndex[]; created: MeetingWithIndex[]; omittedRecintos: string[] }> {
  if (!functions) {
    throw new Error('Cloud Functions no está disponible')
  }

  const normalizedRecintos = Array.from(
    new Map(
      recintos
        .map((recinto) => ({ url: recinto.url.trim(), key: recinto.key }))
        .filter((recinto) => recinto.url.length > 0)
        .map((recinto) => [recinto.url, recinto]),
    ).values(),
  )

  if (normalizedRecintos.length === 0) {
    return { invited: [], created: [], omittedRecintos: [] }
  }

  const callable = httpsCallable<UserMeetingsFunctionRequest, UserMeetingsFunctionResponse>(
    functions,
    'getUserMeetings',
  )

  const response = await callable({
    now,
    lookbackMs,
    statuses: [...statuses],
    recintos: normalizedRecintos,
  })

  const omittedRecintos = [...response.data.omittedRecintos]
  if (omittedRecintos.length > 0) {
    console.warn(`Se omitieron ${omittedRecintos.length} recinto(s) al cargar actividades desde Cloud Functions.`)
  }

  return {
    invited: [...response.data.invited],
    created: [...response.data.created],
    omittedRecintos,
  }
}

/**
 * Obtiene índices de userMeetings y resuelve reuniones para una base.
 */
export async function getUserInvitedMeetings(
  database: Database,
  uid: string,
  now: number,
  lookbackMs: number,
  statuses: ReadonlyArray<MeetingStatus> = ['scheduled']
): Promise<MeetingWithIndex[]> {
  // Traer índices recientes/futuros para evitar cargar historial completo.
  // Si DEFAULT_LIMIT > 0, aplica límite; de lo contrario no limita.
  const baseRef = ref(database, `userMeetings/${uid}`)
  const minStartTime = Math.max(0, now - lookbackMs)
  const constraints: Parameters<typeof query>[1][] = [orderByChild('startTime'), startAt(minStartTime)]
  if (DEFAULT_LIMIT > 0) {
    constraints.push(limitToFirst(DEFAULT_LIMIT))
  }
  const idxSnap = await get(query(baseRef, ...constraints))
  const idxVal = idxSnap.val() as Record<string, UserMeetingIndex> | null
  const indices: UserMeetingIndex[] = idxVal ? Object.values(idxVal) : []

  const filtered = indices.filter((i) => statuses.includes(i.status))
  if (filtered.length === 0) return []

  const meetingRefs = filtered.map((i) => ref(database, `meetings/${i.meetingId}`))
  const snaps = await Promise.all(meetingRefs.map((r) => get(r)))

  const results: MeetingWithIndex[] = []
  snaps.forEach((snap, idx) => {
    const m = snap.val() as Meeting | null
    if (m) {
      results.push({ ...m, index: filtered[idx] })
    }
  })
  return results
}

/**
 * Reuniones creadas por el usuario en una base.
 */
export async function getUserCreatedMeetings(
  database: Database,
  uid: string
): Promise<Meeting[]> {
  const snap = await get(
    query(ref(database, 'meetings'), orderByChild('createdBy'), equalTo(uid))
  )
  const val = snap.val() as Record<string, Meeting> | null
  return val ? Object.values(val) : []
}

/**
 * Invited (citadas) a través de múltiples recintos.
 */
export async function getUserInvitedMeetingsAcross(
  recintos: Array<{ url: string; key: RecintoKey }>,
  uid: string,
  now: number,
  lookbackMs: number,
  statuses: ReadonlyArray<MeetingStatus> = ['scheduled']
): Promise<MeetingWithIndex[]> {
  const tasks = recintos.map(async (r) => {
    const db = getDatabaseForUrl(r.url)
    if (!db) return [] as MeetingWithIndex[]
    const list = await getUserInvitedMeetings(db, uid, now, lookbackMs, statuses)
    return list.map((m) => ({ ...m, source: { url: r.url, recinto: r.key } }))
  })
  const parts = await Promise.all(tasks)
  // aplanar
  return parts.flat()
}

/**
 * Creadas por mí a través de múltiples recintos.
 */
export async function getUserCreatedMeetingsAcross(
  recintos: Array<{ url: string; key: RecintoKey }>,
  uid: string
): Promise<MeetingWithIndex[]> {
  const tasks = recintos.map(async (r) => {
    const db = getDatabaseForUrl(r.url)
    if (!db) return [] as MeetingWithIndex[]
    const list = await getUserCreatedMeetings(db, uid)
    return list.map<MeetingWithIndex>((m) => ({ ...m, source: { url: r.url, recinto: r.key }, index: null }))
  })
  const parts = await Promise.all(tasks)
  return parts.flat()
}
