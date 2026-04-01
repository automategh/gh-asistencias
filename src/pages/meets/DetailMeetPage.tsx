import Layout from '@/components/layouts/layout'
import { QRCodeDisplay } from '@/components/meet/qr-code-display'
import { useDatabase } from '@/context/DatabaseContext'
import { useAuth } from '@/context/AuthContext'
import { getSurveys, type Survey } from '@/services/forms.service'
import { cancelMeeting, closeMeeting, completeMeeting, getMeetingById, reopenMeeting } from '@/services/meetings.service'
import type { Meeting } from '@/types/meeting'
import { BarChart3, Calendar, Clock, FileText, MapPin } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

function DetailMeetPage() {

    const { id } = useParams<{ id: string }>()
    const { database } = useDatabase()
    const { user, role } = useAuth()
    const [meeting, setMeeting] = useState<Meeting | null>(null)
    const [satisfactionSurvey, setSatisfactionSurvey] = useState<Survey | null>(null)
    const [closing, setClosing] = useState(false)
    const [completing, setCompleting] = useState(false)
    const [cancel, setCancel] = useState(false)
    const [reopening, setReopening] = useState(false)

    useEffect(() => {
        if (!database || !id) {
            return
        }

        let cancelled = false

        const loadMeetingAndSurvey = async () => {
            try {
                const loadedMeeting = await getMeetingById(database, id)

                if (cancelled) {
                    return
                }

                setMeeting(loadedMeeting)

                if (!loadedMeeting || loadedMeeting.type !== 'training') {
                    setSatisfactionSurvey(null)
                    return
                }

                const surveys = await getSurveys(database)

                if (cancelled) {
                    return
                }

                const survey = surveys.find((item) => item.category === 'training' && item.isActive && Boolean(item.predetermined)) ?? null
                setSatisfactionSurvey(survey)
            } catch (error) {
                console.error('Error al cargar la reunión o la encuesta de satisfacción:', error)
            }
        }

        void loadMeetingAndSurvey()

        return () => {
            cancelled = true
        }
    }, [database, id])

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

    // Permiso de cierre: creador, manager o Admin
    const canClose = useMemo(() => {
        if (!meeting || !user) return false
        if (role === 'Admin') return true
        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        return isCreator || isManager
    }, [meeting, user, role])

    const isFinalStatus = useMemo(() => {
        const s = meeting?.status
        return s === 'closed' || s === 'completed'
    }, [meeting])

    /** 
     * Permiso de cancelación: creador, manager o Admin
     * */
    const canCancel = useMemo(() => {
        if (!meeting || !user) return false
        if (isFinalStatus) return false
        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        const isAdmin = role === 'Admin'
        return isCreator || isManager || isAdmin
    }, [meeting, user, role, isFinalStatus])

    /**
     * Permiso para reabrir una reunión cerrada o cancelada.
     * Solo creador, manager o Admin pueden reabrir.
     */
    const canReopen = useMemo(() => {
        if (!meeting || !user) return false
        const status = meeting.status
        if (status !== 'closed' && status !== 'cancelled') return false

        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        const isAdmin = role === 'Admin'
        return isCreator || isManager || isAdmin
    }, [meeting, user, role])

    async function handleCloseMeeting() {
        if (!database || !meeting || !user) return
        setClosing(true)
        try {
            const updated = await closeMeeting(database, meeting.id, user.uid)
            setMeeting(updated)
        } catch (error) {
            console.error('No fue posible cerrar la reunión:', error)
        } finally {
            setClosing(false)
        }
    }

    /**
     * Permiso de completar: creador, manager o Admin y reunión finalizada
     */
    const canComplete = useMemo(() => {
        if (!meeting || !user) return false
        if (meeting.status === 'completed' || meeting.status === 'cancelled') return false
        const ended = Date.now() >= meeting.endTime
        const canByStatus = meeting.status === 'closed'
        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        const isAdmin = role === 'Admin'
        return (isCreator || isManager || isAdmin) && (ended || canByStatus)
    }, [meeting, user, role])

    async function handleCompleteMeeting() {
        if (!database || !meeting || !user) return
        setCompleting(true)
        try {
            const updated = await completeMeeting(database, meeting.id, user.uid)
            setMeeting(updated)
        } catch (error) {
            console.error('No fue posible completar la reunión:', error)
        } finally {
            setCompleting(false)
        }
    }

    async function handleCancelMeeting() {
        if (!database || !meeting || !user) return
        setCancel(true)

        try {
            // Opcional: podrías pedir un motivo y pasarlo como cuarto parámetro
            const updated = await cancelMeeting(database, meeting.id, user.uid)
            setMeeting(updated)
        } catch (error) {
            console.error('No fue posible cancelar la reunión:', error)
        } finally {
            setCancel(false)
        }
    }

    async function handleReopenMeeting() {
        if (!database || !meeting || !user) return
        setReopening(true)
        try {
            const updated = await reopenMeeting(database, meeting.id, user.uid)
            setMeeting(updated)
        } catch (error) {
            console.error('No fue posible reabrir la reunión:', error)
        } finally {
            setReopening(false)
        }
    }

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-20 backdrop-blur-xl">
                    <nav className="max-w-6xl mx-auto px-6 py-4">
                        <h1 className="text-3xl font-bold mt-4 text-foreground">{meeting?.title}</h1>
                    </nav>
                </header>

                <div className="max-w-6xl mx-auto p-6 mt-8">
                    <div className="grid md:grid-cols-3 gap-6">
                        {/* Detalles de la Reunión */}
                        <div className="md:col-span-2 bg-card rounded-2xl border border-border p-6">
                            <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                                <FileText className="w-5 h-5 text-secondary" />
                                Detalles de la Reunión
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
                                            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-light underline-offset-2 hover:underline"
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
                                                    {closing ? 'Cerrando…' : 'Cerrar reunión'}
                                                </button>
                                            )}
                                            {canReopen && (
                                                <button
                                                    type="button"
                                                    disabled={reopening}
                                                    onClick={handleReopenMeeting}
                                                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300 hover:bg-blue-700 disabled:opacity-50"
                                                >
                                                    {reopening ? 'Reabriendo…' : 'Volver a abrir reunión'}
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
                                                    {cancel ? 'Cancelando…' : 'Cancelar reunión'}
                                                </button>
                                            )}
                                            {role === 'Admin' || role === 'HR' || role === 'Lider' || role === 'Instructor' ? (
                                                <Link
                                                    to={`/attendance/${meeting?.id}`}
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
                            <QRCodeDisplay meetingId={meeting?.id || ''} />
                            <p className="text-xs text-muted-foreground mt-4">Escanea este código para registrar asistencia</p>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>

    )
}

export default DetailMeetPage