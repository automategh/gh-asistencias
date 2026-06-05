import { ConfidentialClientApplication, type ClientCredentialRequest } from "@azure/msal-node";
import { getAzureConfig } from "./config";

/**
 * Clase para interactuar con Microsoft Graph API usando autenticación de aplicación (app-only).
 * Internamente maneja el token de acceso y su renovación automática antes de que expire.
 */
export class Graph {
    private readonly app: ConfidentialClientApplication;
    private readonly defaultOrganizerEmail?: string;
    private tokenCache: { token: string; expiresOn: number } | null = null;

    constructor() {
        const { tenantId, clientId, clientSecret, defaultOrganizerEmail } = getAzureConfig();
        this.defaultOrganizerEmail = defaultOrganizerEmail ?? undefined;

        this.app = new ConfidentialClientApplication({
            auth: {
                authority: `https://login.microsoftonline.com/${tenantId}`,
                clientId,
                clientSecret,
            },
        });
    }

    /**
     * Obtiene un token de acceso para Microsoft Graph API.
     * Si el token actual está cerca de expirar, se renueva automáticamente.
     * Aplica un margen de seguridad de 5 minutos para evitar usar un token que esté a punto de expirar.
     * @returns Token de acceso para Microsoft Graph.
     */
    private async getToken(): Promise<string> {
        const now = Date.now();
        if (this.tokenCache && this.tokenCache.expiresOn > now + 60_000) {
            return this.tokenCache.token;
        }
        const request: ClientCredentialRequest = {
            scopes: ["https://graph.microsoft.com/.default"],
        };
        const response = await this.app.acquireTokenByClientCredential(request);
        if (!response || !response.accessToken || !response.expiresOn) {
            throw new Error("No se pudo obtener el token de acceso de Microsoft Graph");
        }
        // usa expiresOn (Date) y resta 5 minutos para tener un margen de seguridad
        const expiresOnMs = response.expiresOn ? response.expiresOn.getTime() : now + 3_600_000; // fallback a 1 hora
        const expiresAt = Math.max(now, expiresOnMs - 300_000); // 5 minutos antes de la expiración real
        this.tokenCache = { token: response.accessToken, expiresOn: expiresAt };
        return response.accessToken;
    }

