import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onValueUpdated } from "firebase-functions/v2/database";
import * as admin from "firebase-admin";
import * as fs from "node:fs";
import * as path from "node:path";
import PDFDocument from "pdfkit";
import { Graph, type CreateTeamsMeetingOptions, type GraphEvent, type MeetingAttendee } from "./graph";
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

const resolveDatabaseUrlByRecinto = (recinto?: RecintoKey): string | null => {
	if (!recinto) {
		return null;
	}
	const map = getDatabaseUrlMap();
	return map[recinto] ?? null;
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

