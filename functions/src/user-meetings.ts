import { HttpsError, onCall } from "firebase-functions/v2/https"
import * as admin from "firebase-admin"

if (!admin.apps.length) {
	admin.initializeApp()
}

type MeetingKind = "meeting" | "training" | "custom"
type MeetingStatus = "draft" | "scheduled" | "closed" | "completed" | "cancelled"
type ParticipantRole = "attendee" | "speaker" | "host"
type InviteStatus = "invited" | "accepted" | "declined"
type AttendanceStatus = "absent" | "present" | "late"

interface RequestedRecintoInput {
	readonly url?: string | null
	readonly key?: string | null
}

interface RequestedRecinto {
	readonly url: string
	readonly key: string
}

interface UserMeetingsRequest {
	readonly now?: number | null
	readonly lookbackMs?: number | null
	readonly statuses?: readonly MeetingStatus[] | null
	readonly recintos?: readonly RequestedRecintoInput[] | null
}

interface UserMeetingIndexPayload {
	readonly meetingId: string
	readonly startTime: number
	readonly status: MeetingStatus
	readonly role: ParticipantRole
	readonly inviteStatus: InviteStatus
	readonly attendance?: AttendanceStatus | null
}

interface SourcePayload {
	readonly url: string
	readonly recinto: string
}

interface MeetingPayload {
	readonly id: string
	readonly title: string
	readonly type: MeetingKind
	readonly customType?: string | null
	readonly satisfactionSurveyId?: string | null
	readonly description?: string | null
	readonly location: string
	readonly startTime: number
	readonly endTime: number
	readonly status: MeetingStatus
	readonly createdBy: string
	readonly createdByName?: string | null
	readonly createdByEmail?: string | null
	readonly trainerName?: string | null
	readonly managers?: readonly string[] | null
	readonly createdAt: number
	readonly updatedAt?: number
	readonly closedAt?: number
	readonly closedBy?: string
	readonly cancelledAt?: number
	readonly cancelledBy?: string
	readonly cancellationReason?: string | null
	readonly source: SourcePayload
}

interface MeetingWithIndexPayload extends MeetingPayload {
	readonly index: UserMeetingIndexPayload
}

interface UserMeetingsResponse {
	readonly invited: readonly MeetingWithIndexPayload[]
	readonly created: readonly MeetingPayload[]
	readonly omittedRecintos: readonly string[]
}

interface ParsedRequest {
	readonly now: number
	readonly lookbackMs: number
	readonly statuses: readonly MeetingStatus[]
	readonly recintos: readonly RequestedRecinto[]
}

interface StoredMeeting {
	readonly title?: string | null
	readonly type?: string | null
	readonly customType?: string | null
	readonly satisfactionSurveyId?: string | null
	readonly description?: string | null
	readonly location?: string | null
	readonly startTime?: number | null
	readonly endTime?: number | null
	readonly status?: string | null
	readonly createdBy?: string | null
	readonly createdByName?: string | null
	readonly createdByEmail?: string | null
	readonly trainerName?: string | null
	readonly managers?: readonly string[] | null
	readonly createdAt?: number | null
	readonly updatedAt?: number | null
	readonly closedAt?: number | null
	readonly closedBy?: string | null
	readonly cancelledAt?: number | null
	readonly cancelledBy?: string | null
	readonly cancellationReason?: string | null
}

interface StoredUserMeetingIndex {
	readonly startTime?: number | null
	readonly status?: string | null
	readonly role?: string | null
	readonly inviteStatus?: string | null
	readonly attendance?: string | null
}

interface RecintoMeetingsResult {
	readonly invited: readonly MeetingWithIndexPayload[]
	readonly created: readonly MeetingPayload[]
}

const ALL_STATUSES: readonly MeetingStatus[] = [
	"draft",
	"scheduled",
	"closed",
	"completed",
	"cancelled",
]

const MAX_RECINTOS_PER_REQUEST = 10
const MAX_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000
const DEFAULT_LOOKBACK_MS = 12 * 60 * 60 * 1000
const MEETINGS_BATCH_SIZE = 40

function isMeetingKind(value?: string | null): value is MeetingKind {
	return value === "meeting" || value === "training" || value === "custom"
}

function isMeetingStatus(value?: string | null): value is MeetingStatus {
	return value === "draft" || value === "scheduled" || value === "closed" || value === "completed" || value === "cancelled"
}