    /**
     * Envía un correo electrónico usando Microsoft Graph con adjuntos opcionales.
     * Por defecto utiliza el correo de automatización configurado como remitente.
     */
    public async sendMailWithAttachment(options: SendMailWithAttachmentOptions): Promise<void> {
        const token = await this.getToken();

        const senderFromOptions = options.senderEmail?.trim();
        const sender = senderFromOptions || this.defaultOrganizerEmail;

        if (!sender) {
            throw new Error(
                "No se pudo determinar el remitente para el correo. Proporcione senderEmail o configure AZURE_DEFAULT_ORGANIZER_EMAIL.",
            );
        }

        const toRecipients = options.to.map((recipient) => ({
            emailAddress: {
                address: recipient.email,
                name: recipient.name ?? recipient.email,
            },
        }));

        const attachments = (options.attachments ?? []).map((attachment) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.name,
            contentType: attachment.contentType,
            contentBytes: attachment.contentBytes,
        }));

        const payload = {
            message: {
                subject: options.subject,
                body: {
                    contentType: "HTML" as const,
                    content: options.htmlBody,
                },
                toRecipients,
                attachments,
            },
            saveToSentItems: false,
        };

        const response = await fetch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            },
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error al enviar correo con Graph: ${response.status} ${errorText}`);
        }
    }

    /**
     * Crea una reunión de Teams en el calendario de un organizador.
     * El organizador puede ser dinámico (correo dentro del tenant) y, si falla
     * o es externo, se usa el organizador por defecto configurado en AZURE_DEFAULT_ORGANIZER_EMAIL.
     */
    public async createTeamsMeeting(options: CreateTeamsMeetingOptions): Promise<GraphEvent> {
        const token = await this.getToken();

        const organizerFromOptions = options.organizerEmail?.trim();
        const organizer = organizerFromOptions || this.defaultOrganizerEmail;

        if (!organizer) {
            throw new Error(
                "No se pudo determinar un organizador para la reunión. Proporcione organizerEmail o configure AZURE_DEFAULT_ORGANIZER_EMAIL.",
            );
        }

        const eventPayload: GraphCreateEventRequest = {
            subject: options.subject,
            body: {
                contentType: "HTML",
                content: options.bodyHtml ?? "",
            },
            start: {
                dateTime: options.startDateTime,
                timeZone: options.timeZone,
            },
            end: {
                dateTime: options.endDateTime,
                timeZone: options.timeZone,
            },
            attendees: options.attendees.map((attendee) => ({
                emailAddress: {
                    address: attendee.email,
                    name: attendee.name ?? attendee.email,
                },
                type: attendee.type ?? "required",
            })),
            ...(options.location ? { location: { displayName: options.location } } : {}),
            ...(options.isOnlineMeeting ? {
                isOnlineMeeting: true,
            } : {}),
            onlineMeetingProvider: "teamsForBusiness",
        };

        const createForOrganizer = async (upnOrId: string): Promise<GraphEvent> => {
            const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upnOrId)}/events`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(eventPayload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error al crear el evento en Graph para ${upnOrId}: ${response.status} ${errorText}`);
            }

            const data = (await response.json()) as GraphEvent;
            return data;
        };

        try {
            return await createForOrganizer(organizer);
        } catch (error) {
            if (!organizerFromOptions || !this.defaultOrganizerEmail || organizer === this.defaultOrganizerEmail) {
                throw error;
            }

            return await createForOrganizer(this.defaultOrganizerEmail);
        }
    }

    /**
     * Actualiza una reunión existente en Teams para un organizador específico.
     */
    public async updateTeamsMeeting(options: UpdateTeamsMeetingOptions): Promise<GraphEvent> {
        const token = await this.getToken();

        const organizerFromOptions = options.organizerEmail?.trim();
        const organizer = organizerFromOptions || this.defaultOrganizerEmail;

        if (!organizer) {
            throw new Error(
                "No se pudo determinar un organizador para actualizar la reunión. Proporcione organizerEmail o configure AZURE_DEFAULT_ORGANIZER_EMAIL.",
            );
        }

        const eventPayload: GraphCreateEventRequest = {
            subject: options.subject,
            body: {
                contentType: "HTML",
                content: options.bodyHtml ?? "",
            },
            start: {
                dateTime: options.startDateTime,
                timeZone: options.timeZone,
            },
            end: {
                dateTime: options.endDateTime,
                timeZone: options.timeZone,
            },
            attendees: options.attendees.map((attendee) => ({
                emailAddress: {
                    address: attendee.email,
                    name: attendee.name ?? attendee.email,
                },
                type: attendee.type ?? "required",
            })),
            ...(options.location ? { location: { displayName: options.location } } : {}),
            ...(options.isOnlineMeeting ? {
                isOnlineMeeting: true,
            } : {}),
            onlineMeetingProvider: "teamsForBusiness",
        };

        const response = await fetch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizer)}/events/${encodeURIComponent(options.eventId)}`,
            {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(eventPayload),
            },
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error al actualizar el evento en Graph: ${response.status} ${errorText}`);
        }

        const data = (await response.json()) as GraphEvent;
        return data;
    }

    public async getUserProfileByEmail(email: string): Promise<GraphUserProfile> {
        const token = await this.getToken();
        const normalizedEmail = email.trim();

        if (!normalizedEmail) {
            throw new Error("El correo del usuario es obligatorio para consultar Microsoft Graph.");
        }

        const profileResponse = await fetch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(normalizedEmail)}?$select=jobTitle,department`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );

        if (!profileResponse.ok) {
            const errorText = await profileResponse.text();
            throw new Error(`Error al consultar perfil de usuario en Graph: ${profileResponse.status} ${errorText}`);
        }

        const profileData = (await profileResponse.json()) as {
            readonly jobTitle?: string | null;
            readonly department?: string | null;
        };

        let photoUrl: string | null = null;
        try {
            const photoResponse = await fetch(
                `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(normalizedEmail)}/photo/$value`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                },
            );

            if (photoResponse.ok) {
                const contentType = photoResponse.headers.get("content-type") ?? "image/jpeg";
                const photoBuffer = Buffer.from(await photoResponse.arrayBuffer());
                photoUrl = `data:${contentType};base64,${photoBuffer.toString("base64")}`;
            }
        } catch (error) {
            console.warn(`No se pudo obtener la foto de ${normalizedEmail} desde Graph:`, error);
        }

        return {
            cargo: typeof profileData.jobTitle === "string" && profileData.jobTitle.trim().length > 0
                ? profileData.jobTitle.trim()
                : null,
            department: typeof profileData.department === "string" && profileData.department.trim().length > 0
                ? profileData.department.trim()
                : null,
            photoUrl,
        };
    }

    public async getCurrentUserProfile(accessToken: string): Promise<GraphUserProfile> {
        const normalizedToken = accessToken.trim();

        if (!normalizedToken) {
            throw new Error("El access token del usuario es obligatorio para consultar Microsoft Graph.");
        }

        const profileResponse = await fetch(
            "https://graph.microsoft.com/v1.0/me?$select=jobTitle,department",
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${normalizedToken}`,
                    "Content-Type": "application/json",
                },
            },
        );

        if (!profileResponse.ok) {
            const errorText = await profileResponse.text();
            throw new Error(`Error al consultar perfil del usuario actual en Graph: ${profileResponse.status} ${errorText}`);
        }

        const profileData = (await profileResponse.json()) as {
            readonly jobTitle?: string | null;
            readonly department?: string | null;
        };

        let photoUrl: string | null = null;
        try {
            const photoResponse = await fetch(
                "https://graph.microsoft.com/v1.0/me/photo/$value",
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${normalizedToken}`,
                    },
                },
            );

            if (photoResponse.ok) {
                const contentType = photoResponse.headers.get("content-type") ?? "image/jpeg";
                const photoBuffer = Buffer.from(await photoResponse.arrayBuffer());
                photoUrl = `data:${contentType};base64,${photoBuffer.toString("base64")}`;
            }
        } catch (error) {
            console.warn("No se pudo obtener la foto del usuario actual desde Graph:", error);
        }

        return {
            cargo: typeof profileData.jobTitle === "string" && profileData.jobTitle.trim().length > 0
                ? profileData.jobTitle.trim()
                : null,
            department: typeof profileData.department === "string" && profileData.department.trim().length > 0
                ? profileData.department.trim()
                : null,
            photoUrl,
        };
    }
}

