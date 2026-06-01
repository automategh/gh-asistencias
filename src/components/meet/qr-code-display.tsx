import { QRCodeSVG } from "qrcode.react"
import { buildCheckinUrl } from "@/lib/checkin-link"

interface QRCodeDisplayProps {
    readonly meetingId: string
    readonly dbUrl?: string | null
}

export function QRCodeDisplay({ meetingId, dbUrl }: QRCodeDisplayProps) {
    const qrValue = buildCheckinUrl(meetingId, { dbUrl, method: "qr" })

    return (
        <div className="flex justify-center">
            <QRCodeSVG value={qrValue} size={200} level="H" fgColor="#000000" bgColor="#ffffff" />
        </div>
    )
}
