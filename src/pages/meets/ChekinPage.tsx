import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import { getMeetingById, updateParticipantStatus } from "@/services/meetings.service"
import { getDatabaseForUrl } from "@/services/firebase"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
import { AlertCircle, ArrowLeft, CheckCircle } from "lucide-react"
import { get, ref } from "firebase/database"
import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"

type methodType = "qr" | "manual"

function ChekinPage() {
    const { id } = useParams<{ id: string }>()
    const [searchParams] = useSearchParams()
    const method = searchParams.get('method') as methodType | null
    const sourceDatabaseUrl = searchParams.get('db')

    const { database } = useDatabase()
    const { user } = useAuth()
    const navigate = useNavigate()
    const [meeting, setMeeting] = useState<Meeting | null>(null)
    const [participant, setParticipant] = useState<MeetingParticipant | null>(null)
    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [checkedIn, setCheckedIn] = useState<boolean>(false)

    const meetingDatabase = useMemo(() => {
        if (sourceDatabaseUrl) {
            const resolvedDatabase = getDatabaseForUrl(sourceDatabaseUrl)
            if (resolvedDatabase) {
                return resolvedDatabase
            }
        }

        return database
    }, [database, sourceDatabaseUrl])

    useEffect(() => {
        let cancelled = false
        async function load(): Promise<void> {
            try {
                setLoading(true)
                setError(null)
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
    }, [meetingDatabase, id, user])

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
            await updateParticipantStatus(meetingDatabase, id, user.uid, {
                attendance,
                checkedInAt: now,
                checkinMethod: method ?? 'manual',
            })
            setCheckedIn(true)
            // Redirigir luego de exito
            setTimeout(() => {
                const destination = sourceDatabaseUrl
                    ? `/meets?db=${encodeURIComponent(sourceDatabaseUrl)}`
                    : '/meets'
                navigate(destination)
            }, 1500)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No fue posible registrar la asistencia')
        }
    }
    return (
        <Layout
            header={{
                breadcrumbs: [{ label: 'Actividades', to: '/meets' }, { label: 'Check-in' }],
                title: meeting?.title ?? 'Registrar asistencia',
                actions: (
                    <Link
                        to={sourceDatabaseUrl ? `/meets?db=${encodeURIComponent(sourceDatabaseUrl)}` : '/meets'}
                        className="inline-flex items-center gap-2 text-secondary hover:text-secondary-light transition-colors font-semibold"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Volver
                    </Link>
                ),
            }}
        >
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <div className="max-w-2xl mx-auto p-6 mt-8">
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

                {checkedIn && (
                    <div className="p-6 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl mb-6 text-center">
                        <CheckCircle className="w-12 h-12 text-emerald-600 dark:text-emerald-400 mx-auto mb-4" />
                        <p className="text-emerald-700 dark:text-emerald-400 font-semibold text-xl">Asistencia Registrada</p>
                        <p className="text-emerald-600 dark:text-emerald-400 text-sm mt-2">Redirigiendo a actividades...</p>
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
            </div>

        </Layout>
    )
}

export default ChekinPage