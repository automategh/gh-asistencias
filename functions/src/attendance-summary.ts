import { HttpsError, onCall } from "firebase-functions/v2/https"
import * as admin from "firebase-admin"

if (!admin.apps.length) {
	admin.initializeApp()
}

type AnalyticsMeetingKind = "meeting" | "training" | "custom"
type AnalyticsTypeFilter = AnalyticsMeetingKind | "ALL"
type AnalyticsScopeFilter = "all" | "team" | "self"

interface AttendanceSummaryRequest {
	readonly startTime?: number | null
	readonly endTime?: number | null
	readonly type?: AnalyticsTypeFilter | null
	readonly databaseUrls?: readonly string[] | null
	readonly scope?: AnalyticsScopeFilter | null
	readonly scopeOwnerUid?: string | null
}

interface MeetingKindStats {
	meetings: number
	invited: number
	present: number
	late: number
	absent: number
}

interface AttendanceSummary {
	totalMeetings: number
	totalInvited: number
	totalPresent: number
	totalLate: number
	totalAbsent: number
	byType: Record<AnalyticsMeetingKind, MeetingKindStats>
}

interface AttendanceSummaryResponse {
	readonly summary: AttendanceSummary
	readonly omittedDatabases: readonly string[]
}

interface AttendanceQueryOptions {
	readonly startTime: number
	readonly endTime: number
	readonly type: AnalyticsTypeFilter
	readonly scope: AnalyticsScopeFilter
	readonly scopeOwnerUid: string | null
}

interface StoredMeeting {
	readonly type?: string | null
}

interface StoredParticipant {
	readonly uid?: string | null
	readonly attendance?: string | null
	readonly noShow?: boolean | null
}

interface MeetingSnapshotItem {
	readonly id: string
	readonly type: AnalyticsMeetingKind
}

function participantMatchesScope(
	participant: StoredParticipant,
	scope: AnalyticsScopeFilter,
	scopeOwnerUid: string | null,
	teamUids: ReadonlySet<string>,
): boolean {
	if (scope === "all") {
		return true
	}
	if (!scopeOwnerUid) {
		return false
	}
	if (scope === "self") {
		return participant.uid === scopeOwnerUid
	}
	// scope === "team": incluye al dueño y a su equipo
	if (participant.uid === scopeOwnerUid) {
		return true
	}
	if (participant.uid === undefined || participant.uid === null) {
		return false
	}
	return teamUids.has(participant.uid)
}

async function loadTeamUidsForOwner(
	database: admin.database.Database,
	ownerUid: string,
): Promise<Set<string>> {
	const teamUids = new Set<string>()
	const usersSnap = await database.ref("users").get()
	const users = usersSnap.val() as Record<string, { immediateBossUid?: string | null; immediateBoss?: string | null }> | null
	if (!users) {
		return teamUids
	}
	for (const [uid, record] of Object.entries(users)) {
		if (uid === ownerUid) continue
		if (record.immediateBossUid === ownerUid) {
			teamUids.add(uid)
		}
	}
	return teamUids
}

const PARTICIPANTS_BATCH_SIZE = 25
const MAX_DATABASES_PER_REQUEST = 10
const CORPORATE_DOMAIN = "grupoheroica.com"

function createEmptyKindStats(): MeetingKindStats {
	return {
		meetings: 0,
		invited: 0,
		present: 0,
		late: 0,
		absent: 0,
	}
}

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

function isMeetingKind(value?: string | null): value is AnalyticsMeetingKind {
	return value === "meeting" || value === "training" || value === "custom"
}

function parseEpochMs(value: number | null | undefined, fieldName: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new HttpsError("invalid-argument", `${fieldName} debe ser un número válido (epoch ms).`)
	}
	return Math.trunc(value)
}

function normalizeTypeFilter(value: AnalyticsTypeFilter | null | undefined): AnalyticsTypeFilter {
	if (typeof value === "undefined" || value === null) {
		return "ALL"
	}

	if (value === "ALL" || value === "meeting" || value === "training" || value === "custom") {
		return value
	}

	throw new HttpsError("invalid-argument", "El filtro de tipo no es válido.")
}

function normalizeScopeFilter(value: AnalyticsScopeFilter | null | undefined): AnalyticsScopeFilter {
	if (typeof value === "undefined" || value === null) {
		return "all"
	}

	if (value === "all" || value === "team" || value === "self") {
		return value
	}

	throw new HttpsError("invalid-argument", "El alcance (scope) no es válido.")
}

