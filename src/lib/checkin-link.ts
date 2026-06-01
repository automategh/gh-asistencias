export type CheckinMethod = "qr" | "manual"

interface BuildCheckinUrlOptions {
    readonly dbUrl?: string | null
    readonly method?: CheckinMethod
}

/**
 * Construye una URL absoluta para check-in preservando el origen actual.
 */
export function buildCheckinUrl(
    meetingId: string,
    options: BuildCheckinUrlOptions = {},
): string {
    const cleanMeetingId = meetingId.trim()
    if (!cleanMeetingId) {
        return ""
    }

    const method = options.method ?? "qr"
    const query = new URLSearchParams({ method })

    const dbUrl = options.dbUrl?.trim()
    if (dbUrl) {
        query.set("db", dbUrl)
    }

    return `${window.location.origin}/checkin/${cleanMeetingId}?${query.toString()}`
}