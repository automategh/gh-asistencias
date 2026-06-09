import { get, query, ref, orderByChild, startAt, endAt, type Database } from "firebase/database"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
import type { UserProfile } from "@/types/user"
import { getTrainerNameFromParticipants } from "@/services/meetings.analytics.service"

interface ExternalTrainingParticipantRecord {
    readonly id?: string | null
    readonly name?: string | null
    readonly email?: string | null
    readonly attendance?: "present" | "late" | "absent" | null
    readonly noShow?: boolean | null
    readonly checkedInAt?: number | null
    readonly checkinMethod?: "qr" | "manual" | null
}

function mapExternalTrainingParticipants(
    records: Record<string, ExternalTrainingParticipantRecord> | null,
): MeetingParticipant[] {
    if (!records) {
        return []
    }

    const externalParticipants: MeetingParticipant[] = []

    for (const [externalKey, record] of Object.entries(records)) {
        const externalId = typeof record.id === "string" && record.id.trim().length > 0
            ? record.id.trim()
            : externalKey
        const participantName = typeof record.name === "string" ? record.name.trim() : ""

        if (!externalId || participantName.length === 0) {
            continue
        }

        externalParticipants.push({
            uid: `ext_${externalId}`,
            name: participantName,
            email: typeof record.email === "string" && record.email.trim().length > 0
                ? record.email.trim()
                : "externo@registro.local",
            role: "attendee",
            inviteStatus: "accepted",
            attendance: record.attendance ?? null,
            noShow: Boolean(record.noShow),
            checkedInAt: typeof record.checkedInAt === "number" ? record.checkedInAt : undefined,
            checkinMethod: record.checkinMethod === "qr" || record.checkinMethod === "manual"
                ? record.checkinMethod
                : undefined,
        })
    }

    return externalParticipants
}

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
    leaderUid?: string | null,
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

        const [participantsSnap, externalParticipantsSnap] = await Promise.all([
            get(ref(database, `meetingParticipants/${meeting.id}`)),
            get(ref(database, `meetingExternalParticipants/${meeting.id}`)),
        ])

        const participantsValue = participantsSnap.val() as Record<string, MeetingParticipant> | null
        const participants: MeetingParticipant[] = participantsValue ? Object.values(participantsValue) : []
        const externalParticipantsValue = externalParticipantsSnap.val() as Record<string, ExternalTrainingParticipantRecord> | null
        const externalParticipants = mapExternalTrainingParticipants(externalParticipantsValue)
        const participantsWithExternal = [...participants, ...externalParticipants]

        let relevantInternalParticipants = participants

        if (normalizedDept) {
            relevantInternalParticipants = relevantInternalParticipants.filter((participant) => {
                const user = usersByUid[participant.uid]
                const deptRaw = typeof user?.department === "string" ? user.department : null
                if (!deptRaw) return false
                return deptRaw.trim().toLowerCase() === normalizedDept
            })

            if (relevantInternalParticipants.length === 0) continue
        }

        if (normalizedLeader || leaderUid) {
            relevantInternalParticipants = relevantInternalParticipants.filter((participant) => {
                const user = usersByUid[participant.uid]
                if (leaderUid) {
                    if (typeof user?.immediateBossUid === "string" && user.immediateBossUid === leaderUid) {
                        return true
                    }
                }
                if (normalizedLeader) {
                    const bossRaw = typeof user?.immediateBoss === "string" ? user.immediateBoss : null
                    if (bossRaw && bossRaw.trim().toLowerCase() === normalizedLeader) {
                        return true
                    }
                }
                return false
            })

            if (relevantInternalParticipants.length === 0) continue
        }

        const relevantParticipants = normalizedDept || normalizedLeader || leaderUid
            ? [...relevantInternalParticipants, ...externalParticipants]
            : participantsWithExternal

        // Áreas involucradas: todos los departamentos únicos de los participantes
        const areaSet = new Set<string>()
        for (const p of relevantInternalParticipants) {
            const user = usersByUid[p.uid]
            if (user && typeof user.department === "string" && user.department.trim().length > 0) {
                areaSet.add(user.department.trim())
            }
        }
        const areas = Array.from(areaSet)

        const trainer = meeting.trainerName?.trim() || getTrainerNameFromParticipants(relevantParticipants)
        result.push({ meeting, participants: relevantParticipants, trainer, areas })
    }

    // Ordenar por fecha descendente
    result.sort((a, b) => b.meeting.startTime - a.meeting.startTime)
    return result
}
