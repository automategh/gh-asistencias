import { QRCodeSVG } from "qrcode.react"

interface QRCodeDisplayProps {
    readonly meetingId: string
    readonly sourceDatabaseUrl?: string | null
}

export function QRCodeDisplay({ meetingId, sourceDatabaseUrl = null }: QRCodeDisplayProps) {
    const dbQuery = sourceDatabaseUrl ? `&db=${encodeURIComponent(sourceDatabaseUrl)}` : ""
    const qrValue = `${window.location.origin}/checkin/${meetingId}?method=qr${dbQuery}`

    return (
        <div className="flex justify-center">
            <QRCodeSVG value={qrValue} size={200} level="H" fgColor="#000000" bgColor="#ffffff" />
        </div>
    )
}
