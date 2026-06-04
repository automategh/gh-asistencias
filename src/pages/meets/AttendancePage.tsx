import Layout from '@/components/layouts/layout'
import { Button } from '@/components/ui/button'
import { useDatabase } from '@/context/DatabaseContext'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { get, ref, update } from 'firebase/database'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas-pro'
import type { MeetingParticipant, Meeting } from '@/types/meeting'
import type { UserProfile } from '@/types/user'
import { getMeetingById, updateAttendanceAcrossDatabases } from '@/services/meetings.service'
import { getDatabaseForUrl } from '@/services/firebase'
import {
    resolveCrossDbUserProfileByEmail,
    type CrossDbUserProfileLiteCache,
} from '@/services/user.service'
import { ArrowLeft, Loader2 } from 'lucide-react'

/**
 * Fila de asistencia enriquecida para la vista/impresión.
 *
 * Extiende `MeetingParticipant` con metadatos provenientes del perfil
 * de usuario (identificación, empresa, cargo y firma digital).
 */
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

/**
 * Carga una imagen remota y la convierte a Data URL (base64 PNG).
 *
 * Se usa para evitar problemas de CORS al exportar la firma en el PDF,
 * dibujando primero la imagen en un canvas y serializándola.
 *
 * @param url URL pública de la imagen a convertir.
 * @returns Promesa que resuelve con el data URL en formato PNG.
 */
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

        image.onerror = () => {
            reject(new Error(`No fue posible cargar la imagen: ${url}`))
        }

        image.src = url
    })
}

/**
 * Página de registro de asistencia de una reunión.
 *
 * - Carga los datos de la reunión y los participantes desde RTDB.
 * - Enriquece cada asistente con información de perfil (cédula, empresa, cargo, firma).
 * - Muestra solo quienes registraron asistencia (present o late).
 * - Permite exportar la hoja tal como se ve en pantalla a un PDF (jsPDF + html2canvas).
 */
