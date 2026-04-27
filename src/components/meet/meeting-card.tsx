import { ArrowRight, Calendar, Clock, MapPin, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Meeting } from '@/types/meeting'
import { useAuth } from '@/context/AuthContext'

/**
 * Tarjeta de reunión/capacitación.
 * Presenta título, fechas, ubicación y acciones.
 */
export default function MeetingCard({
    meeting,
    canComplete,
    onComplete,
    completing,
    onOpenDetails,
    onOpenCheckin,
}: {
    meeting: Meeting
    canComplete?: boolean
    onComplete?: (meetingId: string) => void
    completing?: boolean
    onOpenDetails?: (meetingId: string) => void
    onOpenCheckin?: (meetingId: string) => void
}) {
    const startDate = new Date(meeting.startTime)
    const endDate = new Date(meeting.endTime)

    const { user } = useAuth()

    function formatDateTime(d: Date): string {
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    }

    const ownerMeet = meeting.createdBy === user?.uid

    function statusLabelAndClass(): { label: string; className: string } {
        switch (meeting.status) {
            case 'scheduled':
                return { label: 'Próxima', className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' }
            case 'closed':
                return { label: 'Cerrada', className: 'bg-muted text-muted-foreground' }
            case 'completed':
                return { label: 'Finalizada', className: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' }
            case 'cancelled':
                return { label: 'Cancelada', className: 'bg-muted text-muted-foreground' }
            default:
                return { label: 'Estado', className: 'bg-muted text-muted-foreground' }
        }
    }

    return (
        <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg hover:scale-105 cursor-pointer group relative overflow-hidden">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-linear-to-br from-secondary/20 to-accent/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div className="relative">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            <div className={`w-3 h-3 rounded-full ${meeting.type === 'training' ? 'bg-secondary' : 'bg-primary'}`}></div>
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {meeting.type === 'training' ? 'Capacitación' : 'Reunión'}
                            </span>
                        </div>
                        <h3 className="text-lg font-bold text-foreground mb-1 group-hover:text-primary transition-colors">
                            {meeting.title}
                        </h3>
                    </div>
                    {(() => {
                        const { label, className } = statusLabelAndClass()
                        return (
                            <div className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${className}`}>
                                {label}
                            </div>
                        )
                    })()}
                </div>

                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{meeting.description || 'Sin descripción'}</p>

                <div className="space-y-2 mb-6">
                    <div className="flex items-center gap-3 text-sm text-foreground">
                        <Calendar className="w-4 h-4 text-secondary shrink-0" />
                        <span>{formatDateTime(startDate)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-foreground">
                        <Clock className="w-4 h-4 text-secondary shrink-0" />
                        <span>{formatDateTime(endDate)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-foreground">
                        <MapPin className="w-4 h-4 text-secondary shrink-0" />
                        <span>{meeting.location}</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    {onOpenDetails ? (
                        <button
                            type="button"
                            onClick={() => onOpenDetails(meeting.id)}
                            className="px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md text-center text-sm flex items-center justify-center gap-2"
                        >
                            Detalles
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <Link to={`/meeting/${meeting.id}`} className="px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md text-center text-sm flex items-center justify-center gap-2">
                            Detalles
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    )}
                    {onOpenCheckin ? (
                        <button
                            type="button"
                            onClick={() => onOpenCheckin(meeting.id)}
                            className="px-6 py-2 bg-transparent border-2 border-primary text-primary font-semibold rounded-lg transition-all duration-300 hover:bg-primary hover:text-primary-foreground hover:shadow-lg active:scale-95 text-center text-sm flex items-center justify-center gap-2"
                        >
                            <Users className="w-4 h-4" />
                            Asistencia
                        </button>
                    ) : (
                        <Link to={`/checkin/${meeting.id}`} className="px-6 py-2 bg-transparent border-2 border-primary text-primary font-semibold rounded-lg transition-all duration-300 hover:bg-primary hover:text-primary-foreground hover:shadow-lg active:scale-95 text-center text-sm flex items-center justify-center gap-2">
                            <Users className="w-4 h-4" />
                            Asistencia
                        </Link>
                    )}
                </div>
                {canComplete && onComplete && ownerMeet && (
                    <div className="mt-3">
                        <button
                            type="button"
                            disabled={completing}
                            onClick={() => onComplete(meeting.id)}
                            className="w-full px-6 py-2 bg-emerald-600 text-white font-semibold rounded-lg transition-all duration-300 hover:bg-emerald-700 disabled:opacity-50 text-sm"
                        >
                            {completing ? 'Finalizando…' : 'Completar reunión'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