function isParticipantRole(value?: string | null): value is ParticipantRole {
	return value === "attendee" || value === "speaker" || value === "host"
}

function isInviteStatus(value?: string | null): value is InviteStatus {
	return value === "invited" || value === "accepted" || value === "declined"
}

function isAttendanceStatus(value?: string | null): value is AttendanceStatus {
	return value === "absent" || value === "present" || value === "late"
}

function parseNumber(value: number | null | undefined, fieldName: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new HttpsError("invalid-argument", `${fieldName} debe ser un número válido (epoch ms).`)
	}
	return Math.trunc(value)
}

function normalizeStatuses(statuses: readonly MeetingStatus[] | null | undefined): readonly MeetingStatus[] {
	if (typeof statuses === "undefined" || statuses === null || statuses.length === 0) {
		return [...ALL_STATUSES]
	}

	const uniqueStatuses = Array.from(new Set(statuses))
	const invalidStatus = uniqueStatuses.find((status) => !isMeetingStatus(status))
	if (invalidStatus) {
		throw new HttpsError("invalid-argument", `Estado no permitido: ${invalidStatus}`)
	}

	return uniqueStatuses
}

function normalizeRecintos(recintos: readonly RequestedRecintoInput[] | null | undefined): readonly RequestedRecinto[] {
	if (!Array.isArray(recintos)) {
		throw new HttpsError("invalid-argument", "recintos debe ser un arreglo.")
	}

	if (recintos.length === 0) {
		throw new HttpsError("invalid-argument", "Debe enviar al menos un recinto.")
	}

	if (recintos.length > MAX_RECINTOS_PER_REQUEST) {
		throw new HttpsError(
			"invalid-argument",
			`No se permiten más de ${MAX_RECINTOS_PER_REQUEST} recintos por consulta.`,
		)
	}

	const normalizedByUrl = new Map<string, RequestedRecinto>()

	for (const recinto of recintos) {
		const url = typeof recinto.url === "string" ? recinto.url.trim() : ""
		const key = typeof recinto.key === "string" ? recinto.key.trim() : ""

		if (url.length === 0 || key.length === 0) {
			throw new HttpsError("invalid-argument", "Cada recinto debe incluir url y key válidos.")
		}

		let parsedUrl: URL
		try {
			parsedUrl = new URL(url)
		} catch {
			throw new HttpsError("invalid-argument", `URL de base de datos inválida: ${url}`)
		}

		const normalizedHostname = parsedUrl.hostname.toLowerCase()
		const isLocalHost = normalizedHostname === "localhost" || normalizedHostname === "127.0.0.1"
		const isFirebaseHost =
			normalizedHostname.endsWith(".firebasedatabase.app") ||
			normalizedHostname.endsWith(".firebaseio.com")
		if (!isLocalHost && !isFirebaseHost) {
			throw new HttpsError("invalid-argument", `Host no permitido para base de datos: ${parsedUrl.hostname}`)
		}

		if (!isLocalHost && parsedUrl.protocol !== "https:") {
			throw new HttpsError("invalid-argument", `La URL debe usar https: ${url}`)
		}

		if (!normalizedByUrl.has(url)) {
			normalizedByUrl.set(url, { url, key })
		}
	}

	return Array.from(normalizedByUrl.values())
}

function parseRequest(data: UserMeetingsRequest): ParsedRequest {
	const nowValue = typeof data.now === "undefined" || data.now === null
		? Date.now()
		: parseNumber(data.now, "now")

	const lookbackValue = typeof data.lookbackMs === "undefined" || data.lookbackMs === null
		? DEFAULT_LOOKBACK_MS
		: parseNumber(data.lookbackMs, "lookbackMs")

	const lookbackMs = Math.min(lookbackValue, MAX_LOOKBACK_MS)
	const statuses = normalizeStatuses(data.statuses)
	const recintos = normalizeRecintos(data.recintos)

	return {
		now: nowValue,
		lookbackMs,
		statuses,
		recintos,
	}
}

function normalizeString(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null
	}

	const trimmedValue = value.trim()
	return trimmedValue.length > 0 ? trimmedValue : null
}

function normalizeManagers(managers: readonly string[] | null | undefined): readonly string[] | null {
	if (!Array.isArray(managers)) {
		return null
	}

	const values = managers
		.filter((manager) => typeof manager === "string")
		.map((manager) => manager.trim())
		.filter((manager) => manager.length > 0)

	return values.length > 0 ? values : null
}