function AttendancePage() {
    const { id } = useParams<{ id: string }>()
    const { database, databaseUrl } = useDatabase()
    const [searchParams] = useSearchParams()
    const sourceDatabaseUrl = searchParams.get('db')
    const navigate = useNavigate()

    const [meeting, setMeeting] = useState<Meeting | null>(null)
    const [attendance, setAttendance] = useState<AttendanceRow[]>([])
    const [directors, setDirectors] = useState<string | null>(null)
    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [isExporting, setIsExporting] = useState<boolean>(false)
    const attendanceRef = useRef<HTMLDivElement | null>(null)

    const meetingDatabase = useMemo(() => {
        if (sourceDatabaseUrl) {
            const resolved = getDatabaseForUrl(sourceDatabaseUrl)
            if (resolved) return resolved
        }
        return database
    }, [database, sourceDatabaseUrl])

    const meetingDatabaseUrl = useMemo(() => {
        return sourceDatabaseUrl ?? databaseUrl ?? null
    }, [sourceDatabaseUrl, databaseUrl])

    useEffect(() => {
        let cancelled = false

        /**
         * Carga reunión, participantes y usuarios relacionados desde RTDB,
         * filtrando solo los asistentes efectivos y resolviendo quién dirige.
         */
        async function load(): Promise<void> {
            try {
                setLoading(true)
                setError(null)

                if (!meetingDatabase || !id) {
                    setAttendance([])
                    setMeeting(null)
                    return
                }

                try {
                    const meetingData = await getMeetingById(meetingDatabase, id)
                    if (!cancelled) {
                        setMeeting(meetingData)
                    }
                } catch {
                    // Es válido que falle la reunión y solo queramos mostrar la asistencia
                }

                const participantsSnap = await get(ref(meetingDatabase, `meetingParticipants/${id}`))
                if (cancelled) return

                const participantsVal = participantsSnap.val() as Record<string, MeetingParticipant> | null
                const allParticipants = participantsVal ? Object.values(participantsVal) : []

                // Determinar quién dirige la reunión según el rol asignado
                const directorParticipants = allParticipants.filter(
                    (participant) => participant.role === 'host' || participant.role === 'speaker',
                )
                const directorNames = directorParticipants.map((participant) => participant.name).filter((name) => name.trim().length > 0)
                if (!cancelled) {
                    setDirectors(directorNames.length > 0 ? directorNames.join(', ') : null)
                }

                // Solo consideramos como filas de asistencia a quienes se marcaron
                // como presentes o tarde.
                const participants = allParticipants
                    .filter((participant) => participant.attendance === 'present' || participant.attendance === 'late')
                    .sort((a, b) => a.name.localeCompare(b.name))

                const [usersSnap, externalParticipantsSnap] = await Promise.all([
                    get(ref(meetingDatabase, 'users')),
                    get(ref(meetingDatabase, `meetingExternalParticipants/${id}`)),
                ])

                const usersVal = usersSnap.val() as Record<string, UserProfile> | null
                const usersByUid: Record<string, UserProfile> = usersVal ?? {}
                const crossDbProfileCache: CrossDbUserProfileLiteCache = {}
                const externalParticipantsVal = externalParticipantsSnap.val() as Record<string, ExternalAttendanceParticipant> | null
                const externalParticipants = externalParticipantsVal
                    ? Object.values(externalParticipantsVal)
                        .filter((participant) => participant.attendance === 'present' || participant.attendance === 'late')
                        .sort((a, b) => a.name.localeCompare(b.name))
                    : []

                const internalEnriched: AttendanceRow[] = await Promise.all(
                    participants.map(async (participant) => {
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

                const enriched: AttendanceRow[] = [...internalEnriched, ...externalEnriched].sort((a, b) =>
                    a.name.localeCompare(b.name),
                )

                if (!cancelled) {
                    setAttendance(enriched)
                }
            } catch (loadError) {
                if (!cancelled) {
                    const message = loadError instanceof Error ? loadError.message : 'No fue posible cargar la asistencia'
                    setError(message)
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        void load()

        return () => {
            cancelled = true
        }
    }, [meetingDatabase, id])

    /**
     * Genera un PDF a partir de la vista actual de la hoja de asistencia.
     *
     * Captura el contenedor `attendanceRef` como imagen usando html2canvas
     * y lo inserta en un documento A4, manejando el salto de página cuando
     * el contenido excede la primera hoja.
     */
    const handleExportPdf = async (): Promise<void> => {
        if (!attendanceRef.current || !meeting) return

        try {
            setIsExporting(true)

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
        } catch (exportError) {
            console.error('Error al exportar PDF:', exportError)
        } finally {
            setIsExporting(false)
        }
    }

    /**
     * Marca o desmarca manualmente que un asistente no asistió realmente,
     * aun cuando el sistema lo tenga como presente/tarde.
     *
     * Actualiza estado local y persiste el flag `noShow` en RTDB.
     */
    const handleToggleNoShow = async (row: AttendanceRow, checked: boolean): Promise<void> => {
        if (!id) return

        // Actualización optimista en UI
        setAttendance((prev) =>
            prev.map((participant) => (participant.uid === row.uid ? { ...participant, noShow: checked } : participant)),
        )

        try {
            if (row.source === 'external') {
                if (!meetingDatabase) {
                    throw new Error('No se pudo resolver la base de datos para actualizar externo')
                }

                await update(ref(meetingDatabase, `meetingExternalParticipants/${id}/${row.uid}`), {
                    noShow: checked,
                    updatedAt: Date.now(),
                })
            } else {
                await updateAttendanceAcrossDatabases(
                    id,
                    row.uid,
                    meetingDatabaseUrl,
                    databaseUrl,
                    { noShow: checked },
                )
            }
        } catch (updateError) {
            console.error('No fue posible actualizar la marca de asistencia manual:', updateError)
            // Revertir en caso de error para mantener consistencia visual
            setAttendance((prev) =>
                prev.map((participant) => (participant.uid === row.uid ? { ...participant, noShow: !checked } : participant)),
            )
        }
    }

    /**
     * Navega a la pantalla anterior en el historial del navegador.
     *
     * Se usa en el botón de la cabecera para volver rápidamente
     * al listado o pantalla desde donde se llegó a la reunión.
     */
    const handleGoBack = (): void => {
        navigate(-1)
    }

    return (
        <Layout
            header={{
                breadcrumbs: [{ label: 'Actividades', to: '/meets' }, { label: 'Asistencia' }],
                title: `Asistencia: ${meeting?.title ?? '—'}`,
            }}
        >
            <div className="min-h-screen bg-linear-to-br from-background via-muted/10 to-background">
                {loading && (
                    <div className="px-4 pt-6">
                        <div className="mx-auto max-w-sm md:max-w-7xl rounded-xl bg-white border border-[#edeeed] p-8 flex items-center justify-center">
                            <Loader2 className="h-7 w-7 animate-spin text-[#1b3022]" />
                        </div>
                    </div>
                )}
                {error && <div className="px-4 pt-4 text-sm text-red-600">{error}</div>}

                <div className="max-w-sm md:max-w-7xl mx-auto mt-6 px-2 sm:px-4">
                    <section className="bg-[#f3f4f3] p-4 rounded-xl flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Acciones</p>
                            <h2 className="text-sm md:text-base font-bold text-[#191c1c]">Formato de asistencia</h2>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                onClick={handleGoBack}
                                aria-label="Volver atrás"
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={handleExportPdf}
                                disabled={isExporting || attendance.length === 0}
                            >
                                {isExporting ? 'Generando PDF…' : 'Descargar PDF'}
                            </Button>
                        </div>
                    </section>
                </div>

                <div className="max-w-sm md:max-w-7xl mx-auto mt-10 px-2 sm:px-4 pb-10">
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
                                    <span className="font-semibold">Tema:</span>{' '}
                                    {meeting?.title ?? '__________'}
                                </p>
                                <p>
                                    <span className="font-semibold">Dirige:</span>{' '}
                                    {directors ?? '__________'}
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
                                        {/* Esta columna se ignora en el PDF mediante html2canvas */}
                                        <th
                                            className="border-b border-border px-3 py-2 text-center font-semibold"
                                            data-html2canvas-ignore="true"
                                        >
                                            No asistió
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
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
                                                data-html2canvas-ignore={item.noShow ? "true" : undefined}
                                            >
                                                <td className="px-3 py-3 text-foreground align-top wrap-break-word">{item.name}</td>
                                                <td className="px-3 py-3 text-foreground align-top wrap-break-word">{item.identify ?? '—'}</td>
                                                <td className="px-3 py-3 text-foreground align-top wrap-break-word">{resolveCompanyLabel(item)}</td>
                                                <td className="px-3 py-3 text-foreground align-top wrap-break-word">{item.cargo ?? '—'}</td>
                                                <td className="px-3 py-4 align-middle">
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
                                                <td
                                                    className="px-3 py-4 text-center align-middle"
                                                    data-html2canvas-ignore="true"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(item.noShow)}
                                                        onChange={(event) => {
                                                            void handleToggleNoShow(item, event.target.checked)
                                                        }}
                                                        aria-label={`Marcar que ${item.name} no asistió`}
                                                    />
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default AttendancePage