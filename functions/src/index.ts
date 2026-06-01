import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onValueUpdated } from "firebase-functions/v2/database";
import * as admin from "firebase-admin";
import * as fs from "node:fs";
import * as path from "node:path";
import PDFDocument from "pdfkit";
import { Graph, type CreateTeamsMeetingOptions, type GraphEvent, type MeetingAttendee, type UpdateTeamsMeetingOptions } from "./graph";
export { getAttendanceSummary } from "./attendance-summary";
export { getUserMeetings } from "./user-meetings";

if (!admin.apps.length) {
	admin.initializeApp();
}

type RoleScope = "global" | "local";
type RecintoKey = "corporativo" | "ccci" | "cccr" | "cevp";

interface RolePermissions {
	readonly [permissionId: string]: boolean;
}

interface AttendanceUpdateRequest {
	readonly meetingId: string;
	readonly participantUid: string;
	readonly meetingDatabaseUrl: string;
	readonly userDatabaseUrl?: string | null;
	readonly changes: AttendanceUpdateChanges;
}

interface AttendanceUpdateChanges {
	readonly attendance?: "absent" | "present" | "late" | null;
	readonly checkedInAt?: number | null;
	readonly checkinMethod?: "qr" | "manual" | null;
	readonly noShow?: boolean | null;
}

interface RegisterExternalCheckinRequest {
	readonly meetingId: string;
	readonly meetingDatabaseUrl: string;
	readonly externalParticipant: {
		readonly name: string;
		readonly companyName: string;
		readonly email?: string | null;
		readonly documentId?: string | null;
		readonly signatureDataUrl: string;
		readonly checkinMethod?: "qr" | "manual";
	};
}

interface RegisterExternalCheckinResponse {
	readonly externalId: string;
	readonly attendance: "present" | "late";
	readonly checkedInAt: number;
	readonly alreadyRegistered: boolean;
	readonly surveyId?: string | null;
}

interface ExternalMeetingRecord {
	readonly status?: string | null;
	readonly startTime?: number | null;
	readonly type?: string | null;
	readonly satisfactionSurveyId?: string | null;
}

interface ExternalParticipantRecord {
	readonly id: string;
	readonly name: string;
	readonly companyName: string;
	readonly email: string | null;
	readonly documentId: string | null;
	readonly signatureDataUrl: string;
	readonly attendance: "present" | "late";
	readonly checkedInAt: number;
	readonly checkinMethod: "qr" | "manual";
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly noShow: false;
	readonly source: "external";
}

interface GetExternalSurveyForCheckinRequest {
	readonly surveyId: string;
	readonly trainingId: string;
	readonly meetingDatabaseUrl: string;
	readonly externalId: string;
}

interface SubmitExternalSurveyResponseRequest {
	readonly surveyId: string;
	readonly trainingId: string;
	readonly meetingDatabaseUrl: string;
	readonly externalId: string;
	readonly answers: Record<string, string | number | readonly string[] | null | undefined>;
}

interface ExternalSurveyQuestion {
	readonly id: string;
	readonly surveyId: string;
	readonly order: number;
	readonly text: string;
	readonly type: "single" | "multiple" | "text" | "rating";
	readonly required: boolean;
}

interface ExternalSurveyOption {
	readonly id: string;
	readonly questionId: string;
	readonly order: number;
	readonly text: string;
	readonly value?: number;
}

interface ExternalSurveyPayload {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly category: string;
	readonly isActive: boolean;
}

interface StoredMeetingRecord {
	readonly startTime?: number | null;
	readonly status?: string | null;
}

interface StoredParticipantRecord {
	readonly uid?: string | null;
	readonly name?: string | null;
	readonly email?: string | null;
	readonly role?: string | null;
	readonly inviteStatus?: string | null;
	readonly attendance?: "absent" | "present" | "late" | null;
	readonly checkedInAt?: number | null;
	readonly checkinMethod?: "qr" | "manual" | null;
	readonly noShow?: boolean | null;
}

interface RoleUpsertPayload {
	readonly id: string;
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly scope: RoleScope;
	readonly syncKey?: string;
	readonly system: boolean;
	readonly active: boolean;
	readonly permissions: RolePermissions;
	readonly createdAt?: string;
	readonly sourceRecinto?: RecintoKey;
}

interface RoleUpsertRequest {
	readonly role: RoleUpsertPayload;
}

interface StoredRoleDefinition extends RoleUpsertPayload {
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly version: number;
}

const AUTHORIZATION_VERSION = 1;

const getDatabaseUrlMap = (): Record<RecintoKey, string | null> => {
	const defaultUrl = (admin.app().options.databaseURL as string | undefined) ?? process.env.DATABASE_URL ?? null;
	return {
		corporativo: defaultUrl ?? process.env.DATABASE_URL ?? null,
		ccci: process.env.DATABASE_URL_CCCI ?? process.env.DATABASE_URL_CCCI ?? null,
		cccr: process.env.DATABASE_URL_CCCR ?? process.env.DATABASE_URL_CCCR ?? null,
		cevp: process.env.DATABASE_URL_CEVP ?? process.env.DATABASE_URL_CEVP ?? null,
	};
};

const listDatabaseUrls = (): string[] => {
	const map = getDatabaseUrlMap();
	return Object.values(map).filter((url): url is string => typeof url === "string" && url.length > 0);
};

