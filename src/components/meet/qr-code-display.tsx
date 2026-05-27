import { QRCodeSVG } from "qrcode.react"

interface QRCodeDisplayProps {
    readonly meetingId: string
    readonly dbUrl?: string | null
}

export function QRCodeDisplay({ meetingId, dbUrl }: QRCodeDisplayProps) {
    const dbParam = dbUrl ? `&db=${encodeURIComponent(dbUrl)}` : ''
    const qrValue = `${window.location.origin}/checkin/${meetingId}?method=qr${dbParam}`

    return (
        <div className="flex justify-center">
            <QRCodeSVG value={qrValue} size={200} level="H" fgColor="#000000" bgColor="#ffffff" />
        </div>
    )
}
