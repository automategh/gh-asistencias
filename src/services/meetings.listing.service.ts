import type { Database } from 'firebase/database'
import { get, query, ref, orderByChild, limitToFirst, equalTo } from 'firebase/database'
import type { Meeting, MeetingStatus } from '@/types/meeting'
import type { RecintoKey } from '@/lib/firebase/databaseResolver'
import { getDatabaseForUrl } from '@/services/firebase'

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

const DEFAULT_LIMIT = 0 // 0 = sin límite

/**
 * Obtiene índices de userMeetings y resuelve reuniones para una base.
 */
export async function getUserInvitedMeetings(
  database: Database,
  uid: string,
  _now: number,
  _lookbackMs: number,
  statuses: ReadonlyArray<MeetingStatus> = ['scheduled']
): Promise<MeetingWithIndex[]> {
  // Traer TODOS los índices y ordenar por startTime sin filtrar por tiempo.
  // Si DEFAULT_LIMIT > 0, aplica límite; de lo contrario no limita.
  const baseRef = ref(database, `userMeetings/${uid}`)
  const constraints: Parameters<typeof query>[1][] = [orderByChild('startTime')]
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