function normalizeDatabaseUrls(databaseUrls: readonly string[] | null | undefined): string[] {
	if (!Array.isArray(databaseUrls)) {
		throw new HttpsError("invalid-argument", "databaseUrls debe ser un arreglo de URLs.")
	}

	if (databaseUrls.length === 0) {
		throw new HttpsError("invalid-argument", "Debe enviar al menos una base de datos.")
	}

	if (databaseUrls.length > MAX_DATABASES_PER_REQUEST) {
		throw new HttpsError(
			"invalid-argument",
			`No se permiten más de ${MAX_DATABASES_PER_REQUEST} bases por consulta.`,
		)
	}

	const normalized = Array.from(
		new Set(
			databaseUrls
				.map((url) => (typeof url === "string" ? url.trim() : ""))
				.filter((url) => url.length > 0),
		),
	)

	for (const databaseUrl of normalized) {
		let parsedUrl: URL
		try {
			parsedUrl = new URL(databaseUrl)
		} catch {
			throw new HttpsError("invalid-argument", `URL de base de datos inválida: ${databaseUrl}`)
		}

		const isLocalHost =
			parsedUrl.hostname === "localhost" ||
			parsedUrl.hostname === "127.0.0.1"
		const normalizedHostname = parsedUrl.hostname.toLowerCase()
		const isFirebaseHost =
			normalizedHostname.endsWith(".firebasedatabase.app") ||
			normalizedHostname.endsWith(".firebaseio.com")

		if (!isLocalHost && !isFirebaseHost) {
			throw new HttpsError("invalid-argument", `Host de base de datos no permitido: ${parsedUrl.hostname}`)
		}

		if (!isLocalHost && parsedUrl.protocol !== "https:") {
			throw new HttpsError("invalid-argument", `La URL debe usar https: ${databaseUrl}`)
		}
	}

	if (normalized.length === 0) {
		throw new HttpsError("invalid-argument", "No hay URLs de base de datos válidas.")
	}

	return normalized
}

function normalizeEmail(email: string | null | undefined): string | null {
	if (typeof email !== "string") {
		return null
	}

	const trimmedEmail = email.trim().toLowerCase()
	return trimmedEmail.length > 0 ? trimmedEmail : null
}

function isCorporateEmail(email: string | null): boolean {
	if (!email) {
		return false
	}

	const parts = email.split("@")
	if (parts.length !== 2) {
		return false
	}

	return parts[1] === CORPORATE_DOMAIN
}

async function resolveAuthorizedDatabaseUrls(
	requestedUrls: readonly string[],
	requesterUid: string,
	requesterEmail: string | null,
): Promise<string[]> {
	if (isCorporateEmail(requesterEmail)) {
		return [...requestedUrls]
	}

	const authorizationChecks = await Promise.all(
		requestedUrls.map(async (databaseUrl) => {
			const database = admin.app().database(databaseUrl)
			const userSnap = await database.ref(`users/${requesterUid}`).get()
			return userSnap.exists() ? databaseUrl : null
		}),
	)

	return authorizationChecks.filter((databaseUrl): databaseUrl is string => databaseUrl !== null)
}

function parseRequest(data: AttendanceSummaryRequest): {
	readonly options: AttendanceQueryOptions
	readonly databaseUrls: string[]
} {
	const startTime = parseEpochMs(data.startTime, "startTime")
	const endTime = parseEpochMs(data.endTime, "endTime")

	if (startTime > endTime) {
		throw new HttpsError("invalid-argument", "startTime debe ser menor o igual que endTime.")
	}

	const type = normalizeTypeFilter(data.type)
	const databaseUrls = normalizeDatabaseUrls(data.databaseUrls)
	const scope = normalizeScopeFilter(data.scope)
	const scopeOwnerUid = typeof data.scopeOwnerUid === "string" && data.scopeOwnerUid.trim().length > 0
		? data.scopeOwnerUid.trim()
		: null

	return {
		options: {
			startTime,
			endTime,
			type,
			scope,
			scopeOwnerUid,
		},
		databaseUrls,
	}
}

