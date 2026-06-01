import { useDatabase } from "@/context/DatabaseContext"
import { getMeetingById, updateAttendanceAcrossDatabases } from "@/services/meetings.service"
import { getDatabaseForUrl } from "@/services/firebase"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
import { AlertCircle, ArrowLeft } from "lucide-react"
import { get, ref } from "firebase/database"
import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"

type methodType = "qr" | "manual"
type CheckinRole = "internal" | "external"

function ChekinPage() {
    const { id } = useParams<{ id: string }>()
    const [searchParams] = useSearchParams()
    const method = searchParams.get('method') as methodType | null
    const sourceDatabaseUrl = searchParams.get('db')
    const roleParam = searchParams.get('role')

    const { database, databaseUrl } = useDatabase()
    const { user } = useAuth()
    const navigate = useNavigate()
    const [meeting, setMeeting] = useState<Meeting | null>(null)
    const [participant, setParticipant] = useState<MeetingParticipant | null>(null)
    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [checkedIn, setCheckedIn] = useState<boolean>(false)
    const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false)
    const role: CheckinRole | null = roleParam === 'internal' || roleParam === 'external' ? roleParam : null

    const meetingDatabase = useMemo(() => {
        if (sourceDatabaseUrl) {
            const resolvedDatabase = getDatabaseForUrl(sourceDatabaseUrl)
            if (resolvedDatabase) {
                return resolvedDatabase
            }
        }

        return database
    }, [database, sourceDatabaseUrl])

    const meetingDatabaseUrl = useMemo(() => {
        return sourceDatabaseUrl ?? databaseUrl ?? null
    }, [sourceDatabaseUrl, databaseUrl])

    const internalRedirectPath = useMemo<string>(() => {
        if (!id) {
            return '/login'
        }

        const params = new URLSearchParams()
        params.set('method', method ?? 'qr')
        params.set('role', 'internal')
        if (sourceDatabaseUrl) {
            params.set('db', sourceDatabaseUrl)
        }

        return `/login?redirect=${encodeURIComponent(`/checkin/${id}?${params.toString()}`)}`
    }, [id, method, sourceDatabaseUrl])

    useEffect(() => {
        let cancelled = false
        async function load(): Promise<void> {
            try {
                setLoading(true)
                setError(null)
                if (role !== 'internal') {
                    setMeeting(null)
                    setParticipant(null)
                    return
                }
                if (!meetingDatabase || !id) {
                    setMeeting(null)
                    setParticipant(null)
                    return
                }

                const meet = await getMeetingById(meetingDatabase, id)
                if (!cancelled) setMeeting(meet)

                if (!user) return
                // Cargar registro del participante
                const pSnap = await get(ref(meetingDatabase, `meetingParticipants/${id}/${user.uid}`))
                if (cancelled) return
                if (pSnap.exists()) {
                    const p = pSnap.val() as MeetingParticipant
                    setParticipant(p)
                } else {
                    setParticipant(null)
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'No fue posible cargar la actividad')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load().catch(() => setError('No fue posible cargar la actividad'))
        return () => { cancelled = true }
    }, [meetingDatabase, id, user, role])

    function buildCurrentCheckinUrl(nextRole: CheckinRole): string {
        if (!id) {
            return '/checkin'
        }

        const params = new URLSearchParams()
        params.set('method', method ?? 'qr')
        params.set('role', nextRole)
        if (sourceDatabaseUrl) {
            params.set('db', sourceDatabaseUrl)
        }

        return `/checkin/${id}?${params.toString()}`
    }

    function handleChooseRole(nextRole: CheckinRole): void {
        const destination = buildCurrentCheckinUrl(nextRole)
        if (nextRole === 'internal' && !user) {
            navigate(`/login?redirect=${encodeURIComponent(destination)}`)
            return
        }
        navigate(destination)
    }

    useEffect(() => {
        if (role === 'internal' && !user) {
            navigate(internalRedirectPath)
        }
    }, [role, user, navigate, internalRedirectPath])

    const alreadyCheckedIn = useMemo<boolean>(() => {
        return typeof participant?.checkedInAt === 'number'
    }, [participant])

    const isParticipant = useMemo<boolean>(() => {
        return participant !== null
    }, [participant])

    const isMeetingScheduled = useMemo<boolean>(() => {
        return meeting?.status === 'scheduled'
    }, [meeting])

    const canCheckIn = useMemo<boolean>(() => {
        return Boolean(isParticipant && !alreadyCheckedIn && isMeetingScheduled)
    }, [isParticipant, alreadyCheckedIn, isMeetingScheduled])

    // Margen de cortesía para considerar "tarde" (en minutos)
    const GRACE_MINUTES = 5
    const GRACE_MS = GRACE_MINUTES * 60 * 1000

    function computeAttendanceStatus(meet: Meeting, now: number): "present" | "late" {
        const start = meet.startTime
        return now > (start + GRACE_MS) ? "late" : "present"
    }

    async function handleCheckIn(): Promise<void> {
        if (!meetingDatabase || !id || !user || !meeting) return
        if (!canCheckIn) {
            setError('No cumples las condiciones para registrar asistencia')
            return
        }
        try {
            setError(null)
            const now = Date.now()
            const attendance = computeAttendanceStatus(meeting, now)
            await updateAttendanceAcrossDatabases(
                id,
                user.uid,
                meetingDatabaseUrl,
                databaseUrl,
                {
                    attendance,
                    checkedInAt: now,
                    checkinMethod: method ?? 'manual',
                },
            )
            setCheckedIn(true)
            setShowSuccessModal(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No fue posible registrar la asistencia')
        }
    }

    const handleGoBack = (): void => {
        if (window.history.length > 1) {
            navigate(-1)
            return
        }

        navigate(sourceDatabaseUrl ? `/meets?db=${encodeURIComponent(sourceDatabaseUrl)}` : '/meets')
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                {!role && (
                    <div className="max-w-2xl mx-auto p-6 mt-8">
                        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
                            <h1 className="text-2xl font-bold text-foreground">Selecciona tu tipo de acceso</h1>
                            <p className="text-sm text-muted-foreground">
                                Elige cómo deseas registrar tu asistencia para esta actividad.
                            </p>
                            <div className="grid gap-3 md:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={() => handleChooseRole('internal')}
                                    className="rounded-xl border border-[#1b3022] px-4 py-3 text-sm font-semibold text-[#1b3022] hover:bg-[#1b3022]/10 transition-colors"
                                >
                                    Soy colaborador
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleChooseRole('external')}
                                    className="rounded-xl border border-[#124734] px-4 py-3 text-sm font-semibold text-[#124734] hover:bg-[#124734]/10 transition-colors"
                                >
                                    Soy externo
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {role === 'external' && (
                    <div className="max-w-2xl mx-auto p-6 mt-8">
                        <div className="bg-card rounded-2xl border border-border p-6 space-y-3">
                            <h2 className="text-xl font-bold text-foreground">Registro de externo</h2>
                            <p className="text-sm text-muted-foreground">
                                Estamos preparando el formulario de autogestión para externos desde este mismo enlace QR.
                            </p>
                            <p className="text-sm text-muted-foreground">
                                Siguiente paso: completar datos, firma y envío de encuesta de satisfacción al finalizar el check-in.
                            </p>
                        </div>
                    </div>
                )}

                {role === 'internal' && (
                    <>
                <div className="max-w-2xl mx-auto p-6 mt-8">
                    <button
                        type="button"
                        onClick={handleGoBack}
                        className="inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm font-semibold text-[#1b3022] hover:bg-primary/20 transition-colors mb-6"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Volver
                    </button>
                    <div className="bg-card rounded-2xl border border-border p-6">
                        <h1 className="text-3xl font-bold text-foreground mb-2">{meeting?.title ?? '—'}</h1>
                        <p className="text-muted-foreground flex items-center gap-2 mb-6">📍 {meeting?.location ?? '—'}</p>
                        {loading && (
                            <div className="text-sm text-muted-foreground">Cargando…</div>
                        )}
                        {!loading && !canCheckIn && (
                            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                                <li>Debes ser participante de la actividad.</li>
                                <li>No debes haber registrado asistencia previamente.</li>
                                <li>La actividad debe estar en estado "Programada".</li>
                            </ul>
                        )}
                    </div>
                </div>

                {checkedIn && showSuccessModal && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
                        <div className="w-full max-w-md rounded-3xl border border-[#edeeed] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden">
                            <div className="px-6 py-5 border-b border-[#edeeed] bg-[#f8faf8]">
                                <h2 className="text-xl font-bold text-[#191c1c]">Asistencia registrada</h2>
                                <p className="text-sm text-[#5f6560] mt-2">Tu check-in se registró correctamente.</p>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-[#5f6560]">Pulsa cerrar para volver a la lista de actividades.</p>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowSuccessModal(false)
                                            navigate(-1)
                                        }}
                                        className="inline-flex items-center justify-center rounded-xl bg-[#1b3022] px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#14251a] transition-colors"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl mb-6 flex gap-4">
                        <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <p className="text-red-700 dark:text-red-400 font-semibold">{error}</p>
                    </div>
                )}

                {!checkedIn && !error && meeting && (
                    <div className="max-w-2xl mx-auto p-6">
                        <button
                            type="button"
                            disabled={!canCheckIn || loading}
                            onClick={() => { void handleCheckIn() }}
                            className="w-full px-6 py-4 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light disabled:opacity-50"
                        >
                            {method === 'qr' ? 'Registrar asistencia (QR)' : 'Registrar asistencia (Manual)'}
                        </button>
                    </div>
                )}
                    </>
                )}
        </div>
    )
}

export default ChekinPage