const normalizeDatabaseUrl = (url: string): string => {
	return url.trim().replace(/\/+$/, "");
};

const resolveDatabaseUrlByRecinto = (recinto?: RecintoKey): string | null => {
	if (!recinto) {
		return null;
	}
	const map = getDatabaseUrlMap();
	return map[recinto] ?? null;
};

const hasPermissionInDatabase = async (databaseUrl: string, uid: string, permissionId: string): Promise<boolean> => {
	const db = admin.app().database(databaseUrl);
	const userSnapshot = await db.ref(`users/${uid}`).get();
	if (!userSnapshot.exists()) {
		return false;
	}

	const legacyRole = userSnapshot.child("role").val();
	if (legacyRole === "Admin") {
		return true;
	}

	const roleId = userSnapshot.child("roleId").val();
	if (typeof roleId !== "string" || roleId.trim().length === 0) {
		return false;
	}

	const permissionSnapshot = await db.ref(`roles/${roleId}/permissions/${permissionId}`).get();
	return permissionSnapshot.val() === true;
};

const hasRolesManagePermission = async (uid: string): Promise<boolean> => {
	const databaseUrls = listDatabaseUrls();

	for (const databaseUrl of databaseUrls) {
		const db = admin.app().database(databaseUrl);
		const userSnapshot = await db.ref(`users/${uid}`).get();
		if (!userSnapshot.exists()) {
			continue;
		}

		const legacyRole = userSnapshot.child("role").val();
		if (legacyRole === "Admin") {
			return true;
		}

		const roleId = userSnapshot.child("roleId").val();
		if (typeof roleId !== "string" || roleId.trim().length === 0) {
			continue;
		}

		const permissionSnapshot = await db.ref(`roles/${roleId}/permissions/roles_manage`).get();
		if (permissionSnapshot.val() === true) {
			return true;
		}
	}

	return false;
};

const resolveSyncKey = (role: RoleUpsertPayload): string => {
	if (role.syncKey && role.syncKey.trim().length > 0) {
		return role.syncKey;
	}
	if (role.system) {
		return `system:${role.id}`;
	}
	if (role.scope === "global") {
		return `custom:${role.id}`;
	}
	return `local:${role.sourceRecinto ?? "corporativo"}:${role.id}`;
};

const normalizeIdentity = (value?: string | null): string | null => {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : null;
};

const sanitizeKey = (value: string): string => {
	return value.replace(/[^a-z0-9]/gi, "_");
};

const computeExternalAttendance = (meetingStartTime: number, checkedInAt: number): "present" | "late" => {
	const graceMs = 5 * 60 * 1000;
	return checkedInAt > meetingStartTime + graceMs ? "late" : "present";
};

const normalizeRequiredString = (value: unknown): string => {
	if (typeof value !== "string") {
		return "";
	}
	return value.trim();
};

const resolveKnownDatabaseUrlOrThrow = (databaseUrl: string | null | undefined): string => {
	const cleanUrl = normalizeDatabaseUrl(normalizeRequiredString(databaseUrl));
	if (!cleanUrl) {
		throw new HttpsError("invalid-argument", "meetingDatabaseUrl es requerido.");
	}

	const availableUrls = new Set(listDatabaseUrls().map(normalizeDatabaseUrl));
	if (!availableUrls.has(cleanUrl)) {
		throw new HttpsError("invalid-argument", "meetingDatabaseUrl no es válido.");
	}

	return cleanUrl;
};

const loadMeetingOrThrow = async (db: admin.database.Database, meetingId: string): Promise<ExternalMeetingRecord> => {
	const snapshot = await db.ref(`meetings/${meetingId}`).get();
	if (!snapshot.exists()) {
		throw new HttpsError("not-found", "La actividad no existe.");
	}
	return snapshot.val() as ExternalMeetingRecord;
};

const assertTrainingMeetingWithSurvey = (meeting: ExternalMeetingRecord, surveyId: string): void => {
	if (meeting.type !== "training") {
		throw new HttpsError("failed-precondition", "La actividad no es de tipo capacitación.");
	}
	if (meeting.satisfactionSurveyId !== surveyId) {
		throw new HttpsError("failed-precondition", "La encuesta no corresponde a esta capacitación.");
	}
};

const normalizeSurveyAnswers = (
	answers: Record<string, string | number | readonly string[] | null | undefined>,
): Record<string, string | number | string[]> => {
	const normalizedAnswers: Record<string, string | number | string[]> = {};

	for (const [questionId, answer] of Object.entries(answers)) {
		if (answer === null || typeof answer === "undefined") {
			continue;
		}
		if (typeof answer === "string") {
			const clean = answer.trim();
			if (clean.length > 0) {
				normalizedAnswers[questionId] = clean;
			}
			continue;
		}
		if (typeof answer === "number") {
			normalizedAnswers[questionId] = answer;
			continue;
		}
		if (Array.isArray(answer)) {
			const cleanArray = answer
				.filter((item): item is string => typeof item === "string")
				.map((item) => item.trim())
				.filter((item) => item.length > 0);
			if (cleanArray.length > 0) {
				normalizedAnswers[questionId] = cleanArray;
			}
		}
	}

	return normalizedAnswers;
};

