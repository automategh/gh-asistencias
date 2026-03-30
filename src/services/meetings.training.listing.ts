import { get, query, ref, orderByChild, startAt, endAt, Database } from "firebase/database"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
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
    department?: string | null
): Promise<TrainingWithParticipants[]> {
    const startOfYear = new Date(year, 0, 1, 0, 0, 0, 0).getTime()
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999).getTime()

    const meetingsRef = ref(database, "meetings")
    const q = query(
        meetingsRef,
        orderByChild("startTime"),
        startAt(startOfYear),
        endAt(endOfYear)
    )

    const snapshot = await get(q)
    const meetingsMap = snapshot.val() as Record<string, Meeting> | null
    if (!meetingsMap) return []

    const usersSnap = await get(ref(database, "users"))
    const usersValue = usersSnap.val() as Record<string, { department?: string }> | null
    const usersByUid = usersValue ?? {}

    const result: TrainingWithParticipants[] = []

    for (const meeting of Object.values(meetingsMap)) {
        if (meeting.type !== "training") continue

        const participantsSnap = await get(ref(database, `meetingParticipants/${meeting.id}`))
        const participantsValue = participantsSnap.val() as Record<string, MeetingParticipant> | null
        const participants: MeetingParticipant[] = participantsValue ? Object.values(participantsValue) : []

        let relevantParticipants = participants
        if (department && department.trim().length > 0) {
            const normalizedDept = department.trim().toLowerCase()
            relevantParticipants = participants.filter((p) => {
                const user = usersByUid[p.uid]
                const deptRaw = typeof user?.department === "string" ? user.department : null
                return deptRaw && deptRaw.trim().toLowerCase() === normalizedDept
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
