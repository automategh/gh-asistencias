import Layout from '@/components/layouts/layout'
import { useDatabase } from '@/context/DatabaseContext'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { get, ref } from 'firebase/database'
import type { MeetingParticipant, Meeting, ParticipantRole } from '@/types/meeting'
import { getMeetingById } from '@/services/meetings.service'

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

                try {
                    const m = await getMeetingById(database, id)
                    if (!cancelled) setMeeting(m)
                } catch {/* Ignorar error de carga de reunión, puede que solo queramos mostrar la asistencia */ }

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

    const switchRoles = (role: ParticipantRole) => {
        switch (role) {
            case 'attendee': return 'Asistente'
            case 'speaker': return 'Orador'
            case 'host': return 'Anfitrión'
            default: return 'Asistente'
        }
    }

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/10 to-background">
                <header className="bg-card/80 border-b border-border shadow-sm sticky top-0 z-20 backdrop-blur-xl">
                    <nav className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                            Asistencia: <span className="font-semibold text-muted-foreground">{meeting?.title ?? '—'}</span>
                        </h1>
                    </nav>
                </header>

                {loading && <div className="px-4 pt-4 text-sm text-muted-foreground">Cargando…</div>}
                {error && <div className="px-4 pt-4 text-sm text-red-600">{error}</div>}

                <div className="max-w-sm md:max-w-7xl mx-auto mt-10 px-2 sm:px-4 pb-10">
                    <div className="bg-card border border-border rounded-2xl shadow-xl px-4 sm:px-8 py-6 sm:py-8 overflow-x-auto">



                        {/* HEADER DOCUMENTO */}
                        <div className="flex justify-between items-center gap-6 mb-8">
                            <div className="w-28 sm:w-32 md:w-40  aspect-video">
                                <img
                                    src="/Logo-heroica-green.png"
                                    alt="logo grupo heroica"
                                    className="w-full object-cover drop-shadow-sm"
                                />
                            </div>
                            {/* TÍTULO */}
                            <h2 className="text-center font-extrabold text-lg sm:text-xl tracking-wide text-foreground">
                                REGISTRO DE ASISTENCIA
                            </h2>
                            <div className=''>
                            </div>
                        </div>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs sm:text-sm mb-6">
                            <div className="space-y-1 text-left">
                                <p>
                                    <span className="font-semibold">Tema:</span>{' '}
                                    {meeting?.title ?? '__________'}
                                </p>
                                <p>
                                    <span className="font-semibold">Dirige:</span>{' '}
                                    {'__________'}
                                </p>
                            </div>

                            <div className="space-y-1 text-left">
                                <p>
                                    <span className="font-semibold">Fecha:</span>{' '}
                                    {meeting?.startTime ?? '__________'}
                                </p>
                                <p>
                                    <span className="font-semibold">Hora inicio:</span>{' '}
                                    {meeting?.startTime ?? '__________'}{' '}{' '}
                                    <span className="font-semibold">Hora final:</span>{' '}
                                    {meeting?.endTime ?? '__________'}
                                </p>
                            </div>
                        </div>

                        {/* TABLA */}
                        <div className="overflow-x-auto rounded-xl border border-border bg-background/60 shadow-sm">
                            <table className="w-full min-w-215 text-xs sm:text-sm border-collapse">
                                <thead>
                                    <tr className="bg-muted/80 text-foreground">
                                        <th className="border-b border-border px-3 py-2 text-left font-semibold">Nombre</th>
                                        <th className="border-b border-border px-3 py-2 text-left font-semibold">Cédula</th>
                                        <th className="border-b border-border px-3 py-2 text-left font-semibold">Empresa</th>
                                        <th className="border-b border-border px-3 py-2 text-left font-semibold">Cargo</th>
                                        <th className="border-b border-border px-3 py-2 text-left font-semibold">Firma</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {attendance.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="text-center py-4 text-muted-foreground">
                                                Sin registros
                                            </td>
                                        </tr>
                                    ) : (
                                        attendance.map((a, index) => (
                                            <tr
                                                key={a.uid}
                                                className={index % 2 === 0 ? 'bg-background' : 'bg-muted/40'}
                                            >
                                                <td className="px-3 py-3 text-foreground align-top wrap-break-word">{a.name}</td>
                                                <td className="px-3 py-3 text-foreground align-top wrap-break-word">{a.email}</td>
                                                <td className="px-3 py-3 text-foreground align-top">{'—'}</td>
                                                <td className="px-3 py-3 text-foreground align-top">{switchRoles(a.role)}</td>
                                                <td className="px-3 py-6 align-top">
                                                    <div className="h-8 border-b border-dashed border-border/70" />
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