export const upsertRoleAcrossDatabases = onCall<RoleUpsertRequest>(
	async (request): Promise<StoredRoleDefinition> => {
		if (!request.auth?.uid) {
			throw new HttpsError("unauthenticated", "Debes iniciar sesion para actualizar roles.");
		}

		const hasPermission = await hasRolesManagePermission(request.auth.uid);
		if (!hasPermission) {
			throw new HttpsError("permission-denied", "No tienes permisos para administrar roles.");
		}

		const role = request.data?.role;
		if (!role || typeof role.id !== "string" || role.id.trim().length === 0) {
			throw new HttpsError("invalid-argument", "El rol es invalido o incompleto.");
		}

		const displayName = role.displayName?.trim();
		if (!displayName) {
			throw new HttpsError("invalid-argument", "El rol requiere un nombre visible.");
		}

		const targetUrls = role.scope === "global" || role.system
			? listDatabaseUrls()
			: [resolveDatabaseUrlByRecinto(role.sourceRecinto)].filter((url): url is string => typeof url === "string" && url.length > 0);

		if (targetUrls.length === 0) {
			throw new HttpsError("failed-precondition", "No se pudo resolver la base de datos destino.");
		}

		const nowIso = new Date().toISOString();
		let primaryRole: StoredRoleDefinition | null = null;

		for (const [index, databaseUrl] of targetUrls.entries()) {
			const db = admin.app().database(databaseUrl);
			const roleRef = db.ref(`roles/${role.id}`);
			const existingSnapshot = await roleRef.get();
			const existingRole = existingSnapshot.val() as StoredRoleDefinition | null;
			const nextRole: StoredRoleDefinition = {
				...role,
				name: role.name.trim() || displayName,
				displayName,
				syncKey: resolveSyncKey(role),
				createdAt: existingRole?.createdAt ?? role.createdAt ?? nowIso,
				updatedAt: nowIso,
				permissions: { ...role.permissions },
				version: AUTHORIZATION_VERSION,
			};
			await roleRef.set(nextRole);
			if (index === 0) {
				primaryRole = nextRole;
			}
		}

		if (!primaryRole) {
			throw new HttpsError("internal", "No fue posible persistir el rol.");
		}

		return primaryRole;
	},
);

export const updateAttendanceAcrossDatabases = onCall<AttendanceUpdateRequest>(
	async (request): Promise<{ ok: true }> => {
		if (!request.auth?.uid) {
			throw new HttpsError("unauthenticated", "Debes iniciar sesion para actualizar asistencia.");
		}

		const meetingId = request.data?.meetingId;
		const participantUid = request.data?.participantUid;
		const meetingDatabaseUrl = request.data?.meetingDatabaseUrl;
		const userDatabaseUrl = request.data?.userDatabaseUrl ?? null;
		const changes = request.data?.changes;

		if (!meetingId || typeof meetingId !== "string") {
			throw new HttpsError("invalid-argument", "meetingId es requerido.");
		}
		if (!participantUid || typeof participantUid !== "string") {
			throw new HttpsError("invalid-argument", "participantUid es requerido.");
		}
		if (!meetingDatabaseUrl || typeof meetingDatabaseUrl !== "string") {
			throw new HttpsError("invalid-argument", "meetingDatabaseUrl es requerido.");
		}
		if (!changes || typeof changes !== "object") {
			throw new HttpsError("invalid-argument", "changes es requerido.");
		}

		const authUid = request.auth.uid;
		const canSelfUpdate = authUid === participantUid;
		if (!canSelfUpdate) {
			const canManageInMeetingDb = await hasPermissionInDatabase(meetingDatabaseUrl, authUid, "meetings_attendance_view");
			const canManageInUserDb = userDatabaseUrl
				? await hasPermissionInDatabase(userDatabaseUrl, authUid, "meetings_attendance_view")
				: false;
			if (!canManageInMeetingDb && !canManageInUserDb) {
				throw new HttpsError("permission-denied", "No tienes permisos para actualizar asistencia.");
			}
		}

		const meetingDb = admin.app().database(meetingDatabaseUrl);
		const meetingRef = meetingDb.ref(`meetings/${meetingId}`);
		const meetingSnap = await meetingRef.get();
		if (!meetingSnap.exists()) {
			throw new HttpsError("not-found", "La actividad no existe.");
		}
		const meeting = meetingSnap.val() as StoredMeetingRecord & Record<string, unknown>;

		const participantRef = meetingDb.ref(`meetingParticipants/${meetingId}/${participantUid}`);
		const participantSnap = await participantRef.get();
		if (!participantSnap.exists()) {
			throw new HttpsError("not-found", "El participante no existe en esta actividad.");
		}
		const participant = participantSnap.val() as StoredParticipantRecord & Record<string, unknown>;

		const updates: Record<string, unknown> = {};
		if (typeof changes.attendance !== "undefined") {
			updates[`meetingParticipants/${meetingId}/${participantUid}/attendance`] = changes.attendance;
			updates[`userMeetings/${participantUid}/${meetingId}/attendance`] = changes.attendance;
		}
		if (typeof changes.checkedInAt !== "undefined") {
			updates[`meetingParticipants/${meetingId}/${participantUid}/checkedInAt`] = changes.checkedInAt;
		}
		if (typeof changes.checkinMethod !== "undefined") {
			updates[`meetingParticipants/${meetingId}/${participantUid}/checkinMethod`] = changes.checkinMethod;
		}
		if (typeof changes.noShow !== "undefined") {
			updates[`meetingParticipants/${meetingId}/${participantUid}/noShow`] = changes.noShow;
		}

		if (Object.keys(updates).length > 0) {
			await meetingDb.ref().update(updates);
		}

		if (userDatabaseUrl && userDatabaseUrl !== meetingDatabaseUrl) {
			const userDb = admin.app().database(userDatabaseUrl);
			const userMeetingRef = userDb.ref(`meetings/${meetingId}`);
			const userMeetingSnap = await userMeetingRef.get();
			if (!userMeetingSnap.exists()) {
				await userMeetingRef.set(meeting);
			}

			const userUpdates: Record<string, unknown> = {};
			userUpdates[`meetingParticipants/${meetingId}/${participantUid}`] = {
				...participant,
				attendance: typeof changes.attendance !== "undefined" ? changes.attendance : participant.attendance ?? null,
				checkedInAt: typeof changes.checkedInAt !== "undefined" ? changes.checkedInAt : participant.checkedInAt ?? null,
				checkinMethod: typeof changes.checkinMethod !== "undefined" ? changes.checkinMethod : participant.checkinMethod ?? null,
				noShow: typeof changes.noShow !== "undefined" ? changes.noShow : participant.noShow ?? null,
			};
			userUpdates[`userMeetings/${participantUid}/${meetingId}`] = {
				meetingId,
				startTime: meeting.startTime ?? null,
				status: meeting.status ?? null,
				role: participant.role ?? null,
				inviteStatus: participant.inviteStatus ?? null,
				attendance: typeof changes.attendance !== "undefined" ? changes.attendance : participant.attendance ?? null,
			};

			await userDb.ref().update(userUpdates);
		}

		return { ok: true };
	},
);

