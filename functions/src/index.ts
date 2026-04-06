import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Graph, type CreateTeamsMeetingOptions, type GraphEvent, type MeetingAttendee } from "./graph";

interface CreateTeamsMeetingRequest {
	readonly organizerEmail?: string | null;
	readonly subject: string;
	readonly bodyHtml?: string;
	readonly startTime: number;
	readonly endTime: number;
	readonly timeZone: string;
	readonly attendees: readonly MeetingAttendeeRequest[];
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

