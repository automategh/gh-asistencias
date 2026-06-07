import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Meeting, MeetingParticipant } from '@/types/meeting'
import type { UserProfile } from '@/types/user'
import { resolveCrossDbUserProfileByEmail, type CrossDbUserProfileLiteCache } from '@/services/user.service'
import { updateAttendanceAcrossDatabases } from '@/services/meetings.service'
import type { Database } from 'firebase/database'
import { get, ref, update } from 'firebase/database'
import html2canvas from 'html2canvas-pro'
import jsPDF from 'jspdf'
import { CheckCircle2, FileDown, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface AttendanceSectionProps {
    readonly meeting: Meeting
    readonly meetingDatabase: Database | null
    readonly databaseUrl: string | null
    readonly meetingDatabaseUrl: string | null
    readonly canEditAttendance: boolean
}

interface AttendanceRow extends MeetingParticipant {
    readonly identify?: string | null
    readonly companyName?: string | null
    readonly department?: string | null
    readonly cargo?: string | null
    readonly signatureUrl?: string | null
    readonly signatureDataUrl?: string | null
    readonly source?: 'internal' | 'external'
}

interface ExternalAttendanceParticipant {
    readonly id: string
    readonly name: string
    readonly companyName?: string | null
    readonly email?: string | null
    readonly documentId?: string | null
    readonly signatureDataUrl?: string | null
    readonly attendance?: 'present' | 'late' | 'absent' | null
    readonly checkedInAt?: number | null
    readonly checkinMethod?: 'qr' | 'manual' | null
    readonly noShow?: boolean | null
}

function resolveCompanyLabel(row: AttendanceRow): string {
    const normalizedCompanyName = typeof row.companyName === 'string' ? row.companyName.trim() : ''
    if (normalizedCompanyName.length > 0) {
        return normalizedCompanyName
    }
    return 'Grupo Heroica'
}

function loadImageAsDataUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            const context = canvas.getContext('2d')
            if (!context) {
                reject(new Error('No fue posible obtener el contexto del canvas'))
                return
            }
            context.drawImage(image, 0, 0)
            resolve(canvas.toDataURL('image/png'))
        }
        image.onerror = () => reject(new Error(`No fue posible cargar la imagen: ${url}`))
        image.src = url
    })
}