export const registerExternalCheckin = onCall<RegisterExternalCheckinRequest>(
	async (request): Promise<RegisterExternalCheckinResponse> => {
		const meetingId = normalizeRequiredString(request.data?.meetingId);
		const meetingDatabaseUrl = resolveKnownDatabaseUrlOrThrow(request.data?.meetingDatabaseUrl);
		const externalParticipant = request.data?.externalParticipant;

		if (!meetingId) {
			throw new HttpsError("invalid-argument", "meetingId es requerido.");
		}

		if (!externalParticipant || typeof externalParticipant !== "object") {
			throw new HttpsError("invalid-argument", "externalParticipant es requerido.");
		}

		const name = normalizeRequiredString(externalParticipant.name);
		const companyName = normalizeRequiredString(externalParticipant.companyName);
		const email = normalizeIdentity(externalParticipant.email ?? null);
		const documentId = normalizeIdentity(externalParticipant.documentId ?? null);
		const signatureDataUrl = normalizeRequiredString(externalParticipant.signatureDataUrl);

		if (!name) {
			throw new HttpsError("invalid-argument", "El nombre es obligatorio.");
		}
		if (!companyName) {
			throw new HttpsError("invalid-argument", "La empresa es obligatoria.");
		}
		if (!email && !documentId) {
			throw new HttpsError("invalid-argument", "Debes enviar correo o identificación.");
		}
		if (!signatureDataUrl || !signatureDataUrl.startsWith("data:image/")) {
			throw new HttpsError("invalid-argument", "La firma es obligatoria y debe ser una imagen válida.");
		}

		const db = admin.app().database(meetingDatabaseUrl);
		const meeting = await loadMeetingOrThrow(db, meetingId);
		if (meeting.status !== "scheduled") {
			throw new HttpsError("failed-precondition", "La actividad no permite nuevos check-ins.");
		}
		if (typeof meeting.startTime !== "number") {
			throw new HttpsError("failed-precondition", "La actividad no tiene hora de inicio válida.");
		}

		const identityPieces = [documentId ?? "", email ?? "", name.toLowerCase()];
		const dedupeKey = sanitizeKey(identityPieces.join("|"));
		const dedupeRef = db.ref(`meetingExternalParticipantsIndex/${meetingId}/${dedupeKey}`);
		const candidateRef = db.ref(`meetingExternalParticipants/${meetingId}`).push();
		if (!candidateRef.key) {
			throw new HttpsError("internal", "No fue posible generar un identificador para el externo.");
		}
		const candidateExternalId = candidateRef.key;

		const dedupeTransaction = await dedupeRef.transaction((currentValue) => {
			if (typeof currentValue === "string" && currentValue.trim().length > 0) {
				return currentValue;
			}
			return candidateExternalId;
		}, undefined, false);

		const dedupeResolvedValue = dedupeTransaction.snapshot.val();
		if (typeof dedupeResolvedValue !== "string" || dedupeResolvedValue.trim().length === 0) {
			throw new HttpsError("internal", "No fue posible resolver el identificador del externo.");
		}

		const now = Date.now();
		const attendance = computeExternalAttendance(meeting.startTime, now);
		const checkinMethod = externalParticipant.checkinMethod ?? "qr";

		const externalId = dedupeResolvedValue;
		const alreadyRegistered = externalId !== candidateExternalId;

		const participantRecord: ExternalParticipantRecord = {
			id: externalId,
			name,
			companyName,
			email: email ?? null,
			documentId: documentId ?? null,
			signatureDataUrl,
			attendance,
			checkedInAt: now,
			checkinMethod,
			createdAt: now,
			updatedAt: now,
			noShow: false,
			source: "external",
		};

		const participantRef = db.ref(`meetingExternalParticipants/${meetingId}/${externalId}`);
		const existingParticipantSnapshot = await participantRef.get();
		const existingParticipant = existingParticipantSnapshot.val() as ExternalParticipantRecord | null;

		await participantRef.set({
			...participantRecord,
			createdAt: existingParticipant?.createdAt ?? now,
		});

		const surveyId = meeting.type === "training"
			? (typeof meeting.satisfactionSurveyId === "string" && meeting.satisfactionSurveyId.trim().length > 0
				? meeting.satisfactionSurveyId.trim()
				: null)
			: null;

		return {
			externalId,
			attendance,
			checkedInAt: now,
			alreadyRegistered,
			surveyId,
		};
	},
);

