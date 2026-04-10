import { get, query, ref, orderByChild, startAt, endAt, type Database } from "firebase/database"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
import type { UserProfile } from "@/types/user"
import { getTrainerNameFromParticipants } from "@/services/meetings.analytics.service"

export interface TrainingWithParticipants {
    meeting: Meeting
    participants: MeetingParticipant[]
    trainer: string | null
    areas: string[]
}

export async function getTrainingsWithParticipants(
    database: Database,
    year: number,
    department?: string | null,
    leaderName?: string | null,
    month?: number | null,
): Promise<TrainingWithParticipants[]> {
    const { startTime, endTime } = ((): { startTime: number; endTime: number } => {
        if (typeof month === "number" && month >= 1 && month <= 12) {
            const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime()
            const end = new Date(year, month, 0, 23, 59, 59, 999).getTime()
            return { startTime: start, endTime: end }
        }
        const start = new Date(year, 0, 1, 0, 0, 0, 0).getTime()
        const end = new Date(year, 11, 31, 23, 59, 59, 999).getTime()
        return { startTime: start, endTime: end }
    })()

    const meetingsRef = ref(database, "meetings")
    const q = query(
        meetingsRef,
        orderByChild("startTime"),
        startAt(startTime),
        endAt(endTime)
    )

    const snapshot = await get(q)
    const meetingsMap = snapshot.val() as Record<string, Meeting> | null
    if (!meetingsMap) return []

    const usersSnap = await get(ref(database, "users"))
    const usersValue = usersSnap.val() as Record<string, Partial<UserProfile>> | null
    const usersByUid: Record<string, Partial<UserProfile>> = usersValue ?? {}

    const result: TrainingWithParticipants[] = []

    const normalizedDept = typeof department === "string" && department.trim().length > 0
        ? department.trim().toLowerCase()
        : null

    const normalizedLeader = typeof leaderName === "string" && leaderName.trim().length > 0
        ? leaderName.trim().toLowerCase()
        : null

    for (const meeting of Object.values(meetingsMap)) {
        if (meeting.type !== "training") continue

        const participantsSnap = await get(ref(database, `meetingParticipants/${meeting.id}`))
        const participantsValue = participantsSnap.val() as Record<string, MeetingParticipant> | null
        const participants: MeetingParticipant[] = participantsValue ? Object.values(participantsValue) : []

        let relevantParticipants = participants

        if (normalizedDept) {
            relevantParticipants = relevantParticipants.filter((participant) => {
                const user = usersByUid[participant.uid]
                const deptRaw = typeof user?.department === "string" ? user.department : null
                if (!deptRaw) return false
                return deptRaw.trim().toLowerCase() === normalizedDept
            })

            if (relevantParticipants.length === 0) continue
        }

        if (normalizedLeader) {
            relevantParticipants = relevantParticipants.filter((participant) => {
                const user = usersByUid[participant.uid]
                const bossRaw = typeof user?.immediateBoss === "string" ? user.immediateBoss : null
                if (!bossRaw) return false
                return bossRaw.trim().toLowerCase() === normalizedLeader
            })

            if (relevantParticipants.length === 0) continue
        }

        // Áreas involucradas: todos los departamentos únicos de los participantes
        const areaSet = new Set<string>()
        for (const p of relevantParticipants) {
            const user = usersByUid[p.uid]
            if (user && typeof user.department === "string" && user.department.trim().length > 0) {
                areaSet.add(user.department.trim())
            }
        }
        const areas = Array.from(areaSet)

        const trainer = getTrainerNameFromParticipants(relevantParticipants)
        result.push({ meeting, participants: relevantParticipants, trainer, areas })
    }

    // Ordenar por fecha descendente
    result.sort((a, b) => b.meeting.startTime - a.meeting.startTime)
    return result
}