function accumulateMeeting(
	summary: AttendanceSummary,
	meetingType: AnalyticsMeetingKind,
	participants: readonly StoredParticipant[],
	scope: AnalyticsScopeFilter,
	scopeOwnerUid: string | null,
	teamUids: ReadonlySet<string>,
): void {
	const filtered = participants.filter((participant) =>
		participantMatchesScope(participant, scope, scopeOwnerUid, teamUids),
	)
	if (filtered.length === 0) {
		return
	}

	const kindStats = summary.byType[meetingType]
	summary.totalMeetings += 1
	kindStats.meetings += 1

	for (const participant of filtered) {
		summary.totalInvited += 1
		kindStats.invited += 1

		const isNoShow = Boolean(participant.noShow)
		const attendance = participant.attendance ?? null

		if (isNoShow) {
			summary.totalAbsent += 1
			kindStats.absent += 1
		} else if (attendance === "present") {
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

function mergeSummary(target: AttendanceSummary, source: AttendanceSummary): void {
	target.totalMeetings += source.totalMeetings
	target.totalInvited += source.totalInvited
	target.totalPresent += source.totalPresent
	target.totalLate += source.totalLate
	target.totalAbsent += source.totalAbsent

	for (const kind of Object.keys(target.byType) as AnalyticsMeetingKind[]) {
		target.byType[kind].meetings += source.byType[kind].meetings
		target.byType[kind].invited += source.byType[kind].invited
		target.byType[kind].present += source.byType[kind].present
		target.byType[kind].late += source.byType[kind].late
		target.byType[kind].absent += source.byType[kind].absent
	}
}

async function loadParticipantsByMeetingId(
	database: admin.database.Database,
	meetingIds: readonly string[],
): Promise<Record<string, StoredParticipant[]>> {
	const participantsByMeeting: Record<string, StoredParticipant[]> = {}

	for (let index = 0; index < meetingIds.length; index += PARTICIPANTS_BATCH_SIZE) {
		const batchIds = meetingIds.slice(index, index + PARTICIPANTS_BATCH_SIZE)

		const batchEntries = await Promise.all(
			batchIds.map(async (meetingId) => {
				const participantsSnap = await database.ref(`meetingParticipants/${meetingId}`).get()
				const participantsValue = participantsSnap.val() as Record<string, StoredParticipant> | null
				const participants = participantsValue ? Object.values(participantsValue) : []
				return [meetingId, participants] as const
			}),
		)

		for (const [meetingId, participants] of batchEntries) {
			participantsByMeeting[meetingId] = participants
		}
	}

	return participantsByMeeting
}

async function getAttendanceSummaryForDatabase(
	databaseUrl: string,
	options: AttendanceQueryOptions,
): Promise<AttendanceSummary> {
	const database = admin.app().database(databaseUrl)
	const meetingsSnap = await database
		.ref("meetings")
		.orderByChild("startTime")
		.startAt(options.startTime)
		.endAt(options.endTime)
		.get()

	const meetingsValue = meetingsSnap.val() as Record<string, StoredMeeting> | null
	if (!meetingsValue) {
		return createEmptySummary()
	}

	const meetings: MeetingSnapshotItem[] = Object.entries(meetingsValue)
		.filter(([, meeting]) => {
			if (!isMeetingKind(meeting.type)) {
				return false
			}
			if (options.type === "ALL") {
				return true
			}
			return meeting.type === options.type
		})
		.map(([meetingId, meeting]) => ({
			id: meetingId,
			type: meeting.type as AnalyticsMeetingKind,
		}))

	const summary = createEmptySummary()
	if (meetings.length === 0) {
		return summary
	}

	const teamUids = options.scope === "team" && options.scopeOwnerUid
		? await loadTeamUidsForOwner(database, options.scopeOwnerUid)
		: new Set<string>()

	const participantsByMeetingId = await loadParticipantsByMeetingId(
		database,
		meetings.map((meeting) => meeting.id),
	)

	for (const meeting of meetings) {
		const participants = participantsByMeetingId[meeting.id] ?? []
		accumulateMeeting(summary, meeting.type, participants, options.scope, options.scopeOwnerUid, teamUids)
	}

	return summary
}

export const getAttendanceSummary = onCall<AttendanceSummaryRequest>(
	{ timeoutSeconds: 120, memory: "512MiB", cors: true },
	async (request): Promise<AttendanceSummaryResponse> => {
		if (!request.auth) {
			throw new HttpsError("unauthenticated", "Debes iniciar sesión para consultar métricas.")
		}

		const { options, databaseUrls } = parseRequest(request.data)
		const requesterEmail = normalizeEmail(request.auth.token.email)
		const authorizedDatabaseUrls = await resolveAuthorizedDatabaseUrls(
			databaseUrls,
			request.auth.uid,
			requesterEmail,
		)

		if (authorizedDatabaseUrls.length !== databaseUrls.length) {
			throw new HttpsError(
				"permission-denied",
				"No tienes permisos para consultar uno o más recintos solicitados.",
			)
		}

		const summaryResults = await Promise.allSettled(
			authorizedDatabaseUrls.map((databaseUrl) => getAttendanceSummaryForDatabase(databaseUrl, options)),
		)

		const merged = createEmptySummary()
		const omittedDatabases: string[] = []

		summaryResults.forEach((result, index) => {
			if (result.status === "fulfilled") {
				mergeSummary(merged, result.value)
				return
			}

			const failedUrl = authorizedDatabaseUrls[index]
			omittedDatabases.push(failedUrl)
			console.error(`No fue posible calcular métricas para ${failedUrl}:`, result.reason)
		})

		if (omittedDatabases.length === authorizedDatabaseUrls.length) {
			throw new HttpsError("internal", "No fue posible calcular métricas para los recintos solicitados.")
		}

		return {
			summary: merged,
			omittedDatabases,
		}
	},
)