export const getExternalSurveyForCheckin = onCall<GetExternalSurveyForCheckinRequest>(
	async (request): Promise<{ survey: ExternalSurveyPayload; questions: ExternalSurveyQuestion[]; options: ExternalSurveyOption[] }> => {
		const surveyId = normalizeRequiredString(request.data?.surveyId);
		const trainingId = normalizeRequiredString(request.data?.trainingId);
		const meetingDatabaseUrl = resolveKnownDatabaseUrlOrThrow(request.data?.meetingDatabaseUrl);
		const externalId = normalizeRequiredString(request.data?.externalId);

		if (!surveyId || !trainingId || !meetingDatabaseUrl || !externalId) {
			throw new HttpsError("invalid-argument", "surveyId, trainingId, meetingDatabaseUrl y externalId son requeridos.");
		}

		const db = admin.app().database(meetingDatabaseUrl);
		const [meetingSnapshot, externalSnapshot, surveySnapshot] = await Promise.all([
			db.ref(`meetings/${trainingId}`).get(),
			db.ref(`meetingExternalParticipants/${trainingId}/${externalId}`).get(),
			db.ref(`surveys/${surveyId}`).get(),
		]);

		if (!meetingSnapshot.exists()) {
			throw new HttpsError("not-found", "La capacitación no existe.");
		}
		if (!externalSnapshot.exists()) {
			throw new HttpsError("permission-denied", "No existe registro de check-in externo para esta capacitación.");
		}
		if (!surveySnapshot.exists()) {
			throw new HttpsError("not-found", "La encuesta no existe.");
		}

		const meeting = meetingSnapshot.val() as ExternalMeetingRecord;
		assertTrainingMeetingWithSurvey(meeting, surveyId);

		const survey = surveySnapshot.val() as ExternalSurveyPayload;
		if (!survey.isActive) {
			throw new HttpsError("failed-precondition", "La encuesta no está activa.");
		}

		const questionsRootSnapshot = await db.ref("surveyQuestions").get();
		const rawQuestions = questionsRootSnapshot.val() as Record<string, Omit<ExternalSurveyQuestion, "id">> | null;
		const questions: ExternalSurveyQuestion[] = Object.entries(rawQuestions ?? {})
			.filter(([, question]) => question.surveyId === surveyId)
			.map(([id, question]) => ({ ...question, id }))
			.sort((left, right) => left.order - right.order);

		const questionIds = new Set(questions.map((question) => question.id));
		const optionsRootSnapshot = await db.ref("surveyOptions").get();
		const rawOptions = optionsRootSnapshot.val() as Record<string, Omit<ExternalSurveyOption, "id">> | null;
		const options: ExternalSurveyOption[] = Object.entries(rawOptions ?? {})
			.filter(([, option]) => questionIds.has(option.questionId))
			.map(([id, option]) => ({ ...option, id }))
			.sort((left, right) => left.order - right.order);

		return {
			survey,
			questions,
			options,
		};
	},
);

export const submitExternalSurveyResponse = onCall<SubmitExternalSurveyResponseRequest>(
	async (request): Promise<{ ok: true }> => {
		const surveyId = normalizeRequiredString(request.data?.surveyId);
		const trainingId = normalizeRequiredString(request.data?.trainingId);
		const meetingDatabaseUrl = resolveKnownDatabaseUrlOrThrow(request.data?.meetingDatabaseUrl);
		const externalId = normalizeRequiredString(request.data?.externalId);
		const answers = request.data?.answers;

		if (!surveyId || !trainingId || !meetingDatabaseUrl || !externalId) {
			throw new HttpsError("invalid-argument", "surveyId, trainingId, meetingDatabaseUrl y externalId son requeridos.");
		}
		if (!answers || typeof answers !== "object") {
			throw new HttpsError("invalid-argument", "answers es requerido.");
		}

		const db = admin.app().database(meetingDatabaseUrl);
		const [meetingSnapshot, externalSnapshot] = await Promise.all([
			db.ref(`meetings/${trainingId}`).get(),
			db.ref(`meetingExternalParticipants/${trainingId}/${externalId}`).get(),
		]);

		if (!meetingSnapshot.exists()) {
			throw new HttpsError("not-found", "La capacitación no existe.");
		}
		if (!externalSnapshot.exists()) {
			throw new HttpsError("permission-denied", "No existe registro de check-in externo para esta capacitación.");
		}

		const meeting = meetingSnapshot.val() as ExternalMeetingRecord;
		assertTrainingMeetingWithSurvey(meeting, surveyId);

		const external = externalSnapshot.val() as ExternalParticipantRecord;
		if (external.attendance !== "present" && external.attendance !== "late") {
			throw new HttpsError("failed-precondition", "Solo externos con asistencia válida pueden responder la encuesta.");
		}

		const responseId = `ext_${externalId}`;
		const responseRef = db.ref(`surveyResponses/${surveyId}/${trainingId}/${responseId}`);
		const existingResponse = await responseRef.get();
		if (existingResponse.exists()) {
			throw new HttpsError("already-exists", "Esta encuesta externa ya fue respondida.");
		}

		const normalizedAnswers = normalizeSurveyAnswers(answers);

		const questionsSnapshot = await db.ref("surveyQuestions").get();
		const rawQuestions = questionsSnapshot.val() as Record<string, Omit<ExternalSurveyQuestion, "id">> | null;
		const requiredQuestionIds = Object.entries(rawQuestions ?? {})
			.filter(([, question]) => question.surveyId === surveyId && question.required === true)
			.map(([questionId]) => questionId);

		const missingRequired = requiredQuestionIds.filter((questionId) => {
			const value = normalizedAnswers[questionId];
			if (typeof value === "undefined") {
				return true;
			}
			if (typeof value === "string") {
				return value.trim().length === 0;
			}
			if (Array.isArray(value)) {
				return value.length === 0;
			}
			return false;
		});

		if (missingRequired.length > 0) {
			throw new HttpsError("invalid-argument", "Faltan respuestas obligatorias de la encuesta.");
		}

		const nowIso = new Date().toISOString();
		await responseRef.set({
			id: responseId,
			surveyId,
			trainingId,
			userId: responseId,
			userName: external.name,
			userEmail: external.email,
			createdAt: nowIso,
			answers: normalizedAnswers,
			respondentType: "external",
			externalId,
			companyName: external.companyName,
			documentId: external.documentId,
		});

		return { ok: true };
	},
);