export default function AttendanceSection({ meeting, meetingDatabase, databaseUrl, meetingDatabaseUrl, canEditAttendance }: AttendanceSectionProps) {
    const [attendance, setAttendance] = useState<AttendanceRow[]>([])
    const [directors, setDirectors] = useState<string | null>(null)
    const [loadingAttendance, setLoadingAttendance] = useState<boolean>(true)
    const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false)
    const [togglingUid, setTogglingUid] = useState<string | null>(null)
    const attendanceRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!meetingDatabase || !meeting?.id) {
            setLoadingAttendance(false)
            return
        }

        let cancelled = false
        const meetingId = meeting.id

        const loadAttendance = async (): Promise<void> => {
            try {
                setLoadingAttendance(true)

                const [participantsSnap, externalParticipantsSnap] = await Promise.all([
                    get(ref(meetingDatabase, `meetingParticipants/${meetingId}`)),
                    get(ref(meetingDatabase, `meetingExternalParticipants/${meetingId}`)),
                ])

                if (cancelled) return

                const participantsVal = participantsSnap.val() as Record<string, MeetingParticipant> | null
                const allParticipants = participantsVal ? Object.values(participantsVal) : []

                const directorParticipants = allParticipants.filter(
                    (participant) => participant.role === 'host' || participant.role === 'speaker',
                )
                const directorNames = directorParticipants
                    .map((participant) => participant.name)
                    .filter((name) => name.trim().length > 0)
                if (!cancelled) {
                    setDirectors(directorNames.length > 0 ? directorNames.join(', ') : null)
                }

                const presentParticipants = allParticipants
                    .filter((participant) => participant.attendance === 'present' || participant.attendance === 'late')
                    .sort((a, b) => a.name.localeCompare(b.name))

                const externalParticipantsVal = externalParticipantsSnap.val() as Record<string, ExternalAttendanceParticipant> | null
                const externalParticipants = externalParticipantsVal
                    ? Object.values(externalParticipantsVal)
                        .filter((participant) => participant.attendance === 'present' || participant.attendance === 'late')
                        .sort((a, b) => a.name.localeCompare(b.name))
                    : []

                let usersByUid: Record<string, UserProfile> = {}
                if (presentParticipants.length > 0) {
                    const usersSnap = await get(ref(meetingDatabase, 'users'))
                    if (cancelled) return
                    const usersVal = usersSnap.val() as Record<string, UserProfile> | null
                    usersByUid = usersVal ?? {}
                }

                const crossDbProfileCache: CrossDbUserProfileLiteCache = {}

                const internalEnriched: AttendanceRow[] = await Promise.all(
                    presentParticipants.map(async (participant) => {
                        const user = usersByUid[participant.uid]
                        const shouldResolveCrossDb = Boolean(
                            participant.email
                            && ((!user?.identify || !user.identify.trim()) || (!user?.cargo || !user.cargo.trim())),
                        )

                        const crossDbProfile = shouldResolveCrossDb
                            ? await resolveCrossDbUserProfileByEmail(participant.email, crossDbProfileCache)
                            : null

                        let signatureDataUrl: string | null = null
                        const signatureUrl = user?.signatureUrl ?? crossDbProfile?.signatureUrl ?? null

                        if (signatureUrl) {
                            try {
                                signatureDataUrl = await loadImageAsDataUrl(signatureUrl)
                            } catch {
                                signatureDataUrl = null
                            }
                        }

                        return {
                            ...participant,
                            source: 'internal',
                            identify: user?.identify ?? crossDbProfile?.identify ?? null,
                            companyName: user?.companyName ?? crossDbProfile?.companyName ?? null,
                            department: user?.department ?? null,
                            cargo: user?.cargo ?? crossDbProfile?.cargo ?? null,
                            signatureUrl,
                            signatureDataUrl,
                        }
                    }),
                )

                const externalEnriched: AttendanceRow[] = externalParticipants.map((participant) => ({
                    uid: participant.id,
                    name: participant.name,
                    email: participant.email ?? '',
                    role: 'attendee',
                    inviteStatus: 'accepted',
                    attendance: participant.attendance ?? null,
                    checkedInAt: participant.checkedInAt ?? undefined,
                    checkinMethod: participant.checkinMethod ?? undefined,
                    noShow: Boolean(participant.noShow),
                    source: 'external',
                    identify: participant.documentId ?? null,
                    companyName: participant.companyName ?? null,
                    department: 'Externo',
                    cargo: 'Externo',
                    signatureUrl: null,
                    signatureDataUrl: participant.signatureDataUrl ?? null,
                }))

                if (!cancelled) {
                    setAttendance(
                        [...internalEnriched, ...externalEnriched].sort((a, b) => a.name.localeCompare(b.name)),
                    )
                }
            } catch (error) {
                console.error('No fue posible cargar la asistencia:', error)
            } finally {
                if (!cancelled) {
                    setLoadingAttendance(false)
                }
            }
        }

        const scheduleLoad = (): (() => void) => {
            const w = window as Window & {
                requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
                cancelIdleCallback?: (handle: number) => void
            }
            if (typeof w.requestIdleCallback === 'function') {
                const handle = w.requestIdleCallback(() => { void loadAttendance() }, { timeout: 1000 })
                return () => {
                    w.cancelIdleCallback?.(handle)
                    cancelled = true
                }
            }
            const handle = window.setTimeout(() => { void loadAttendance() }, 250)
            return () => {
                window.clearTimeout(handle)
                cancelled = true
            }
        }

        const cleanup = scheduleLoad()

        return () => {
            cancelled = true
            cleanup?.()
        }
    }, [meetingDatabase, meeting?.id])

    const handleExportPdf = async (): Promise<void> => {
        if (!attendanceRef.current) return
        try {
            setIsExportingPdf(true)
            const element = attendanceRef.current
            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                scrollX: 0,
                scrollY: -window.scrollY,
            })
            const imgData = canvas.toDataURL('image/png')
            const pdf = new jsPDF('p', 'mm', 'a4')
            const pageWidth = pdf.internal.pageSize.getWidth()
            const pageHeight = pdf.internal.pageSize.getHeight()
            const imgWidth = pageWidth
            const imgHeight = (canvas.height * imgWidth) / canvas.width

            let position = 0
            let heightLeft = imgHeight
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
            heightLeft -= pageHeight

            while (heightLeft > 0) {
                position = heightLeft - imgHeight
                pdf.addPage()
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
                heightLeft -= pageHeight
            }

            const exportTitle = meeting.title?.trim() || 'registro-asistencia'
            const fileName = `${exportTitle.toLowerCase().replace(/\s+/g, '-')}.pdf`
            pdf.save(fileName)
        } catch (error) {
            console.error('Error al exportar PDF:', error)
        } finally {
            setIsExportingPdf(false)
        }
    }

    const handleToggleNoShow = async (row: AttendanceRow): Promise<void> => {
        if (!canEditAttendance || !meeting?.id) return
        const meetingId = meeting.id
        const newValue = !row.noShow

        setTogglingUid(row.uid)
        setAttendance((prev) =>
            prev.map((participant) => (participant.uid === row.uid ? { ...participant, noShow: newValue } : participant)),
        )

        try {
            if (row.source === 'external') {
                if (!meetingDatabase) {
                    throw new Error('No se pudo resolver la base de datos para actualizar externo')
                }
                await update(ref(meetingDatabase, `meetingExternalParticipants/${meetingId}/${row.uid}`), {
                    noShow: newValue,
                    updatedAt: Date.now(),
                })
            } else {
                await updateAttendanceAcrossDatabases(
                    meetingId,
                    row.uid,
                    meetingDatabaseUrl,
                    databaseUrl,
                    { noShow: newValue },
                )
            }
        } catch (error) {
            console.error('No fue posible actualizar la marca de asistencia:', error)
            setAttendance((prev) =>
                prev.map((participant) => (participant.uid === row.uid ? { ...participant, noShow: !newValue } : participant)),
            )
        } finally {
            setTogglingUid(null)
        }
    }

    return (
        <div>
            <section className="bg-[#f3f4f3] p-4 rounded-xl flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Asistencia</p>
                    <h2 className="text-sm md:text-base font-bold text-[#191c1c]">Registro de asistencia</h2>
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => { void handleExportPdf() }}
                        disabled={isExportingPdf || loadingAttendance || attendance.length === 0}
                    >
                        <FileDown className="w-4 h-4 mr-1" />
                        {isExportingPdf ? 'Generando PDF…' : 'Descargar PDF'}
                    </Button>
                </div>
            </section>

            <div
                ref={attendanceRef}
                className="attendance-print bg-card rounded-2xl shadow-xl px-4 sm:px-8 py-6 sm:py-8 overflow-x-auto"
            >
                <div className="flex justify-between items-center gap-6 mb-8">
                    <div className="w-28 sm:w-32 md:w-40 aspect-video flex items-center justify-center">
                        <img
                            src="/Logo-heroica-green.png"
                            alt="logo grupo heroica"
                            crossOrigin="anonymous"
                            className="w-full h-full object-cover drop-shadow-sm"
                        />
                    </div>
                    <h2 className="text-center font-extrabold text-lg sm:text-xl tracking-wide text-foreground">
                        REGISTRO DE ASISTENCIA
                    </h2>
                    <div />
                </div>

                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs sm:text-sm mb-6">
                    <div className="space-y-1 text-left">
                        <p>
                            <span className="font-semibold">Tema:</span> {meeting?.title ?? '__________'}
                        </p>
                        <p>
                            <span className="font-semibold">Dirige:</span> {directors ?? '__________'}
                        </p>
                    </div>
                    <div className="space-y-1 text-left">
                        <p>
                            <span className="font-semibold">Fecha:</span>{' '}
                            {meeting ? new Date(meeting.startTime).toLocaleDateString('es-CO') : '__________'}
                        </p>
                        <p>
                            <span className="font-semibold">Hora inicio:</span>{' '}
                            {meeting
                                ? new Date(meeting.startTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                                : '__________'}{' '}
                            <span className="font-semibold">Hora final:</span>{' '}
                            {meeting
                                ? new Date(meeting.endTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                                : '__________'}
                        </p>
                    </div>
                </div>

                <div className="overflow-x-auto rounded-xl shadow-sm">
                    <table className="w-full min-w-215 text-xs sm:text-sm border-collapse">
                        <thead>
                            <tr className="bg-muted/80 text-foreground">
                                <th className="border-b border-border px-3 py-2 text-left font-semibold">Nombre</th>
                                <th className="border-b border-border px-3 py-2 text-left font-semibold">Cédula</th>
                                <th className="border-b border-border px-3 py-2 text-left font-semibold">Empresa</th>
                                <th className="border-b border-border px-3 py-2 text-left font-semibold">Cargo</th>
                                <th className="border-b border-border px-3 py-2 text-center font-semibold">Firma</th>
                                <th className="border-b border-border px-3 py-2 text-center font-semibold">Asistencia</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loadingAttendance ? (
                                <tr>
                                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                                        <div className="inline-flex items-center justify-center">
                                            <Loader2 className="h-6 w-6 animate-spin text-[#1b3022]" />
                                        </div>
                                    </td>
                                </tr>
                            ) : attendance.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-4 text-muted-foreground">
                                        Sin registros
                                    </td>
                                </tr>
                            ) : (
                                attendance.map((item) => (
                                    <tr
                                        key={item.uid}
                                        className={cn(item.noShow && 'bg-[#fff1f0]')}
                                    >
                                        <td className={cn('px-3 py-3 text-foreground align-top wrap-break-word', item.noShow && 'border-2 border-[#93000a]')}>{item.name}</td>
                                        <td className={cn('px-3 py-3 text-foreground align-top wrap-break-word', item.noShow && 'border-2 border-[#93000a]')}>{item.identify ?? '—'}</td>
                                        <td className={cn('px-3 py-3 text-foreground align-top wrap-break-word', item.noShow && 'border-2 border-[#93000a]')}>{resolveCompanyLabel(item)}</td>
                                        <td className={cn('px-3 py-3 text-foreground align-top wrap-break-word', item.noShow && 'border-2 border-[#93000a]')}>{item.cargo ?? '—'}</td>
                                        <td className={cn('px-3 py-4 align-middle', item.noShow && 'border-2 border-[#93000a]')}>
                                            <div className="h-12 w-full flex items-center justify-center">
                                                {item.signatureUrl || item.signatureDataUrl ? (
                                                    <img
                                                        src={(item.signatureDataUrl ?? item.signatureUrl) || undefined}
                                                        alt={`Firma de ${item.name}`}
                                                        className="max-h-10 max-w-full object-contain"
                                                    />
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">Sin firma</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className={cn('px-3 py-4 text-center align-middle', item.noShow && 'border-2 border-[#93000a]')}>
                                            <button
                                                type="button"
                                                onClick={() => { void handleToggleNoShow(item) }}
                                                disabled={!canEditAttendance || togglingUid === item.uid}
                                                title={item.noShow ? 'Marcar como asistió' : 'Marcar como no asistió'}
                                                className={cn(
                                                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity',
                                                    canEditAttendance && 'hover:opacity-75 cursor-pointer',
                                                    !canEditAttendance && 'cursor-default',
                                                    'disabled:opacity-60 disabled:cursor-wait',
                                                    item.noShow
                                                        ? 'bg-red-100 text-red-700'
                                                        : 'bg-emerald-100 text-emerald-700',
                                                )}
                                            >
                                                {togglingUid === item.uid ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : item.noShow ? (
                                                    <XCircle className="w-3.5 h-3.5" />
                                                ) : (
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                )}
                                                {item.noShow ? 'No asistió' : 'Asistió'}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
