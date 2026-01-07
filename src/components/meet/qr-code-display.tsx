import { QRCodeSVG } from "qrcode.react"

export function QRCodeDisplay({ meetingId }: { meetingId: string }) {
    const qrValue = `${window.location.origin}/checkin/${meetingId}?method=qr`

    return (
        <div className="flex justify-center">
            <QRCodeSVG value={qrValue} size={200} level="H" fgColor="#000000" bgColor="#ffffff" />
        </div>
    )
}