interface CreateTeamsMeetingRequest {
	readonly organizerEmail?: string | null;
	readonly subject: string;
	readonly bodyHtml?: string;
	readonly startTime: number;
	readonly endTime: number;
	readonly timeZone: string;
	readonly location?: string;
	readonly attendees: readonly MeetingAttendeeRequest[];
	readonly isOnlineMeeting?: boolean;
}

interface MeetingAttendeeRequest {
	readonly email: string;
	readonly name?: string;
	readonly type?: "required" | "optional";
}

interface CreateTeamsMeetingResponse {
	readonly eventId: string;
	readonly joinUrl?: string;
	readonly subject?: string;
}

interface UpdateTeamsMeetingRequest {
	readonly eventId: string;
	readonly organizerEmail?: string | null;
	readonly subject: string;
	readonly bodyHtml?: string;
	readonly startTime: number;
	readonly endTime: number;
	readonly timeZone: string;
	readonly location?: string;
	readonly attendees: readonly MeetingAttendeeRequest[];
	readonly isOnlineMeeting?: boolean;
}

interface UpdateTeamsMeetingResponse {
	readonly eventId: string;
	readonly joinUrl?: string;
	readonly subject?: string;
}

function formatDateTimeForTimeZone(epochMs: number, timeZone: string): string {
	const date = new Date(epochMs);
	const formatter = new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
		timeZone,
	});

	const parts = formatter.formatToParts(date);
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";

	const year = get("year");
	const month = get("month");
	const day = get("day");
	const hour = get("hour");
	const minute = get("minute");
	const second = get("second");

	return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export const createTeamsMeeting = onCall<CreateTeamsMeetingRequest>(
	async (request): Promise<CreateTeamsMeetingResponse> => {
		try {
			const data = request.data;

			if (!data.subject || typeof data.subject !== "string") {
				throw new HttpsError("invalid-argument", "El asunto de la reunión es obligatorio.");
			}
			if (typeof data.startTime !== "number" || typeof data.endTime !== "number") {
				throw new HttpsError(
					"invalid-argument",
					"Las fechas de inicio y fin deben ser numéricas (epoch ms).",
				);
			}
			if (data.startTime >= data.endTime) {
				throw new HttpsError("invalid-argument", "La hora de inicio debe ser menor que la de fin.");
			}
			if (!data.timeZone || typeof data.timeZone !== "string") {
				throw new HttpsError("invalid-argument", "La zona horaria es obligatoria.");
			}
			if (!Array.isArray(data.attendees)) {
				throw new HttpsError("invalid-argument", "La lista de asistentes debe ser un arreglo.");
			}

			const sanitizedAttendees: MeetingAttendee[] = data.attendees
				.filter((attendee) => Boolean(attendee.email))
				.map((attendee) => ({
					email: attendee.email,
					name: attendee.name,
					type: attendee.type ?? "required",
				}));

			const graph = new Graph();
			const options: CreateTeamsMeetingOptions = {
				organizerEmail: data.organizerEmail ?? null,
				subject: data.subject,
				bodyHtml: data.bodyHtml ?? "",
				startDateTime: formatDateTimeForTimeZone(data.startTime, data.timeZone),
				endDateTime: formatDateTimeForTimeZone(data.endTime, data.timeZone),
				timeZone: data.timeZone,
				attendees: sanitizedAttendees,
				...(data.isOnlineMeeting ? { isOnlineMeeting: true } : {location: data.location,}), // controlamos si es una reunion presencial o online
			};

			const event: GraphEvent = await graph.createTeamsMeeting(options);

			return {
				eventId: event.id,
				joinUrl: event.onlineMeeting?.joinUrl,
				subject: event.subject,
			};
		} catch (error) {
			console.error("Error en createTeamsMeeting:", error);
			if (error instanceof HttpsError) {
				throw error;
			}
			throw new HttpsError("internal", "Error al crear la reunión en Teams");
		}
	},
);

