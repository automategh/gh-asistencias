import Layout from '@/components/layouts/layout'
import MeetingCard from '@/components/meet/meeting-card'
import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import type { Meeting, MeetingStatus } from '@/types/meeting'
import { Calendar } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { get, ref, query, orderByChild, startAt, limitToFirst, equalTo } from 'firebase/database'

interface UserMeetingIndex {
    readonly meetingId: string
    readonly startTime: number
    readonly status: MeetingStatus
    readonly role: 'attendee' | 'speaker' | 'host'
    readonly inviteStatus: 'invited' | 'accepted' | 'declined'
    readonly attendance?: 'absent' | 'present' | 'late' | null
}

interface MeetingWithIndex extends Meeting {
    readonly index?: UserMeetingIndex | null
}

/**
 * Vista de reuniones: participación y creadas por el usuario.
 * Obtiene índices de `userMeetings/{uid}` para participación y
 * filtra `meetings` por `createdBy` para creadas.
 */
function MeetsPage() {
    const { user } = useAuth()
    const { database } = useDatabase()

    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [mine, setMine] = useState<MeetingWithIndex[]>([])
    const [created, setCreated] = useState<Meeting[]>([])
    const now = useMemo<number>(() => Date.now(), [])

    useEffect(() => {
        let cancelled = false
        async function load(): Promise<void> {
            try {
                setLoading(true)
                setError(null)
                if (!database || !user?.uid) {
                    setMine([])
                    setCreated([])
                    return
                }

                // Participación: próximas (order by startTime)
                const idxSnap = await get(query(ref(database, `userMeetings/${user.uid}`), orderByChild('startTime'), startAt(now), limitToFirst(100)))
                const idxVal = idxSnap.val() as Record<string, UserMeetingIndex> | null
                const indexList = idxVal ? Object.values(idxVal) : []

                const meetings: MeetingWithIndex[] = []
                for (const idx of indexList) {
                    // Filtrar por estado abierto si se desea solo próximas abiertas
                    if (idx.status !== 'scheduled') continue
                    const msnap = await get(ref(database, `meetings/${idx.meetingId}`))
                    const mval = msnap.val() as Meeting | null
                    if (mval) meetings.push({ ...mval, index: idx })
                }

                // Creadas por mí
                const createdSnap = await get(query(ref(database, 'meetings'), orderByChild('createdBy'), equalTo(user.uid)))
                const createdVal = createdSnap.val() as Record<string, Meeting> | null
                const createdList = createdVal ? Object.values(createdVal) : []

                if (!cancelled) {
                    // Ordenar por fecha ascendente
                    setMine(meetings.sort((a, b) => a.startTime - b.startTime))
                    setCreated(createdList.sort((a, b) => a.startTime - b.startTime))
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'No fue posible cargar las reuniones')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        // Ejecutar
        load().catch(() => setError('No fue posible cargar las reuniones'))
        return () => { cancelled = true }
    }, [database, user?.uid, now])

    const EmptyState = (
        <div className="bg-card rounded-2xl border border-border p-6 text-center py-16">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No hay reuniones</h3>
            <p className="text-muted-foreground mb-6">Comienza creando tu primera reunión</p>
            <Link
                to="/new-meeting"
                className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md inline-block"
            >
                Crear Primera Reunión
            </Link>
        </div>
    )

    // Se reemplazan items inline por el componente reutilizable MeetingCard

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-20 backdrop-blur-xl">
                    <nav className="max-w-4xl mx-auto px-6 py-4">
                        <h1 className="text-3xl font-bold mt-4 text-foreground">Reuniones/Capacitaciones</h1>
                    </nav>
                </header>

                <div className="max-w-4xl mx-auto p-6 mt-8 space-y-8">
                    {loading && (
                        <div className="p-3 text-sm text-muted-foreground">Cargando…</div>
                    )}
                    {error && (
                        <div className="p-3 text-sm text-red-600 border border-red-300 rounded">{error}</div>
                    )}

                    <section>
                        <h2 className="text-xl font-bold text-foreground mb-4">Mis próximas reuniones</h2>
                        {mine.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {mine.map((m) => (
                                    <MeetingCard key={m.id} meeting={m} />
                                ))}
                            </div>
                        ) : (
                            EmptyState
                        )}
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-foreground mb-4">Creadas por mí</h2>
                        {created.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {created.map((m) => (
                                    <MeetingCard key={m.id} meeting={m} />
                                ))}
                            </div>
                        ) : (
                            EmptyState
                        )}
                    </section>
                </div>
            </div>
        </Layout>
    )
}

export default MeetsPage