function mapMeeting(
	meetingId: string,
	storedMeeting: StoredMeeting,
	source: SourcePayload,
): MeetingPayload | null {
	const title = normalizeString(storedMeeting.title)
	const location = normalizeString(storedMeeting.location)
	const createdBy = normalizeString(storedMeeting.createdBy)
	const kind = isMeetingKind(storedMeeting.type) ? storedMeeting.type : null
	const status = isMeetingStatus(storedMeeting.status) ? storedMeeting.status : null

	if (!title || !location || !createdBy || !kind || !status) {
		return null
	}

	const startTime = typeof storedMeeting.startTime === "number" && Number.isFinite(storedMeeting.startTime)
		? Math.trunc(storedMeeting.startTime)
		: null
	const endTime = typeof storedMeeting.endTime === "number" && Number.isFinite(storedMeeting.endTime)
		? Math.trunc(storedMeeting.endTime)
		: null
	const createdAt = typeof storedMeeting.createdAt === "number" && Number.isFinite(storedMeeting.createdAt)
		? Math.trunc(storedMeeting.createdAt)
		: startTime

	if (startTime === null || endTime === null || createdAt === null) {
		return null
	}

	return {
		id: meetingId,
		title,
		type: kind,
		customType: normalizeString(storedMeeting.customType),
		satisfactionSurveyId: normalizeString(storedMeeting.satisfactionSurveyId),
		description: normalizeString(storedMeeting.description),
		location,
		startTime,
		endTime,
		status,
		createdBy,
		createdByName: normalizeString(storedMeeting.createdByName),
		createdByEmail: normalizeString(storedMeeting.createdByEmail),
		trainerName: normalizeString(storedMeeting.trainerName),
		managers: normalizeManagers(storedMeeting.managers),
		createdAt,
		updatedAt: typeof storedMeeting.updatedAt === "number" ? Math.trunc(storedMeeting.updatedAt) : undefined,
		closedAt: typeof storedMeeting.closedAt === "number" ? Math.trunc(storedMeeting.closedAt) : undefined,
		closedBy: normalizeString(storedMeeting.closedBy) ?? undefined,
		cancelledAt: typeof storedMeeting.cancelledAt === "number" ? Math.trunc(storedMeeting.cancelledAt) : undefined,
		cancelledBy: normalizeString(storedMeeting.cancelledBy) ?? undefined,
		cancellationReason: normalizeString(storedMeeting.cancellationReason),
		source,
	}
}

function mapUserMeetingIndex(
	meetingId: string,
	storedIndex: StoredUserMeetingIndex,
): UserMeetingIndexPayload | null {
	const status = isMeetingStatus(storedIndex.status) ? storedIndex.status : null
	const role = isParticipantRole(storedIndex.role) ? storedIndex.role : null
	const inviteStatus = isInviteStatus(storedIndex.inviteStatus) ? storedIndex.inviteStatus : null
	const startTime = typeof storedIndex.startTime === "number" && Number.isFinite(storedIndex.startTime)
		? Math.trunc(storedIndex.startTime)
		: null

	if (status === null || role === null || inviteStatus === null || startTime === null) {
		return null
	}

	return {
		meetingId,
		startTime,
		status,
		role,
		inviteStatus,
		attendance: isAttendanceStatus(storedIndex.attendance) ? storedIndex.attendance : null,
	}
}

async function loadMeetingsById(
	database: admin.database.Database,
	meetingIds: readonly string[],
	source: SourcePayload,
): Promise<Record<string, MeetingPayload>> {
	const meetingsById: Record<string, MeetingPayload> = {}

	for (let index = 0; index < meetingIds.length; index += MEETINGS_BATCH_SIZE) {
		const batchIds = meetingIds.slice(index, index + MEETINGS_BATCH_SIZE)
		const batchEntries = await Promise.all(
			batchIds.map(async (meetingId) => {
				const meetingSnap = await database.ref(`meetings/${meetingId}`).get()
				if (!meetingSnap.exists()) {
					return [meetingId, null] as const
				}
				const storedMeeting = meetingSnap.val() as StoredMeeting
				const meeting = mapMeeting(meetingId, storedMeeting, source)
				return [meetingId, meeting] as const
			}),
		)

		for (const [meetingId, meeting] of batchEntries) {
			if (meeting) {
				meetingsById[meetingId] = meeting
			}
		}
	}

	return meetingsById
}

