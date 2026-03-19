import Layout from '@/components/layouts/layout'
import MeetingCard from '@/components/meet/meeting-card'
import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import type { Meeting, MeetingStatus } from '@/types/meeting'
import { Calendar } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
    const [invitedRaw, setInvitedRaw] = useState<MeetingWithIndex[]>([])
    const [created, setCreated] = useState<MeetingWithIndex[]>([])
    const [completing, setCompleting] = useState<Record<string, boolean>>({})
    const now = useMemo<number>(() => Date.now(), [])

    // Controles de filtros compartidos para ambas pestañas
    const [searchTerm, setSearchTerm] = useState<string>('')
    const [statusFilter, setStatusFilter] = useState<MeetingStatus | 'all'>('all')
    const [dateFrom, setDateFrom] = useState<string>('')
    const [dateTo, setDateTo] = useState<string>('')
    const [activeTab, setActiveTab] = useState<'invited' | 'created'>('invited')

    useEffect(() => {
        let cancelled = false
        async function load(): Promise<void> {
            try {
                setLoading(true)
                setError(null)
                if (!database || !user?.uid) {
                    setInvitedRaw([])
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

    /**
     * Aplica los filtros de fecha, estado y búsqueda sobre una lista de reuniones.
     */
    const applyFilters = useCallback((meetings: MeetingWithIndex[]): MeetingWithIndex[] => {
        let result = meetings

        let fromTimestamp: number | null = null
        let toTimestamp: number | null = null

        if (dateFrom) {
            const fromDate = new Date(dateFrom)
            fromTimestamp = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()).getTime()
        }

        if (dateTo) {
            const toDate = new Date(dateTo)
            toTimestamp = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999).getTime()
        }

        if (fromTimestamp !== null || toTimestamp !== null) {
            result = result.filter((meeting) => {
                const start = meeting.startTime
                if (fromTimestamp !== null && start < fromTimestamp) {
                    return false
                }
                if (toTimestamp !== null && start > toTimestamp) {
                    return false
                }
                return true
            })
        }

        if (statusFilter !== 'all') {
            result = result.filter((meeting) => meeting.status === statusFilter)
        }

        const normalizedSearch = searchTerm.trim().toLowerCase()
        if (normalizedSearch.length > 0) {
            result = result.filter((meeting) => {
                const title = meeting.title.toLowerCase()
                const description = (meeting.description ?? '').toLowerCase()
                return title.includes(normalizedSearch) || description.includes(normalizedSearch)
            })
        }

        const sorted = [...result].sort((a, b) => a.startTime - b.startTime)

        return sorted
    }, [dateFrom, dateTo, statusFilter, searchTerm])

    /**
     * Listas visibles según los filtros actuales.
     */
    const invitedVisible = useMemo<MeetingWithIndex[]>(
        () => applyFilters(invitedRaw),
        [invitedRaw, applyFilters]
    )

    const createdVisible = useMemo<MeetingWithIndex[]>(
        () => applyFilters(created),
        [created, applyFilters]
    )

    /**
     * Determina si el usuario actual puede completar una reunión.
     */
    const canUserCompleteMeeting = (meeting: MeetingWithIndex, currentUserId: string | undefined): boolean => {
        if (!currentUserId) {
            return false
        }
        const hasEnded = Date.now() >= meeting.endTime
        const isClosableByStatus = meeting.status === 'closed'
        const isCreator = meeting.createdBy === currentUserId
        const isAlreadyFinalized = meeting.status === 'completed' || meeting.status === 'cancelled'

        return isCreator && (hasEnded || isClosableByStatus) && !isAlreadyFinalized
    }

    /**
     * Completa una reunión en la base de datos correspondiente y sincroniza el estado local.
     */
    const handleCompleteMeeting = async (meeting: MeetingWithIndex): Promise<void> => {
        if (!user?.uid) {
            return
        }

        const meetingId = meeting.id
        setCompleting((prev) => ({ ...prev, [meetingId]: true }))

        try {
            const dbToUse = meeting.source?.url
                ? (await import('@/services/firebase')).getDatabaseForUrl(meeting.source.url)
                : database

            if (!dbToUse) {
                throw new Error('Base de datos no disponible para completar')
            }

            const updated = await completeMeeting(dbToUse, meetingId, user.uid)

            setInvitedRaw((prev) => prev.map((currentMeeting) => (currentMeeting.id === meetingId ? { ...currentMeeting, status: updated.status } : currentMeeting)))
            setCreated((prev) => prev.map((currentMeeting) => (currentMeeting.id === meetingId ? { ...currentMeeting, status: updated.status } : currentMeeting)))
        } catch (exception) {
            console.error('No fue posible completar la reunión:', exception)
        } finally {
            setCompleting((prev) => ({ ...prev, [meetingId]: false }))
        }
    }

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

                    {/* Filtros compartidos */}
                    <section className="bg-card border border-border rounded-lg p-4 space-y-3 mb-4">
                        <h2 className="text-sm font-semibold text-muted-foreground">Filtros</h2>
                        <div className="flex flex-wrap gap-3 items-end">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">Buscar</label>
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                    placeholder="Título o descripción"
                                    className="px-3 py-2 bg-input border border-border rounded text-sm min-w-45"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">Desde</label>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(event) => setDateFrom(event.target.value)}
                                    className="px-3 py-2 bg-input border border-border rounded text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">Hasta</label>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(event) => setDateTo(event.target.value)}
                                    className="px-3 py-2 bg-input border border-border rounded text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">Estado</label>
                                <select
                                    value={statusFilter}
                                    onChange={(event) => setStatusFilter(event.target.value as MeetingStatus | 'all')}
                                    className="px-3 py-2 bg-input border border-border rounded text-sm min-w-40"
                                >
                                    <option value="all">Todos</option>
                                    <option value="draft">Borrador</option>
                                    <option value="scheduled">Programadas</option>
                                    <option value="closed">Cerradas</option>
                                    <option value="completed">Completadas</option>
                                    <option value="cancelled">Canceladas</option>
                                </select>
                            </div>
                        </div>
                    </section>
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
                            </div>
                            {invitedVisible.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {invitedVisible.map((m) => {
                                        const canComplete = canUserCompleteMeeting(m, user?.uid)
                                        return (
                                            <MeetingCard
                                                key={m.id}
                                                meeting={m}
                                                canComplete={canComplete}
                                                completing={completing[m.id]}
                                                onComplete={async () => handleCompleteMeeting(m)}
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
                            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                                <h2 className="text-xl font-bold text-foreground">Creadas por mí</h2>
                            </div>
                            {createdVisible.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {createdVisible.map((m) => {
                                        const canComplete = canUserCompleteMeeting(m, user?.uid)
                                        return (
                                            <MeetingCard
                                                key={m.id}
                                                meeting={m}
                                                canComplete={canComplete}
                                                completing={completing[m.id]}
                                                onComplete={async () => handleCompleteMeeting(m)}
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