export const updateTeamsMeeting = onCall<UpdateTeamsMeetingRequest>(
	async (request): Promise<UpdateTeamsMeetingResponse> => {
		try {
			const data = request.data;

			if (!data.eventId || typeof data.eventId !== "string") {
				throw new HttpsError("invalid-argument", "El eventId es obligatorio.");
			}
			if (!data.subject || typeof data.subject !== "string") {
				throw new HttpsError("invalid-argument", "El asunto de la reunión es obligatorio.");
			}
			if (typeof data.startTime !== "number" || typeof data.endTime !== "number") {
				throw new HttpsError(
					"invalid-argument",
					"Las fechas de inicio y fin deben ser numéricas (epoch ms).",
				);
			}
			if (data.startTime >= data.endTime) {
				throw new HttpsError("invalid-argument", "La hora de inicio debe ser menor que la de fin.");
			}
			if (!data.timeZone || typeof data.timeZone !== "string") {
				throw new HttpsError("invalid-argument", "La zona horaria es obligatoria.");
			}
			if (!Array.isArray(data.attendees)) {
				throw new HttpsError("invalid-argument", "La lista de asistentes debe ser un arreglo.");
			}

			const sanitizedAttendees: MeetingAttendee[] = data.attendees
				.filter((attendee) => Boolean(attendee.email))
				.map((attendee) => ({
					email: attendee.email,
					name: attendee.name,
					type: attendee.type ?? "required",
				}));

			const graph = new Graph();
			const options: UpdateTeamsMeetingOptions = {
				eventId: data.eventId,
				organizerEmail: data.organizerEmail ?? null,
				subject: data.subject,
				bodyHtml: data.bodyHtml ?? "",
				startDateTime: formatDateTimeForTimeZone(data.startTime, data.timeZone),
				endDateTime: formatDateTimeForTimeZone(data.endTime, data.timeZone),
				timeZone: data.timeZone,
				attendees: sanitizedAttendees,
				...(data.isOnlineMeeting ? { isOnlineMeeting: true } : { location: data.location }),
			};

			const event: GraphEvent = await graph.updateTeamsMeeting(options);

			return {
				eventId: event.id,
				joinUrl: event.onlineMeeting?.joinUrl,
				subject: event.subject,
			};
		} catch (error) {
			console.error("Error en updateTeamsMeeting:", error);
			if (error instanceof HttpsError) {
				throw error;
			}
			throw new HttpsError("internal", "Error al actualizar la reunión en Teams");
		}
	},
);

interface CertificateMeeting {
	readonly id: string;
	readonly title: string;
	readonly type: string;
	readonly location: string;
	readonly startTime: number;
	readonly endTime: number;
}

interface CertificateParticipant {
	readonly uid: string;
	readonly name: string;
	readonly email: string;
	readonly cargo?: string | null;
	readonly attendance?: string | null;
	readonly noShow?: boolean | null;
}

interface CertificateUserProfile {
	readonly cargo?: string | null;
}

interface CertificateTextLayout {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly color: string;
	readonly maxFontSize: number;
	readonly minFontSize: number;
	readonly maxLines?: number;
}

let certificateTemplateCache: Buffer | null = null;
const CERTIFICATE_TEXT_COLOR = "#9fb4ac";

function loadCertificateTemplate(): Buffer {
	if (certificateTemplateCache) {
		return certificateTemplateCache;
	}

	const candidatePaths = [
		path.resolve(__dirname, "../src/assets/certificate-template.png"),
		path.resolve(process.cwd(), "src/assets/certificate-template.png"),
	];

	for (const templatePath of candidatePaths) {
		if (fs.existsSync(templatePath)) {
			certificateTemplateCache = fs.readFileSync(templatePath);
			return certificateTemplateCache;
		}
	}

	throw new Error("No fue posible encontrar la plantilla del certificado (certificate-template.png)");
}

function formatDate(epochMs: number): string {
	const date = new Date(epochMs);
	return date.toLocaleDateString("es-CO", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	});
}

function drawCenteredFittedText(
	document: PDFKit.PDFDocument,
	text: string,
	layout: CertificateTextLayout,
): void {
	const normalizedText = text.trim();
	let fontSize = layout.maxFontSize;
	const maxLines = layout.maxLines ?? 1;
	const lineGap = 0;

	document.font("Helvetica");

	while (fontSize > layout.minFontSize) {
		document.fontSize(fontSize);

		if (maxLines <= 1) {
			const textWidth = document.widthOfString(normalizedText);
			if (textWidth <= layout.width) {
				break;
			}
			fontSize -= 1;
			continue;
		}

		const measuredHeight = document.heightOfString(normalizedText, {
			width: layout.width,
			align: "center",
			lineGap,
		});
		const maxAllowedHeight = layout.height;
		if (measuredHeight <= maxAllowedHeight) {
			break;
		}
		fontSize -= 1;
	}

	document.fontSize(fontSize);
	const measuredHeight = document.heightOfString(normalizedText, {
		width: layout.width,
		align: "center",
		lineGap,
	});
	const verticalOffset = Math.max(0, (layout.height - measuredHeight) / 2);

	document
		.fillColor(layout.color)
		.fontSize(fontSize)
		.text(normalizedText, layout.x, layout.y + verticalOffset, {
			width: layout.width,
			height: layout.height,
			align: "center",
			lineGap,
			lineBreak: maxLines > 1,
			ellipsis: maxLines > 1,
		});
}

