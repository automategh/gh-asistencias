import Layout from '@/components/layouts/layout'
import { QRCodeDisplay } from '@/components/meet/qr-code-display'
import { useDatabase } from '@/context/DatabaseContext'
import { getMeetingById } from '@/services/meetings.service'
import type { Meeting } from '@/types/meeting'
import { BarChart3, Calendar, Clock, FileText, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

function DetailMeetPage() {

    const { id } = useParams<{ id: string }>()
    const { database } = useDatabase()
    const [meeting, setMeeting] = useState<Meeting | null>(null)

    useEffect(() => {
        if (!database || !id) {
            return
        }

        getMeetingById(database, id)
            .then((m) => {
                setMeeting(m)
            })
            .catch((error) => {
                console.error('Error al cargar la reunión:', error)
            })

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

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-50 backdrop-blur-xl">
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
                                    <Link
                                        to={`/attendance/${meeting?.id}`}
                                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5"
                                    >
                                        <BarChart3 className="w-5 h-5" />
                                        Ver Asistencia
                                    </Link>
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