export interface MeetingAttendee {
    readonly email: string;
    readonly name?: string;
    readonly type?: "required" | "optional";
}

export interface CreateTeamsMeetingOptions {
    /**
     * Correo del organizador deseado.
     * Debe pertenecer al tenant para que se use directamente; si falla o es externo,
     * se intentará usar el organizador por defecto configurado en AZURE_DEFAULT_ORGANIZER_EMAIL.
     */
    readonly organizerEmail?: string | null;
    readonly subject: string;
    readonly bodyHtml?: string;
    /**
     * Fecha/hora de inicio en formato ISO 8601 (sin zona horaria embebida),
     * por ejemplo: "2026-04-06T09:00:00".
     */
    readonly startDateTime: string;
    /**
     * Fecha/hora de fin en formato ISO 8601.
     */
    readonly endDateTime: string;
    /**
     * Zona horaria compatible con Graph, por ejemplo "America/Bogota".
     */
    readonly timeZone: string;
    readonly location?: string;
    readonly attendees: readonly MeetingAttendee[];
    readonly isOnlineMeeting?: boolean;
}

export interface UpdateTeamsMeetingOptions {
    /**
     * ID del evento en Graph.
     */
    readonly eventId: string;
    /**
     * Correo del organizador que posee el evento.
     */
    readonly organizerEmail?: string | null;
    readonly subject: string;
    readonly bodyHtml?: string;
    readonly startDateTime: string;
    readonly endDateTime: string;
    readonly timeZone: string;
    readonly location?: string;
    readonly attendees: readonly MeetingAttendee[];
    readonly isOnlineMeeting?: boolean;
}

export interface GraphEvent {
    readonly id: string;
    readonly subject?: string;
    readonly start: {
        readonly dateTime: string;
        readonly timeZone: string;
    };
    readonly end: {
        readonly dateTime: string;
        readonly timeZone: string;
    };
    readonly onlineMeeting?: {
        readonly joinUrl?: string;
    };
    readonly onlineMeetingProvider?: string;
}

export interface GraphUserProfile {
    readonly cargo: string | null;
    readonly department: string | null;
    readonly photoUrl: string | null;
}

interface GraphCreateEventRequest {
    readonly subject: string;
    readonly body: {
        readonly contentType: "HTML" | "Text";
        readonly content: string;
    };
    readonly start: {
        readonly dateTime: string;
        readonly timeZone: string;
    };
    readonly end: {
        readonly dateTime: string;
        readonly timeZone: string;
    };
    readonly attendees: readonly {
        readonly emailAddress: {
            readonly address: string;
            readonly name?: string;
        };
        readonly type: "required" | "optional";
    }[];
    readonly location?: {
        readonly displayName: string;
    };
    readonly isOnlineMeeting?: true;
    readonly onlineMeetingProvider?: "teamsForBusiness";
}

export interface MailRecipient {
    readonly email: string;
    readonly name?: string;
}

export interface MailAttachment {
    readonly name: string;
    readonly contentType: string;
    readonly contentBytes: string;
}

export interface SendMailWithAttachmentOptions {
    readonly to: readonly MailRecipient[];
    readonly subject: string;
    readonly htmlBody: string;
    readonly senderEmail?: string | null;
    readonly attachments?: readonly MailAttachment[];
}