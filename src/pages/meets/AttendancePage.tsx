import Layout from '@/components/layouts/layout'
import { useDatabase } from '@/context/DatabaseContext'
import { Check, Users, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { get, ref } from 'firebase/database'
import type { MeetingParticipant, Meeting, ParticipantRole } from '@/types/meeting'
import { getMeetingById } from '@/services/meetings.service'

/**
 * Página de asistencia de reunión.
 * Carga participantes desde `meetingParticipants/{id}` y muestra
 * su estado de invitación y asistencia.
 */
function AttendancePage() {
    const { id } = useParams<{ id: string }>()
    const { database } = useDatabase()

    const [meeting, setMeeting] = useState<Meeting | null>(null)
    const [attendance, setAttendance] = useState<MeetingParticipant[]>([])
    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        async function load(): Promise<void> {
            try {
                setLoading(true)
                setError(null)
                if (!database || !id) {
                    setAttendance([])
                    setMeeting(null)
                    return
                }

                // Carga reunión (para título)
                try {
                    const m = await getMeetingById(database, id)
                    if (!cancelled) setMeeting(m)
                } catch {
                    // Si no existe, continúa con asistencia sin título
                }

                // Carga asistentes
                const snap = await get(ref(database, `meetingParticipants/${id}`))
                if (cancelled) return
                const val = snap.val() as Record<string, MeetingParticipant> | null
                const list = val ? Object.values(val) : []
                list.sort((a, b) => a.name.localeCompare(b.name))
                setAttendance(list)
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'No fue posible cargar la asistencia')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load().catch(() => setError('No fue posible cargar la asistencia'))
        return () => { cancelled = true }
    }, [database, id])

    /**
     * Métricas derivadas de la lista de asistencia.
     */
    const presentCount = useMemo<number>(() => attendance.filter(a => a.attendance === 'present').length, [attendance])
    const absentCount = useMemo<number>(() => attendance.filter(a => a.attendance === 'absent').length, [attendance])
    const lateCount = useMemo<number>(() => attendance.filter(a => a.attendance === 'late').length, [attendance])

    const switchRoles = (role: ParticipantRole) => {
        switch (role) {
            case 'attendee':
                return 'Asistente'
            case 'speaker':
                return 'Orador'
            case 'host':
                return 'Anfitrión'
            default:
                return 'Asistente'
        }
    }

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-20 backdrop-blur-xl">
                    <nav className="max-w-6xl mx-auto px-6 py-4">
                        <h1 className="text-3xl font-bold mt-4 text-foreground">Asistencia: {meeting?.title ?? '—'}</h1>
                    </nav>
                </header>
                <div className="max-w-6xl mx-auto p-6 mt-8">
                    {/* Estados de carga/errores */}
                    {loading && (
                        <div className="p-3 text-sm text-muted-foreground">Cargando…</div>
                    )}
                    {error && (
                        <div className="p-3 text-sm text-red-600 border border-red-300 rounded">{error}</div>
                    )}
                    {/* Estadísticas */}
                    <div className="grid md:grid-cols-4 gap-6 mb-8">
                        <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg">
                            <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider font-semibold">Total</p>
                            <p className="text-4xl font-bold text-primary">{attendance.length}</p>
                        </div>
                        <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg">
                            <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider font-semibold">Presentes</p>
                            <p className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">{presentCount}</p>
                        </div>
                        <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg">
                            <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider font-semibold">Ausentes</p>
                            <p className="text-4xl font-bold text-red-600 dark:text-red-400">{absentCount}</p>
                        </div>
                        <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg">
                            <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider font-semibold">Tarde</p>
                            <p className="text-4xl font-bold text-amber-600 dark:text-amber-400">{lateCount}</p>
                        </div>
                    </div>

                    {/* Tabla de asistencia */}
                    <div className="bg-card rounded-2xl border border-border p-6 overflow-x-auto">
                        <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                            <Users className="w-5 h-5" />
                            Registro de Asistencia
                        </h2>
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-3 px-4 font-semibold text-foreground">Nombre</th>
                                    <th className="text-left py-3 px-4 font-semibold text-foreground">Correo</th>
                                    <th className="text-center py-3 px-4 font-semibold text-foreground">Rol</th>
                                    <th className="text-center py-3 px-4 font-semibold text-foreground">Invitación</th>
                                    <th className="text-center py-3 px-4 font-semibold text-foreground">Estado</th>
                                    <th className="text-center py-3 px-4 font-semibold text-foreground">Método</th>
                                    <th className="text-center py-3 px-4 font-semibold text-foreground">Hora de Ingreso</th>
                                </tr>
                            </thead>
                            <tbody>
                                {attendance.length === 0 ? (
                                    <tr>
                                        <td className="py-3 px-4 text-muted-foreground" colSpan={6}>Sin registros</td>
                                    </tr>
                                ) : (
                                    attendance.map(a => (
                                        <tr key={a.uid} className="border-b border-border last:border-b-0">
                                            <td className="py-3 px-4 text-foreground font-medium">{a.name}</td>
                                            <td className="py-3 px-4 text-muted-foreground">{a.email}</td>
                                            <td className="py-3 px-4 text-foreground capitalize text-center">
                                                {switchRoles(a.role)}
                                            </td>
                                            <td className='text-center'>
                                                <div className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center justify-center gap-1 ${a.attendance === "present"
                                                    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                                                    : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                                    }`}>
                                                    {a.attendance === "present" ? (
                                                        <>
                                                            <Check className="w-3 h-3" />
                                                            Presente
                                                        </>
                                                    ) : (
                                                        <>
                                                            <X className="w-3 h-3" />
                                                            Ausente
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-foreground text-center capitalize">{a.attendance ?? '—'}</td>
                                            <td className="py-3 px-4 text-foreground text-center capitalize">{a.checkinMethod ?? '—'}</td>
                                            <td className="py-3 px-4 text-foreground text-center">{typeof a.checkedInAt === 'number' ? new Date(a.checkedInAt).toLocaleString('es-ES') : '—'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default AttendancePage