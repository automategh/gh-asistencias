import Layout from '@/components/layouts/layout'
import MeetingsTabContent from '@/pages/meets/components/meetings-tab-content'
import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import type { Meeting, MeetingKind, MeetingStatus } from '@/types/meeting'
import { Calendar, ChevronDown, Search, ShieldCheckIcon, TagIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
// (sin acceso directo a firebase aquí; se maneja en el servicio)
import { completeMeeting } from '@/services/meetings.service'
import { getAllMeetings, getUserCreatedMeetings, getUserCreatedMeetingsAcross, getUserInvitedMeetings, getUserInvitedMeetingsAcross, type MeetingWithIndex } from '@/services/meetings.listing.service'


// Tipos movidos al servicio: UserMeetingIndex y MeetingWithIndex

const ALL_MEETING_STATUSES: ReadonlyArray<MeetingStatus> = [
    'draft',
    'scheduled',
    'closed',
    'completed',
    'cancelled',
]

const PAGE_SIZE = 9

/**
 * Vista de reuniones: participación y creadas por el usuario.
 * Obtiene índices de `userMeetings/{uid}` para participación y
 * filtra `meetings` por `createdBy` para creadas.
 */
function MeetsPage() {
    const { user, roleId } = useAuth()
    const { database, databaseUrl, availableDatabases } = useDatabase()
    const navigate = useNavigate()

    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [invitedRaw, setInvitedRaw] = useState<MeetingWithIndex[]>([])
    const [created, setCreated] = useState<MeetingWithIndex[]>([])
    const [allMeetings, setAllMeetings] = useState<MeetingWithIndex[]>([])
    const [completing, setCompleting] = useState<Record<string, boolean>>({})
    const now = useMemo<number>(() => Date.now(), [])
    const canViewAllTab = roleId === 'admin' || roleId === 'hr'

    // Controles de filtros compartidos para ambas pestañas
    const [searchTerm, setSearchTerm] = useState<string>('')
    const [statusFilter, setStatusFilter] = useState<MeetingStatus | 'all'>('all')
    const [meetingTypeFilter, setMeetingTypeFilter] = useState<MeetingKind | 'all'>('all')
    const [dateFrom, setDateFrom] = useState<string>('')
    const [dateTo, setDateTo] = useState<string>('')
    const [isDateDropdownOpen, setIsDateDropdownOpen] = useState<boolean>(false)
    const [activeTab, setActiveTab] = useState<'invited' | 'created' | 'all'>('invited')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [invitedPage, setInvitedPage] = useState<number>(1)
    const [createdPage, setCreatedPage] = useState<number>(1)
    const [allPage, setAllPage] = useState<number>(1)

    const buildMeetingPath = (basePath: '/meeting' | '/checkin', meeting: MeetingWithIndex): string => {
        if (!meeting.source?.url) {
            return `${basePath}/${meeting.id}`
        }

        return `${basePath}/${meeting.id}?db=${encodeURIComponent(meeting.source.url)}`
    }

    const getMeetingKey = useCallback((meeting: MeetingWithIndex): string => {
        const sourceKey = meeting.source?.url ?? 'current-db'
        return `${sourceKey}::${meeting.id}`
    }, [])

    const isSameMeeting = useCallback((first: MeetingWithIndex, second: MeetingWithIndex): boolean => {
        return getMeetingKey(first) === getMeetingKey(second)
    }, [getMeetingKey])

    const openMeetingDetails = (meeting: MeetingWithIndex): void => {
        navigate(buildMeetingPath('/meeting', meeting))
    }

    const openMeetingCheckin = (meeting: MeetingWithIndex): void => {
        navigate(buildMeetingPath('/checkin', meeting))
    }

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
                let allList: MeetingWithIndex[] = []

                if (availableDatabases.length > 0) {
                    // Multi-recinto: agrupar de todas las BDs disponibles para cualquier usuario.
                    invited = await getUserInvitedMeetingsAcross(
                        availableDatabases.map((d) => ({ url: d.url, key: d.key })),
                        user.uid,
                        now,
                        LOOKBACK_MS,
                        ALL_MEETING_STATUSES
                    )
                    createdList = await getUserCreatedMeetingsAcross(
                        availableDatabases.map((d) => ({ url: d.url, key: d.key })),
                        user.uid
                    )
                } else {
                    // Fallback: una sola base (seleccionada)
                    invited = await getUserInvitedMeetings(database, user.uid, now, LOOKBACK_MS, ALL_MEETING_STATUSES)
                    createdList = await getUserCreatedMeetings(database, user.uid)
                }

                if (canViewAllTab) {
                    const singleDatabaseMeetings = await getAllMeetings(database)
                    allList = singleDatabaseMeetings.map((meeting) => ({ ...meeting, index: null, source: null }))
                }

                if (!cancelled) {
                    setInvitedRaw(invited)
                    setCreated(
                        [...createdList].sort((a, b) => a.startTime - b.startTime)
                    )
                    setAllMeetings(allList)
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'No fue posible cargar las actividades')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        // Ejecutar
        load().catch(() => setError('No fue posible cargar las actividades'))
        return () => { cancelled = true }
    }, [database, databaseUrl, user?.uid, now, availableDatabases, canViewAllTab])

    // Reiniciar paginación cuando cambian filtros o datos base
    useEffect(() => {
        setInvitedPage(1)
        setCreatedPage(1)
        setAllPage(1)
    }, [searchTerm, statusFilter, meetingTypeFilter, dateFrom, dateTo, invitedRaw.length, created.length, allMeetings.length])

    useEffect(() => {
        if (!canViewAllTab && activeTab === 'all') {
            setActiveTab('invited')
        }
    }, [canViewAllTab, activeTab])

    /**
     * Aplica los filtros de fecha, estado y búsqueda sobre una lista de actividades.
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

        if (meetingTypeFilter !== 'all') {
            result = result.filter((meeting) => meeting.type === meetingTypeFilter)
        }

        const normalizedSearch = searchTerm.trim().toLowerCase()
        if (normalizedSearch.length > 0) {
            result = result.filter((meeting) => {
                const title = meeting.title.toLowerCase()
                const description = (meeting.description ?? '').toLowerCase()
                return title.includes(normalizedSearch) || description.includes(normalizedSearch)
            })
        }
        const sorted = [...result].sort((a, b) => b.startTime - a.startTime)

        return sorted
    }, [dateFrom, dateTo, statusFilter, meetingTypeFilter, searchTerm])

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

    const allVisible = useMemo<MeetingWithIndex[]>(
        () => applyFilters(allMeetings),
        [allMeetings, applyFilters]
    )

    function formatDateTimeLabel(timestamp: number): string {
        const date = new Date(timestamp)
        const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        return `${date.toLocaleDateString()} ${time}`
    }

    function getStatusPill(status: MeetingStatus): { label: string; className: string } {
        switch (status) {
            case 'scheduled':
                return { label: 'Próxima', className: 'bg-blue-100 text-blue-700' }
            case 'closed':
                return { label: 'Cerrada', className: 'bg-muted text-muted-foreground' }
            case 'completed':
                return { label: 'Finalizada', className: 'bg-emerald-100 text-emerald-700' }
            case 'cancelled':
                return { label: 'Cancelada', className: 'bg-muted text-muted-foreground' }
            case 'draft':
            default:
                return { label: 'Borrador', className: 'bg-muted text-muted-foreground' }
        }
    }

    /** Determina si el usuario actual puede completar una actividad. */
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

    /** Completa una actividad en la base de datos correspondiente y sincroniza el estado local. */
    const handleCompleteMeeting = async (meeting: MeetingWithIndex): Promise<void> => {
        if (!user?.uid) {
            return
        }

        const meetingId = meeting.id
        const meetingKey = getMeetingKey(meeting)
        setCompleting((prev) => ({ ...prev, [meetingKey]: true }))

        try {
            const dbToUse = meeting.source?.url
                ? (await import('@/services/firebase')).getDatabaseForUrl(meeting.source.url)
                : database

            if (!dbToUse) {
                throw new Error('Base de datos no disponible para completar')
            }

            const updated = await completeMeeting(dbToUse, meetingId, user.uid)

            const updatedMeeting: MeetingWithIndex = {
                ...meeting,
                ...updated,
            }

            setInvitedRaw((prev) => prev.map((currentMeeting) => (isSameMeeting(currentMeeting, meeting) ? { ...currentMeeting, status: updatedMeeting.status } : currentMeeting)))
            setCreated((prev) => prev.map((currentMeeting) => (isSameMeeting(currentMeeting, meeting) ? { ...currentMeeting, status: updatedMeeting.status } : currentMeeting)))
            setAllMeetings((prev) => prev.map((currentMeeting) => (isSameMeeting(currentMeeting, meeting) ? { ...currentMeeting, status: updatedMeeting.status } : currentMeeting)))
        } catch (exception) {
            console.error('No fue posible completar la actividad:', exception)
        } finally {
            setCompleting((prev) => ({ ...prev, [meetingKey]: false }))
        }
    }

    const EmptyState = (
        <div className="bg-card rounded-2xl p-6 text-center py-16">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No hay actividades</h3>
            <p className="text-muted-foreground mb-6">Comienza creando tu primera actividad</p>
            <Link
                to="/new-meeting"
                className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md inline-block"
            >
                Crear Primera Actividad
            </Link>
        </div>
    )

    // Se reemplazan items inline por el componente reutilizable MeetingCard

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className='px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto'>
                        <div className='flex justify-between items-center'>
                            <div>
                                <h1 className="text-3xl font-bold tracking-tight">Actividades</h1>
                                <p className="font-body text-[#434843] text-sm mt-1">Visualiza y coordina tus próximas sesiones.</p>
                            </div>
                            <div>
                                <div className="flex bg-[#edeeed] p-1 rounded-xl shadow-sm">
                                    <button
                                        onClick={() => {
                                            setViewMode('grid')
                                        }}
                                        className={`px-4 py-2 text-sm cursor-pointer font-medium transition-colors rounded-lg ${viewMode === 'grid'
                                            ? 'bg-white text-[#1b3022] font-bold'
                                            : 'text-[#434843] hover:text-[#1b3022]'
                                            }`}>
                                        Vista de cuadricula
                                    </button>
                                    <button
                                        onClick={() => {
                                            setViewMode('list')
                                        }}
                                        className={`px-4 py-2 text-sm cursor-pointer rounded-lg font-medium transition-colors ${viewMode === 'list'
                                            ? 'bg-white text-[#1b3022] font-bold'
                                            : 'text-[#434843] hover:text-[#1b3022]'
                                            }`}>
                                        Vista de lista
                                    </button>
                                </div>
                            </div>
                        </div>
                    </nav>
                </header>

                <div className='px-4 md:px-12 py-5 space-y-10'>
                    <div className="max-w-7xl mx-auto">


                        <div className="mb-4 flex gap-4">
                            <button
                                type="button"
                                onClick={() => setActiveTab('invited')}
                                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'invited'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                Citadas a mí
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('created')}
                                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'created'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                Creadas por mí
                            </button>
                            {canViewAllTab && (
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('all')}
                                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'all'
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    Todas
                                </button>
                            )}
                        </div>

                        <div className='bg-[#f3f4f3] rounded-xl p-4 my-8 flex  items-center gap-4'>

                            <div className="flex-1 min-w-50 relative">
                                <Search className='absolute left-3 top-1/2 -translate-y-1/2 text-outline' />
                                <input
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                    placeholder="Título o descripción"
                                    className="w-full bg-white border-none rounded-lg pl-10 py-2.5 text-sm focus:ring-2 focus:ring-[#1b3022]/20"
                                    type="text" />
                            </div>

                            <div className="flex gap-4">
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setIsDateDropdownOpen((prev) => !prev)}
                                        className="bg-surface-container-lowest rounded-lg px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-white transition-colors text-left"
                                    >
                                        <Calendar className='text-outline text-lg' />
                                        <span className="text-sm font-medium">Rango de fechas</span>
                                        <ChevronDown className='text-outline text-lg' />
                                    </button>

                                    {isDateDropdownOpen && (
                                        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg p-3 z-20">
                                            <p className="text-xs font-semibold text-muted-foreground mb-2">Filtrar por rango de fechas</p>
                                            <div className="flex flex-col gap-2">
                                                <label className=" flex flex-col gap-1 text-xs text-muted-foreground">
                                                    <span>Desde</span>
                                                    <input
                                                        type="date"
                                                        value={dateFrom}
                                                        onChange={(event) => setDateFrom(event.target.value)}
                                                        className="px-2 py-1.5 bg-[#f3f4f3] rounded-lg text-xs"
                                                    />
                                                </label>
                                                <label className=" flex flex-col gap-1 text-xs text-muted-foreground">
                                                    <span>Hasta</span>
                                                    <input
                                                        type="date"
                                                        value={dateTo}
                                                        onChange={(event) => setDateTo(event.target.value)}
                                                        className="px-2 py-1.5 bg-[#f3f4f3] rounded-lg text-xs"
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="relative group cursor-pointer">
                                    <div className="bg-surface-container-lowest rounded-lg px-3 py-2 flex items-center gap-2 cursor-pointer group-hover:bg-white transition-colors select-none">
                                        <ShieldCheckIcon className='text-outline text-lg' />
                                        <span className="text-sm font-medium">Estado</span>
                                        <ChevronDown className='text-outline text-lg' />
                                    </div>
                                    <select
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-sm px-2.5"
                                        value={statusFilter}
                                        onChange={(event) => setStatusFilter(event.target.value as MeetingStatus | 'all')}
                                    >
                                        <option value="all">Todos</option>
                                        <option value="draft">Borrador</option>
                                        <option value="scheduled">Programadas</option>
                                        <option value="closed">Cerradas</option>
                                        <option value="completed">Completadas</option>
                                        <option value="cancelled">Canceladas</option>
                                    </select>
                                </div>

                                <div className="relative group cursor-pointer">
                                    <div className="bg-surface-container-lowest rounded-lg px-3 py-2 flex items-center gap-2 select-none transition-colors group-hover:bg-white">
                                        <TagIcon className='text-outline text-lg' />
                                        <span className="text-sm font-medium">Tipo</span>
                                        <ChevronDown className='text-outline text-lg' />
                                    </div>
                                    <select
                                        value={meetingTypeFilter}
                                        onChange={(event) => setMeetingTypeFilter(event.target.value as MeetingKind | 'all')}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-sm px-2.5"
                                    >
                                        <option value="all">Todos</option>
                                        <option value="meeting">Reunión</option>
                                        <option value="training">Capacitación</option>
                                        <option value="custom">Personalizado</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {loading && (
                        <div className="p-3 text-sm text-muted-foreground">Cargando…</div>
                    )}
                    {error && (
                        <div className="p-3 text-sm text-red-600 border border-red-300 rounded">{error}</div>
                    )}
                    <div className='max-w-7xl mx-auto'>
                        {activeTab === 'invited' && (
                            <section>
                                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                                    <h2 className="text-xl font-bold text-foreground">Actividades a las que me han citado</h2>
                                </div>
                                <MeetingsTabContent
                                    title="Citadas a mi"
                                    items={invitedVisible}
                                    viewMode={viewMode}
                                    page={invitedPage}
                                    setPage={setInvitedPage}
                                    pageSize={PAGE_SIZE}
                                    userUid={user?.uid}
                                    completing={completing}
                                    onCompleteMeeting={handleCompleteMeeting}
                                    onOpenDetails={openMeetingDetails}
                                    onOpenCheckin={openMeetingCheckin}
                                    canUserCompleteMeeting={canUserCompleteMeeting}
                                    buildMeetingPath={buildMeetingPath}
                                    formatDateTimeLabel={formatDateTimeLabel}
                                    getStatusPill={getStatusPill}
                                    getMeetingKey={getMeetingKey}
                                    emptyState={EmptyState}
                                />
                            </section>
                        )}

                        {activeTab === 'created' && (
                            <section>
                                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                                    <h2 className="text-xl font-bold text-foreground">Creadas por mi</h2>
                                </div>
                                <MeetingsTabContent
                                    title="Creadas por mi"
                                    items={createdVisible}
                                    viewMode={viewMode}
                                    page={createdPage}
                                    setPage={setCreatedPage}
                                    pageSize={PAGE_SIZE}
                                    userUid={user?.uid}
                                    completing={completing}
                                    onCompleteMeeting={handleCompleteMeeting}
                                    onOpenDetails={openMeetingDetails}
                                    onOpenCheckin={openMeetingCheckin}
                                    canUserCompleteMeeting={canUserCompleteMeeting}
                                    buildMeetingPath={buildMeetingPath}
                                    formatDateTimeLabel={formatDateTimeLabel}
                                    getStatusPill={getStatusPill}
                                    getMeetingKey={getMeetingKey}
                                    emptyState={EmptyState}
                                />
                            </section>
                        )}

                        {activeTab === 'all' && canViewAllTab && (
                            <section>
                                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                                    <h2 className="text-xl font-bold text-foreground">Todas las actividades</h2>
                                </div>
                                <MeetingsTabContent
                                    title="Todas"
                                    items={allVisible}
                                    viewMode={viewMode}
                                    page={allPage}
                                    setPage={setAllPage}
                                    pageSize={PAGE_SIZE}
                                    userUid={user?.uid}
                                    completing={completing}
                                    onCompleteMeeting={handleCompleteMeeting}
                                    onOpenDetails={openMeetingDetails}
                                    onOpenCheckin={openMeetingCheckin}
                                    canUserCompleteMeeting={canUserCompleteMeeting}
                                    buildMeetingPath={buildMeetingPath}
                                    formatDateTimeLabel={formatDateTimeLabel}
                                    getStatusPill={getStatusPill}
                                    getMeetingKey={getMeetingKey}
                                    emptyState={EmptyState}
                                />
                            </section>
                        )}
                    </div>


                </div>

            </div>
        </Layout >
    )
}

export default MeetsPage