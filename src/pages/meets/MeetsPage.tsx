import Layout from '@/components/layouts/layout'
import MeetingCard from '@/components/meet/meeting-card'
import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import type { Meeting } from '@/types/meeting'
import { Calendar } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
// (sin acceso directo a firebase aquí; se maneja en el servicio)
import { completeMeeting } from '@/services/meetings.service'
import { getUserCreatedMeetings, getUserCreatedMeetingsAcross, getUserInvitedMeetings, getUserInvitedMeetingsAcross, type MeetingWithIndex } from '@/services/meetings.listing.service'
 

// Tipos movidos al servicio: UserMeetingIndex y MeetingWithIndex

/**
 * Vista de reuniones: participación y creadas por el usuario.
 * Obtiene índices de `userMeetings/{uid}` para participación y
 * filtra `meetings` por `createdBy` para creadas.
 */
function MeetsPage() {
    const { user } = useAuth()
    const { database, databaseUrl, isCorporateUser, availableDatabases } = useDatabase()

    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [mine, setMine] = useState<MeetingWithIndex[]>([])
    const [invitedRaw, setInvitedRaw] = useState<MeetingWithIndex[]>([])
    const [created, setCreated] = useState<MeetingWithIndex[]>([])
    const [completing, setCompleting] = useState<Record<string, boolean>>({})
    const now = useMemo<number>(() => Date.now(), [])

    // Controles de filtro/orden para "citadas"
    const [invitedFilter, setInvitedFilter] = useState<'upcoming' | 'all'>('all')
    const [invitedSort, setInvitedSort] = useState<'asc' | 'desc'>('asc')
    const [activeTab, setActiveTab] = useState<'invited' | 'created'>('invited')

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

                const LOOKBACK_MS = 12 * 60 * 60 * 1000

                let invited: MeetingWithIndex[] = []
                let createdList: MeetingWithIndex[] | Meeting[] = []

                if (isCorporateUser && availableDatabases.length > 0) {
                    // Multi-recinto: agrupar de todas las BDs disponibles
                    invited = await getUserInvitedMeetingsAcross(
                        availableDatabases.map((d) => ({ url: d.url, key: d.key })),
                        user.uid,
                        now,
                        LOOKBACK_MS
                    )
                    createdList = await getUserCreatedMeetingsAcross(
                        availableDatabases.map((d) => ({ url: d.url, key: d.key })),
                        user.uid
                    )
                } else {
                    // Una sola base (seleccionada)
                    invited = await getUserInvitedMeetings(database, user.uid, now, LOOKBACK_MS)
                    createdList = await getUserCreatedMeetings(database, user.uid)
                }

                if (!cancelled) {
                    setInvitedRaw(invited)
                    setCreated(
                        [...createdList].sort((a, b) => a.startTime - b.startTime)
                    )
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
    }, [database, databaseUrl, user?.uid, now, isCorporateUser, availableDatabases])

    // Aplica filtro/orden a las citadas sin reconsultar BD
    useEffect(() => {
        const filtered = invitedRaw.filter(m => invitedFilter === 'upcoming' ? (typeof m.endTime === 'number' && m.endTime >= now) : true)
        const sorted = filtered.sort((a, b) => invitedSort === 'desc' ? a.startTime - b.startTime : b.startTime - a.startTime)
        setMine(sorted)
    }, [invitedRaw, invitedFilter, invitedSort, now])

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
                    <div className="border-b border-border mb-4 flex gap-4">
                        <button
                            type="button"
                            onClick={() => setActiveTab('invited')}
                            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === 'invited'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Citadas a mí
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('created')}
                            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === 'created'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Creadas por mí
                        </button>
                    </div>

                    {activeTab === 'invited' && (
                        <section>
                            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                                <h2 className="text-xl font-bold text-foreground">Reuniones a las que me han citado</h2>
                                <div className="flex items-center gap-3">
                                    <label className="text-sm text-muted-foreground">Mostrar</label>
                                    <select
                                        value={invitedFilter}
                                        onChange={(e) => setInvitedFilter(e.target.value as 'upcoming' | 'all')}
                                        className="px-3 py-2 bg-input border border-border rounded text-sm"
                                    >
                                        <option value="upcoming">Próximas y en curso</option>
                                        <option value="all">Todas las citadas (hoy/recientes)</option>
                                    </select>
                                    <label className="text-sm text-muted-foreground">Ordenar</label>
                                    <select
                                        value={invitedSort}
                                        onChange={(e) => setInvitedSort(e.target.value as 'asc' | 'desc')}
                                        className="px-3 py-2 bg-input border border-border rounded text-sm"
                                    >
                                        <option value="asc">Más próximas primero</option>
                                        <option value="desc">Más recientes primero</option>
                                    </select>
                                </div>
                            </div>
                            {mine.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {mine.map((m) => {
                                        const canComplete = (() => {
                                            const ended = Date.now() >= m.endTime
                                            const canByStatus = m.status === 'closed'
                                            return (m.createdBy === user?.uid) && (ended || canByStatus) && m.status !== 'completed' && m.status !== 'cancelled'
                                        })()
                                        return (
                                            <MeetingCard
                                                key={m.id}
                                                meeting={m}
                                                canComplete={canComplete}
                                                completing={completing[m.id]}
                                                onComplete={async (meetingId) => {
                                                    if (!user?.uid) return
                                                    setCompleting((prev) => ({ ...prev, [meetingId]: true }))
                                                    try {
                                                        // Si el item proviene de otro recinto, completar en esa BD
                                                        const dbToUse = (m as MeetingWithIndex).source?.url
                                                            ? (await import('@/services/firebase')).getDatabaseForUrl((m as MeetingWithIndex).source!.url)
                                                            : database
                                                        if (!dbToUse) throw new Error('Base de datos no disponible para completar')
                                                        const updated = await completeMeeting(dbToUse, meetingId, user.uid)
                                                        // Actualiza en listas locales
                                                        setMine((prev) => prev.map((mm) => (mm.id === meetingId ? { ...mm, status: updated.status } : mm)))
                                                        setCreated((prev) => prev.map((mm) => (mm.id === meetingId ? { ...mm, status: updated.status } : mm)))
                                                    } catch (e) {
                                                        console.error('No fue posible completar la reunión:', e)
                                                    } finally {
                                                        setCompleting((prev) => ({ ...prev, [meetingId]: false }))
                                                    }
                                                }}
                                            />
                                        )
                                    })}
                                </div>
                            ) : (
                                EmptyState
                            )}
                        </section>
                    )}

                    {activeTab === 'created' && (
                        <section>
                            <h2 className="text-xl font-bold text-foreground mb-4">Creadas por mí</h2>
                            {created.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {created.map((m) => {
                                        const canComplete = (() => {
                                            const ended = Date.now() >= m.endTime
                                            const canByStatus = m.status === 'closed'
                                            return (m.createdBy === user?.uid) && (ended || canByStatus) && m.status !== 'completed' && m.status !== 'cancelled'
                                        })()
                                        return (
                                            <MeetingCard
                                                key={m.id}
                                                meeting={m}
                                                canComplete={canComplete}
                                                completing={completing[m.id]}
                                                onComplete={async (meetingId) => {
                                                    if (!user?.uid) return
                                                    setCompleting((prev) => ({ ...prev, [meetingId]: true }))
                                                    try {
                                                        const dbToUse = (m as MeetingWithIndex).source?.url
                                                            ? (await import('@/services/firebase')).getDatabaseForUrl((m as MeetingWithIndex).source!.url)
                                                            : database
                                                        if (!dbToUse) throw new Error('Base de datos no disponible para completar')
                                                        const updated = await completeMeeting(dbToUse, meetingId, user.uid)
                                                        setMine((prev) => prev.map((mm) => (mm.id === meetingId ? { ...mm, status: updated.status } : mm)))
                                                        setCreated((prev) => prev.map((mm) => (mm.id === meetingId ? { ...mm, status: updated.status } : mm)))
                                                    } catch (e) {
                                                        console.error('No fue posible completar la reunión:', e)
                                                    } finally {
                                                        setCompleting((prev) => ({ ...prev, [meetingId]: false }))
                                                    }
                                                }}
                                            />
                                        )
                                    })}
                                </div>
                            ) : (
                                EmptyState
                            )}
                        </section>
                    )}
                </div>
            </div>
        </Layout>
    )
}

export default MeetsPage