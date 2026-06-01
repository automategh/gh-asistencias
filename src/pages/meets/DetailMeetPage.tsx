import Layout from '@/components/layouts/layout'
import { QRCodeDisplay } from '@/components/meet/qr-code-display'
import { useDatabase } from '@/context/DatabaseContext'
import { useAuth } from '@/context/AuthContext'
import { buildCheckinUrl } from '@/lib/checkin-link'
import { getDatabaseForUrl } from '@/services/firebase'
import { getSurveys, getSurveyById, type Survey } from '@/services/forms.service'
import { cancelMeeting, closeMeeting, completeMeeting, getMeetingById, reopenMeeting } from '@/services/meetings.service'
import type { Meeting } from '@/types/meeting'
import { ArrowLeft, BarChart3, Calendar, Clock, Copy, FileText, MapPin } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

function DetailMeetPage() {

    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { database } = useDatabase()
    const { user, hasPermission } = useAuth()
    const [searchParams] = useSearchParams()
    const [meeting, setMeeting] = useState<Meeting | null>(null)
    const [satisfactionSurvey, setSatisfactionSurvey] = useState<Survey | null>(null)
    const [closing, setClosing] = useState(false)
    const [completing, setCompleting] = useState(false)
    const [cancel, setCancel] = useState(false)
    const [reopening, setReopening] = useState(false)
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
    const sourceDatabaseUrl = searchParams.get('db')

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
        if (!meetingDatabase || !id) {
            return
        }

        let cancelled = false

        const loadMeetingAndSurvey = async () => {
            try {
                const loadedMeeting = await getMeetingById(meetingDatabase, id)

                if (cancelled) {
                    return
                }

                setMeeting(loadedMeeting)

                if (!loadedMeeting || loadedMeeting.type !== 'training') {
                    setSatisfactionSurvey(null)
                    return
                }

                if (loadedMeeting.satisfactionSurveyId && loadedMeeting.satisfactionSurveyId.trim().length > 0) {
                    const surveyById = await getSurveyById(meetingDatabase, loadedMeeting.satisfactionSurveyId)

                    if (cancelled) {
                        return
                    }

                    if (surveyById) {
                        setSatisfactionSurvey(surveyById)
                        return
                    }
                }

                const surveys = await getSurveys(meetingDatabase)

                if (cancelled) {
                    return
                }

                const fallbackSurvey = surveys.find((item) => item.category === 'training' && item.isActive && Boolean(item.predetermined)) ?? null
                setSatisfactionSurvey(fallbackSurvey)
            } catch (error) {
                console.error('Error al cargar la actividad o la encuesta de satisfacción:', error)
            }
        }

        void loadMeetingAndSurvey()

        return () => {
            cancelled = true
        }
    }, [meetingDatabase, id])

    /**
     * Devuelve la etiqueta legible del tipo de reunión.
     * Si `type` es "custom" y existe `customType`, utiliza esa etiqueta.
     */
    function getMeetingTypeLabel(m: Meeting | null): string {
        if (!m) return '—'
        switch (m.type) {
            case 'training':
                return 'Capacitación'
            case 'meeting':
                return 'Reunión'
            case 'custom':
                return m.customType && m.customType.trim().length > 0 ? m.customType : 'Personalizado'
            default:
                return 'Reunión'
        }
    }

    /**
     * Devuelve una etiqueta legible según el estado de la reunión.
     */
    function getStatusLabel(status: Meeting['status'] | undefined): string {
        switch (status) {
            case 'draft':
                return 'Borrador'
            case 'scheduled':
                return 'Programada'
            case 'closed':
                return 'Cerrada'
            case 'completed':
                return 'Completada'
            case 'cancelled':
                return 'Cancelada'
            default:
                return '-'
        }
    }

    /**
     * Devuelve clases de estilo para el badge según el estado.
     */
    function getStatusBadgeClass(status: Meeting['status'] | undefined): string {
        switch (status) {
            case 'draft':
                return 'bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300'
            case 'scheduled':
                return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
            case 'closed':
                return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
            case 'completed':
                return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
            case 'cancelled':
                return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
            default:
                return 'bg-muted text-muted-foreground'
        }
    }

    const canManageAnyMeeting = hasPermission('meetings_manage_any')
    const canManageOwnedMeeting = hasPermission('meetings_manage_owned')
    const canViewAttendance = hasPermission('meetings_attendance_view')

    const canEditMeeting = useMemo(() => {
        if (!meeting || !user) return false
        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        return canManageAnyMeeting || (canManageOwnedMeeting && (isCreator || isManager))
    }, [meeting, user, canManageAnyMeeting, canManageOwnedMeeting])

    // Permiso de cierre: manage_any o manage_owned (si es creador/manager)
    const canClose = useMemo(() => {
        if (!meeting || !user) return false
        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        return canManageAnyMeeting || (canManageOwnedMeeting && (isCreator || isManager))
    }, [meeting, user, canManageAnyMeeting, canManageOwnedMeeting])

    const isFinalStatus = useMemo(() => {
        const s = meeting?.status
        return s === 'closed' || s === 'completed'
    }, [meeting])

    /** 
     * Permiso de cancelación: manage_any o manage_owned (si es creador/manager)
     * */
    const canCancel = useMemo(() => {
        if (!meeting || !user) return false
        if (isFinalStatus) return false
        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        return canManageAnyMeeting || (canManageOwnedMeeting && (isCreator || isManager))
    }, [meeting, user, isFinalStatus, canManageAnyMeeting, canManageOwnedMeeting])

    /**
     * Permiso para reabrir una reunión cerrada o cancelada.
     * Solo quien tenga permisos de gestión puede reabrir.
     */
    const canReopen = useMemo(() => {
        if (!meeting || !user) return false
        const status = meeting.status
        if (status !== 'closed' && status !== 'cancelled') return false

        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        return canManageAnyMeeting || (canManageOwnedMeeting && (isCreator || isManager))
    }, [meeting, user, canManageAnyMeeting, canManageOwnedMeeting])

    async function handleCloseMeeting() {
        if (!meetingDatabase || !meeting || !user) return
        setClosing(true)
        try {
            const updated = await closeMeeting(meetingDatabase, meeting.id, user.uid)
            setMeeting(updated)
        } catch (error) {
            console.error('No fue posible cerrar la actividad:', error)
        } finally {
            setClosing(false)
        }
    }

    /**
     * Permiso de completar: gestión permitida y reunión finalizada
     */
    const canComplete = useMemo(() => {
        if (!meeting || !user) return false
        if (meeting.status === 'completed' || meeting.status === 'cancelled') return false
        const ended = Date.now() >= meeting.endTime
        const canByStatus = meeting.status === 'closed'
        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        const canManage = canManageAnyMeeting || (canManageOwnedMeeting && (isCreator || isManager))
        return canManage && (ended || canByStatus)
    }, [meeting, user, canManageAnyMeeting, canManageOwnedMeeting])

    async function handleCompleteMeeting() {
        if (!meetingDatabase || !meeting || !user) return
        setCompleting(true)
        try {
            const updated = await completeMeeting(meetingDatabase, meeting.id, user.uid)
            setMeeting(updated)
        } catch (error) {
            console.error('No fue posible completar la actividad:', error)
        } finally {
            setCompleting(false)
        }
    }

    async function handleCancelMeeting() {
        if (!meetingDatabase || !meeting || !user) return
        setCancel(true)

        try {
            // Opcional: podrías pedir un motivo y pasarlo como cuarto parámetro
            const updated = await cancelMeeting(meetingDatabase, meeting.id, user.uid)
            setMeeting(updated)
        } catch (error) {
            console.error('No fue posible cancelar la actividad:', error)
        } finally {
            setCancel(false)
        }
    }

    async function handleReopenMeeting() {
        if (!meetingDatabase || !meeting || !user) return
        setReopening(true)
        try {
            const updated = await reopenMeeting(meetingDatabase, meeting.id, user.uid)
            setMeeting(updated)
        } catch (error) {
            console.error('No fue posible reabrir la actividad:', error)
        } finally {
            setReopening(false)
        }
    }

    const handleGoBack = (): void => {
        if (window.history.length > 1) {
            navigate(-1)
            return
        }

        const baseRoute = '/meets'
        const destination = sourceDatabaseUrl
            ? `${baseRoute}?db=${encodeURIComponent(sourceDatabaseUrl)}`
            : baseRoute

        navigate(destination)
    }

    const checkinLink = meeting
        ? buildCheckinUrl(meeting.id, { dbUrl: sourceDatabaseUrl, method: 'qr' })
        : ''

    const handleCopyLink = async (): Promise<void> => {
        if (!checkinLink) return

        try {
            await navigator.clipboard.writeText(checkinLink)
            setCopyFeedback('Enlace copiado correctamente')
        } catch {
            setCopyFeedback('No se pudo copiar el enlace. Intenta manualmente.')
        }

        window.setTimeout(() => setCopyFeedback(null), 2500)
    }

    return (
        <Layout
            header={{
                breadcrumbs: [{ label: 'Actividades', to: '/meets' }, { label: 'Detalle' }],
                title: meeting?.title ?? 'Detalle de actividad',
            }}
        >
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <div className="max-w-6xl mx-auto px-6 pt-6">
                    <section className="bg-[#f3f4f3] p-4 rounded-xl flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Acciones</p>
                            <h2 className="text-sm md:text-base font-bold text-[#191c1c]">Gestión de actividad</h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleGoBack}
                                className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors bg-muted hover:bg-primary/20 rounded-lg px-3 py-2"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Volver atrás
                            </button>

                            {canEditMeeting && (
                                <Link
                                    to={sourceDatabaseUrl ? `/meeting/${id}/edit?db=${encodeURIComponent(sourceDatabaseUrl)}` : `/meeting/${id}/edit`}
                                    className="inline-flex items-center gap-2 rounded-xl border border-[#124734] bg-white px-4 py-2 text-sm font-semibold text-[#124734] shadow-sm hover:bg-[#124734]/10 transition-colors"
                                >
                                    Editar
                                </Link>
                            )}
                        </div>
                    </section>
                </div>
                <div className="max-w-6xl mx-auto p-6 ">

                    <div className="grid md:grid-cols-3 gap-6">
                        {/* Detalles de la Reunión */}
                        <div className="md:col-span-2 bg-card rounded-2xl border border-border p-6">
                            <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                                <FileText className="w-5 h-5 text-secondary" />
                                Detalles de la Actividad
                            </h2>

                            <div className="space-y-6">
                                <div className="pb-6 border-b border-border">
                                    <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Tipo</p>
                                    <p className="text-lg font-semibold text-foreground capitalize">
                                        {getMeetingTypeLabel(meeting)}
                                    </p>
                                </div>


                                <div className="pb-6 border-b border-border">
                                    <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Descripción</p>
                                    <p className="text-foreground leading-relaxed">{meeting?.description}</p>
                                </div>

                                {meeting?.type === 'training' && satisfactionSurvey && (
                                    <div className="pb-6 border-b border-border">
                                        <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Encuesta de satisfacción</p>
                                        <Link
                                            to={`/survey/${satisfactionSurvey.id}/response/${meeting.id}`}
                                            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-500 hover:text-primary-light underline-offset-2 hover:underline underline"
                                        >
                                            Responder encuesta de satisfacción
                                        </Link>
                                    </div>
                                )}

                                <div className="grid md:grid-cols-2 gap-6 pb-6 border-b border-border">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <MapPin className="w-4 h-4 text-secondary" />
                                            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Ubicación</p>
                                        </div>
                                        <p className="text-foreground font-semibold">{meeting?.location}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Estado</p>
                                        <span
                                            className={`px-3 py-1 rounded-full text-xs font-semibold inline-block ${getStatusBadgeClass(meeting?.status)}`}
                                        >
                                            {getStatusLabel(meeting?.status)}
                                        </span>
                                    </div>
                                </div>
                                <div className="grid md:grid-cols-2 gap-6">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <Clock className="w-4 h-4 text-secondary" />
                                            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                                                Hora de Inicio
                                            </p>
                                        </div>
                                        <p className="text-foreground font-semibold">{meeting?.startTime != undefined ? new Date(meeting.startTime).toLocaleString("es-ES") : new Date().toLocaleString("es-ES")}</p>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <Calendar className="w-4 h-4 text-secondary" />
                                            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Hora de Fin</p>
                                        </div>
                                        <p className="text-foreground font-semibold">{meeting?.endTime != undefined ? new Date(meeting.endTime).toLocaleString("es-ES") : new Date().toLocaleString("es-ES")}</p>
                                    </div>
                                </div>

                                <div className="mt-8 pt-6 border-t border-border">
                                    <div className="flex flex-wrap items-center justify-between gap-4">
                                        <div className="flex flex-wrap items-center gap-3">
                                            {canComplete && (
                                                <button
                                                    type="button"
                                                    disabled={completing}
                                                    onClick={handleCompleteMeeting}
                                                    className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white font-semibold rounded-lg transition-all duration-300 hover:bg-emerald-700 disabled:opacity-50"
                                                >
                                                    {completing ? 'Finalizando…' : 'Completar reunión'}
                                                </button>
                                            )}
                                            {canClose && !isFinalStatus && (
                                                <button
                                                    type="button"
                                                    disabled={closing}
                                                    onClick={handleCloseMeeting}
                                                    className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 text-white font-semibold rounded-lg transition-all duration-300 hover:bg-amber-700 disabled:opacity-50"
                                                >
                                                    {closing ? 'Cerrando…' : 'Cerrar actividad'}
                                                </button>
                                            )}
                                            {canReopen && (
                                                <button
                                                    type="button"
                                                    disabled={reopening}
                                                    onClick={handleReopenMeeting}
                                                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300 hover:bg-blue-700 disabled:opacity-50"
                                                >
                                                    {reopening ? 'Reabriendo…' : 'Volver a abrir actividad'}
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            {canCancel && !isFinalStatus && (
                                                <button
                                                    type="button"
                                                    disabled={cancel}
                                                    onClick={handleCancelMeeting}
                                                    className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white font-semibold rounded-lg transition-all duration-300 hover:bg-red-700 disabled:opacity-50"
                                                >
                                                    {cancel ? 'Cancelando…' : 'Cancelar actividad'}
                                                </button>
                                            )}
                                            {canViewAttendance ? (
                                                <Link
                                                    to={meeting ? `/attendance/${meeting.id}${sourceDatabaseUrl ? `?db=${encodeURIComponent(sourceDatabaseUrl)}` : ''}` : '/meets'}
                                                    className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5"
                                                >
                                                    <BarChart3 className="w-4 h-4" />
                                                    Ver asistencias
                                                </Link>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-card rounded-2xl border border-border p-6 text-center h-fit sticky top-24">
                            <h3 className="text-lg font-bold text-foreground mb-4">Código QR</h3>
                            <QRCodeDisplay meetingId={meeting?.id || ''} dbUrl={sourceDatabaseUrl} />
                            <p className="text-xs text-muted-foreground mt-4">Escanea este código para registrar asistencia o usa el siguiente enlace.</p>
                            <div className="mt-4 space-y-3 text-left">
                                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enlace de Asistencia</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={checkinLink}
                                        onFocus={(event) => event.currentTarget.select()}
                                        className="flex-1 rounded-xl border border-border bg-[#f7faf7] px-3 py-2 text-sm text-foreground outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { void handleCopyLink() }}
                                        className="inline-flex items-center justify-center rounded-xl bg-[#1b3022] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#14251a] transition-colors cursor-pointer"
                                        title='Copiar'
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                                {copyFeedback && (
                                    <p className="text-sm text-emerald-700">{copyFeedback}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>

    )
}

export default DetailMeetPage