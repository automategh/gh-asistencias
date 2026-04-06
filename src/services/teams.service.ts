import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export interface TeamsMeetingAttendeeInput {
  readonly email: string;
  readonly name?: string;
  readonly type?: "required" | "optional";
}

export interface CreateTeamsMeetingPayload {
  readonly organizerEmail?: string | null;
  readonly subject: string;
  readonly bodyHtml?: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly timeZone: string;
  readonly attendees: readonly TeamsMeetingAttendeeInput[];
}

export interface CreateTeamsMeetingResult {
  readonly eventId: string;
  readonly joinUrl?: string;
  readonly subject?: string;
}

export async function createTeamsMeetingViaCloudFunction(
  payload: CreateTeamsMeetingPayload,
): Promise<CreateTeamsMeetingResult> {
  if (!functions) {
    throw new Error("Cloud Functions no está disponible en este entorno de Firebase.");
  }

  const callable = httpsCallable<CreateTeamsMeetingPayload, CreateTeamsMeetingResult>(
    functions,
    "createTeamsMeeting",
  );

  const result = await callable(payload);
  return result.data;
}