async function buildCertificatePdf(meeting: CertificateMeeting, participant: CertificateParticipant): Promise<Buffer> {
	return await new Promise<Buffer>((resolve, reject) => {
		const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
		const chunks: Buffer[] = [];

		document.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});

		document.on("end", () => {
			resolve(Buffer.concat(chunks));
		});

		document.on("error", (error: Error) => {
			reject(error);
		});

		const pageWidth = document.page.width;
		const pageHeight = document.page.height;
		const templateBuffer = loadCertificateTemplate();

		document.image(templateBuffer, 0, 0, {
			width: pageWidth,
			height: pageHeight,
		});

		const participantName = participant.name?.trim() || "Colaborador";
		const participantRole = participant.cargo?.trim() || "Cargo";
		const courseName = meeting.title?.trim() || "Capacitación";
		const meetingDate = formatDate(meeting.startTime);

		drawCenteredFittedText(document, participantName, {
			x: 120,
			y: 217,
			width: 602,
			height: 82,
			color: CERTIFICATE_TEXT_COLOR,
			maxFontSize: 34,
			minFontSize: 22,
			maxLines: 2,
		});

		drawCenteredFittedText(document, participantRole, {
			x: 250,
			y: 303,
			width: 342,
			height: 34,
			color: CERTIFICATE_TEXT_COLOR,
			maxFontSize: 20,
			minFontSize: 16,
		});

		drawCenteredFittedText(document, courseName, {
			x: 150,
			y: 399,
			width: 542,
			height: 40,
			color: CERTIFICATE_TEXT_COLOR,
			maxFontSize: 24,
			minFontSize: 18,
		});

		drawCenteredFittedText(document, meetingDate, {
			x: 275,
			y: 455,
			width: 292,
			height: 34,
			color: CERTIFICATE_TEXT_COLOR,
			maxFontSize: 18,
			minFontSize: 16,
		});

		document.end();
	});
}

export const onTrainingCompletedSendCertificates = onValueUpdated(
	"/meetings/{meetingId}/status",
	async (event): Promise<void> => {
		const beforeStatus = event.data.before.val() as string | null;
		const afterStatus = event.data.after.val() as string | null;

		if (beforeStatus === afterStatus) {
			return;
		}

		if (afterStatus !== "completed") {
			return;
		}

		const meetingId = event.params.meetingId;
		const database = admin.database();

		const meetingSnap = await database.ref(`meetings/${meetingId}`).get();
		if (!meetingSnap.exists()) {
			return;
		}

		const meetingValue = meetingSnap.val() as Partial<CertificateMeeting>;
		if (meetingValue.type !== "training") {
			return;
		}

		const meeting: CertificateMeeting = {
			id: meetingId,
			title: meetingValue.title ?? "Capacitación",
			type: meetingValue.type,
			location: meetingValue.location ?? "",
			startTime: meetingValue.startTime ?? 0,
			endTime: meetingValue.endTime ?? 0,
		};

		const participantsSnap = await database.ref(`meetingParticipants/${meetingId}`).get();
		if (!participantsSnap.exists()) {
			return;
		}

		const participantsMap = participantsSnap.val() as Record<string, CertificateParticipant> | null;
		if (!participantsMap) {
			return;
		}

		const participants = Object.values(participantsMap).filter((participant) => {
			if (!participant.email) {
				return false;
			}
			const attendance = participant.attendance ?? null;
			if (participant.noShow) {
				return false;
			}
			return attendance === "present" || attendance === "late";
		});

		if (participants.length === 0) {
			return;
		}

		const usersSnap = await database.ref("users").get();
		const usersMap = usersSnap.val() as Record<string, CertificateUserProfile> | null;

		const graph = new Graph();

		await Promise.all(
			participants.map(async (participant) => {
				try {
					const participantProfile = usersMap?.[participant.uid] ?? null;
					const participantWithCargo: CertificateParticipant = {
						...participant,
						cargo: participant.cargo ?? participantProfile?.cargo ?? null,
					};

					const pdfBuffer = await buildCertificatePdf(meeting, participantWithCargo);

					const attachmentName = `Certificado-${participant.name.replace(/\s+/g, "-")}.pdf`;
					const attachmentBase64 = pdfBuffer.toString("base64");

					const subject = `Certificado de asistencia - ${meeting.title}`;
					const htmlBody = `
						<p>Hola ${participant.name},</p>
						<p>
							Adjuntamos tu certificado de asistencia a la capacitación
							<strong>${meeting.title}</strong>.
						</p>
						<p>Muchas gracias por tu participación.</p>
					`;

					await graph.sendMailWithAttachment({
						to: [
							{
								email: participant.email,
								name: participant.name,
							},
						],
						subject,
						htmlBody,
						attachments: [
							{
								name: attachmentName,
								contentType: "application/pdf",
								contentBytes: attachmentBase64,
							},
						],
					});
				} catch (error) {
					console.error(
						`No fue posible enviar el certificado de asistencia para el participante ${participant.uid} en la reunión ${meetingId}:`,
						error,
					);
				}
			}),
		);
	},
);

