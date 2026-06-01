import { useDatabase } from "@/context/DatabaseContext"
import { getMeetingById, registerExternalCheckin, updateAttendanceAcrossDatabases } from "@/services/meetings.service"
import { getDatabaseForUrl } from "@/services/firebase"
import type { Meeting, MeetingParticipant } from "@/types/meeting"
import { SignaturePadCanvas, type SignaturePadHandle } from "@/components/profile/signature-pad"
import { AlertCircle, ArrowLeft } from "lucide-react"
import { get, ref } from "firebase/database"
import { useEffect, useMemo, useRef, useState } from "react"
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
    const [showErrorModal, setShowErrorModal] = useState<boolean>(false)
    const [checkedIn, setCheckedIn] = useState<boolean>(false)
    const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false)
    const [externalSubmitting, setExternalSubmitting] = useState<boolean>(false)
    const [externalHasSignature, setExternalHasSignature] = useState<boolean>(false)
    const [externalCheckinDone, setExternalCheckinDone] = useState<boolean>(false)
    const [externalSurveyId, setExternalSurveyId] = useState<string | null>(null)
    const [externalParticipantId, setExternalParticipantId] = useState<string | null>(null)
    const [externalAlreadyRegistered, setExternalAlreadyRegistered] = useState<boolean>(false)
    const [showExternalSuccessModal, setShowExternalSuccessModal] = useState<boolean>(false)
    const [externalForm, setExternalForm] = useState<{
        name: string
        companyName: string
        email: string
        documentId: string
    }>({
        name: "",
        companyName: "",
        email: "",
        documentId: "",
    })
    const externalSignatureRef = useRef<SignaturePadHandle | null>(null)
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

                if (!user) {
                    if (!cancelled) {
                        setParticipant(null)
                    }
                    return
                }
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
            setShowErrorModal(true)
        }
    }

    async function handleExternalCheckin(): Promise<void> {
        if (!sourceDatabaseUrl) {
            setError('El enlace de check-in no incluye la base de datos de origen. Solicita un nuevo enlace o QR.')
            setShowErrorModal(true)
            return
        }

        if (!id || !meetingDatabaseUrl) {
            setError('No se pudo resolver la actividad para el registro externo')
            setShowErrorModal(true)
            return
        }

        const name = externalForm.name.trim()
        const companyName = externalForm.companyName.trim()
        const email = externalForm.email.trim()
        const documentId = externalForm.documentId.trim()

        if (!name) {
            setError('El nombre es obligatorio')
            setShowErrorModal(true)
            return
        }
        if (!companyName) {
            setError('La empresa es obligatoria')
            setShowErrorModal(true)
            return
        }
        if (!email) {
            setError('El correo es obligatorio')
            setShowErrorModal(true)
            return
        }
        if (!documentId) {
            setError('La identificación es obligatoria')
            setShowErrorModal(true)
            return
        }

        const signatureDataUrl = externalSignatureRef.current?.getDataURL('image/png')
        if (!signatureDataUrl) {
            setError('La firma es obligatoria')
            setShowErrorModal(true)
            return
        }

        try {
            setExternalSubmitting(true)
            setError(null)

            const response = await registerExternalCheckin(
                id,
                meetingDatabaseUrl,
                {
                    name,
                    companyName,
                    email: email || null,
                    documentId: documentId || null,
                    signatureDataUrl,
                    checkinMethod: method ?? 'qr',
                },
            )

            setExternalCheckinDone(true)
            setExternalParticipantId(response.externalId)
            setExternalSurveyId(response.surveyId ?? null)
            setExternalAlreadyRegistered(response.alreadyRegistered)
            setShowExternalSuccessModal(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No fue posible registrar el check-in externo')
            setShowErrorModal(true)
        } finally {
            setExternalSubmitting(false)
        }
    }

    function handleExternalSuccessContinue(): void {
        if (externalSurveyId && id && externalParticipantId) {
            const params = new URLSearchParams()
            params.set('externalId', externalParticipantId)
            if (sourceDatabaseUrl) {
                params.set('db', sourceDatabaseUrl)
            }
            navigate(`/external-survey/${externalSurveyId}/response/${id}?${params.toString()}`)
            return
        }

        navigate('/')
    }

    const handleGoBack = (): void => {
        if (window.history.length > 1) {
            navigate(-1)
            return
        }

        navigate(sourceDatabaseUrl ? `/meets?db=${encodeURIComponent(sourceDatabaseUrl)}` : '/meets')
    }

    return (
        <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
                <div className="px-4 md:px-12 py-10 md:py-10 max-w-5xl mx-auto">
                {error && showErrorModal && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
                        <div className="w-full max-w-md rounded-3xl border border-red-200 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden">
                            <div className="px-6 py-5 border-b border-red-100 bg-red-50">
                                <h2 className="text-xl font-bold text-red-800 flex items-center gap-2">
                                    <AlertCircle className="w-5 h-5" />
                                    Error de validación
                                </h2>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-red-700 font-medium">{error}</p>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowErrorModal(false)
                                            setError(null)
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

                {!role && (
                    <div className="bg-[#f3f4f3] p-6 rounded-xl space-y-6">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold mb-2">Check-in público</p>
                            <h1 className="text-2xl font-bold text-[#191c1c]">Selecciona tu tipo de acceso</h1>
                            <p className="text-sm text-muted-foreground">
                                Elige cómo deseas registrar tu asistencia para esta actividad.
                            </p>
                            <div className="grid gap-3 md:grid-cols-2 mt-4">
                                <button
                                    type="button"
                                    onClick={() => handleChooseRole('internal')}
                                    className="rounded-xl border border-[#1b3022] bg-white px-4 py-3 text-sm font-semibold text-[#1b3022] hover:bg-[#1b3022]/10 transition-colors"
                                >
                                    Soy colaborador
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleChooseRole('external')}
                                    className="rounded-xl border border-[#124734] bg-white px-4 py-3 text-sm font-semibold text-[#124734] hover:bg-[#124734]/10 transition-colors"
                                >
                                    Soy externo
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {role === 'external' && (
                        <div className="bg-[#f3f4f3] p-6 rounded-xl space-y-6">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold mb-2">Check-in externo</p>
                                <h2 className="text-xl font-bold text-[#191c1c]">Registro de externo</h2>
                            <p className="text-sm text-muted-foreground">
                                Completa tus datos y firma para registrar la asistencia.
                            </p>
                            </div>

                            {!externalCheckinDone && (
                                <>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nombre completo</label>
                                            <input
                                                type="text"
                                                value={externalForm.name}
                                                onChange={(event) => setExternalForm((prev) => ({ ...prev, name: event.target.value }))}
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                                placeholder="Nombre y apellido"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Empresa</label>
                                            <input
                                                type="text"
                                                value={externalForm.companyName}
                                                onChange={(event) => setExternalForm((prev) => ({ ...prev, companyName: event.target.value }))}
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                                placeholder="Empresa donde trabajas"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Correo *</label>
                                            <input
                                                type="email"
                                                value={externalForm.email}
                                                onChange={(event) => setExternalForm((prev) => ({ ...prev, email: event.target.value }))}
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                                placeholder="correo@empresa.com"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Identificación *</label>
                                            <input
                                                type="text"
                                                value={externalForm.documentId}
                                                onChange={(event) => setExternalForm((prev) => ({ ...prev, documentId: event.target.value }))}
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                                placeholder="Documento o pasaporte"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2 rounded-2xl border border-[#edeeed] bg-white p-4">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Firma</p>
                                        <SignaturePadCanvas
                                            ref={externalSignatureRef}
                                            onChange={setExternalHasSignature}
                                            height={170}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Debes firmar para confirmar el registro de asistencia.
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => { void handleExternalCheckin() }}
                                        disabled={externalSubmitting || !externalHasSignature || loading}
                                        className="w-full rounded-xl bg-[#1b3022] px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#14251a] transition-colors disabled:opacity-60"
                                    >
                                        {externalSubmitting ? 'Registrando asistencia...' : 'Registrar asistencia como externo'}
                                    </button>
                                    {!externalHasSignature && (
                                        <p className="text-xs text-amber-700">
                                            Para continuar, dibuja tu firma en el recuadro.
                                        </p>
                                    )}
                                </>
                            )}

                            {externalCheckinDone && (
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                                    Asistencia registrada. Revisa el resumen y continúa.
                                </div>
                            )}
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
                {showExternalSuccessModal && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
                        <div className="w-full max-w-md rounded-3xl border border-[#edeeed] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden">
                            <div className="px-6 py-5 border-b border-[#edeeed] bg-[#f8faf8]">
                                <h2 className="text-xl font-bold text-[#191c1c]">Registro exitoso</h2>
                                <p className="text-sm text-[#5f6560] mt-2">
                                    {externalAlreadyRegistered
                                        ? 'Ya existía un registro para estos datos y fue actualizado correctamente.'
                                        : 'Tu asistencia externa fue registrada correctamente.'}
                                </p>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-[#5f6560]">
                                    {externalSurveyId
                                        ? 'Esta capacitación requiere encuesta de satisfacción. Continúa para completarla.'
                                        : 'No hay encuesta pendiente. Puedes finalizar este proceso.'}
                                </p>
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowExternalSuccessModal(false)
                                        }}
                                        className="inline-flex items-center justify-center rounded-xl border border-[#d4d7d5] bg-white px-5 py-3 text-sm font-semibold text-[#1b3022] hover:bg-[#f2f4f3] transition-colors"
                                    >
                                        Cerrar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleExternalSuccessContinue}
                                        className="inline-flex items-center justify-center rounded-xl bg-[#1b3022] px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#14251a] transition-colors"
                                    >
                                        {externalSurveyId ? 'Continuar a encuesta' : 'Finalizar'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                </div>
        </div>
    )
}

export default ChekinPage