async function getInvitedMeetingsForRecinto(
	database: admin.database.Database,
	source: SourcePayload,
	uid: string,
	minStartTime: number,
	statusSet: ReadonlySet<MeetingStatus>,
): Promise<MeetingWithIndexPayload[]> {
	const userMeetingsSnap = await database
		.ref(`userMeetings/${uid}`)
		.orderByChild("startTime")
		.startAt(minStartTime)
		.get()

	const rawIndexes = userMeetingsSnap.val() as Record<string, StoredUserMeetingIndex> | null
	if (!rawIndexes) {
		return []
	}

	const indexByMeetingId: Record<string, UserMeetingIndexPayload> = {}
	for (const [meetingId, storedIndex] of Object.entries(rawIndexes)) {
		const index = mapUserMeetingIndex(meetingId, storedIndex)
		if (!index) {
			continue
		}
		if (!statusSet.has(index.status)) {
			continue
		}
		indexByMeetingId[meetingId] = index
	}

	const meetingIds = Object.keys(indexByMeetingId)
	if (meetingIds.length === 0) {
		return []
	}

	const meetingsById = await loadMeetingsById(database, meetingIds, source)
	const invited: MeetingWithIndexPayload[] = []

	for (const meetingId of meetingIds) {
		const meeting = meetingsById[meetingId]
		if (!meeting) {
			continue
		}
		invited.push({
			...meeting,
			index: indexByMeetingId[meetingId],
		})
	}

	return invited
}

async function getCreatedMeetingsForRecinto(
	database: admin.database.Database,
	source: SourcePayload,
	uid: string,
): Promise<MeetingPayload[]> {
	const createdSnap = await database
		.ref("meetings")
		.orderByChild("createdBy")
		.equalTo(uid)
		.get()

	const rawMeetings = createdSnap.val() as Record<string, StoredMeeting> | null
	if (!rawMeetings) {
		return []
	}

	const created: MeetingPayload[] = []
	for (const [meetingId, rawMeeting] of Object.entries(rawMeetings)) {
		const meeting = mapMeeting(meetingId, rawMeeting, source)
		if (meeting) {
			created.push(meeting)
		}
	}

	return created
}

async function loadMeetingsForRecinto(
	recinto: RequestedRecinto,
	uid: string,
	minStartTime: number,
	statusSet: ReadonlySet<MeetingStatus>,
): Promise<RecintoMeetingsResult> {
	const database = admin.app().database(recinto.url)
	const source: SourcePayload = {
		url: recinto.url,
		recinto: recinto.key,
	}

	const [invited, created] = await Promise.all([
		getInvitedMeetingsForRecinto(database, source, uid, minStartTime, statusSet),
		getCreatedMeetingsForRecinto(database, source, uid),
	])

	return {
		invited,
		created,
	}
}

export const getUserMeetings = onCall<UserMeetingsRequest>(
	{ timeoutSeconds: 120, memory: "512MiB", cors: true },
	async (request): Promise<UserMeetingsResponse> => {
		if (!request.auth) {
			throw new HttpsError("unauthenticated", "Debes iniciar sesión para consultar actividades.")
		}

		const parsed = parseRequest(request.data)
		const minStartTime = Math.max(0, parsed.now - parsed.lookbackMs)
		const statusSet = new Set(parsed.statuses)

		const recintoResults = await Promise.allSettled(
			parsed.recintos.map((recinto) => loadMeetingsForRecinto(recinto, request.auth!.uid, minStartTime, statusSet)),
		)

		const invited: MeetingWithIndexPayload[] = []
		const created: MeetingPayload[] = []
		const omittedRecintos: string[] = []

		recintoResults.forEach((result, index) => {
			if (result.status === "fulfilled") {
				invited.push(...result.value.invited)
				created.push(...result.value.created)
				return
			}

			const failedRecinto = parsed.recintos[index]
			omittedRecintos.push(failedRecinto.url)
			console.error(`No fue posible cargar reuniones para recinto ${failedRecinto.url}:`, result.reason)
		})

		if (omittedRecintos.length === parsed.recintos.length) {
			throw new HttpsError("internal", "No fue posible cargar reuniones para los recintos solicitados.")
		}

		return {
			invited,
			created,
			omittedRecintos,
		}
	},
)
