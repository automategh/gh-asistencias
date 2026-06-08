import Layout from '@/components/layouts/layout'
import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import { getMeetingById, updateMeeting, getMeetingParticipants, syncMeetingParticipants } from '@/services/meetings.service'
import { getSurveys, type Survey } from '@/services/forms.service'
import { getDatabaseForUrl } from '@/services/firebase'
import type { Meeting, MeetingCreateInput, ParticipantInput, ParticipantRole } from '@/types/meeting'
import { listAllUsersAcrossDatabases } from '@/services/roles.service'
import { getUserGroupingConfig, type UserGroupingConfig } from '@/services/user-grouping.service'
import type { RecintoKey } from '@/lib/firebase/databaseResolver'
import { buildUserGroups, buildUserGroupsByField, getUserGroupingDefinitions, type GroupingFieldKey, type UserGroupingId } from '@/lib/userGrouping'
import { createTeamsMeetingViaCloudFunction, updateTeamsMeetingViaCloudFunction } from '@/services/teams.service'
import { Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

const INITIAL_FORM_STATE: MeetingCreateInput = {
    title: '',
    type: 'meeting',
    customType: '',
    satisfactionSurveyId: '',
    description: '',
    location: '',
    startTime: 0,
    endTime: 0,
    trainerName: '',
}

function pad(value: number): string {
    return String(value).padStart(2, '0')
}

function toEpochMs(datetimeLocal: string): number {
    if (!datetimeLocal) return NaN
    const [datePart, timePart] = datetimeLocal.split('T')
    if (!datePart || !timePart) return NaN
    const [year, month, day] = datePart.split('-').map(Number)
    const [hours, minutes] = timePart.split(':').map(Number)
    if ([year, month, day, hours, minutes].some((n) => Number.isNaN(n))) return NaN
    return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime()
}

function formatDateTimeLocal(epoch: number): string {
    const date = new Date(epoch)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function EditMeetPage() {
    const { id } = useParams<{ id: string }>()
    const [searchParams] = useSearchParams()
    const sourceDatabaseUrl = searchParams.get('db')
    const { database } = useDatabase()
    const { user, hasPermission } = useAuth()
    const navigate = useNavigate()

    const [meeting, setMeeting] = useState<Meeting | null>(null)
    const originalModalityRef = useRef<{ isOnlineMeeting: boolean; location: string } | null>(null)
    const [form, setForm] = useState<MeetingCreateInput>({ ...INITIAL_FORM_STATE, isOnlineMeeting: false })
    const [trainingSurveys, setTrainingSurveys] = useState<Survey[]>([])
    const [allUsers, setAllUsers] = useState<UserItem[]>([])
    const [search, setSearch] = useState<string>('')
    const [groupBy, setGroupBy] = useState<UserGroupingId>('none')
    const [selectedParticipants, setSelectedParticipants] = useState<ParticipantInput[]>([])
    type UserItem = {
        uid: string
        name: string
        email: string
        recinto: RecintoKey
        department?: string | null
        immediateBoss?: string | null
        cargo?: string | null
        companyName?: string | null
    }

    type SelectableGrouping = {
        readonly id: UserGroupingId
        readonly label: string
        readonly kind: 'builtin' | 'byField'
        readonly fieldKey?: GroupingFieldKey
    }

    const [availableGroupings, setAvailableGroupings] = useState<SelectableGrouping[]>([])
    const [loading, setLoading] = useState<boolean>(true)
    const [submitting, setSubmitting] = useState<boolean>(false)
    const [creatingTeams, setCreatingTeams] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    const helperFieldClassName = 'w-full bg-[#fcfcfb] border border-[#edeeed] rounded-xl py-3 px-4 text-sm text-[#191c1c] placeholder:text-[#8b918d] focus:outline-none focus:ring-2 focus:ring-primary-container'
    const listContainerClassName = 'mt-3 h-80 overflow-y-auto border border-[#edeeed] rounded-2xl bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]'

    const meetingDatabase = useMemo(() => {
        if (sourceDatabaseUrl) {
            const resolved = getDatabaseForUrl(sourceDatabaseUrl)
            if (resolved) return resolved
        }
        return database
    }, [database, sourceDatabaseUrl])

    useEffect(() => {
        let cancelled = false

        async function loadUsers(): Promise<void> {
            if (!meetingDatabase) {
                setAllUsers([])
                return
            }

            try {
                const users = await listAllUsersAcrossDatabases()
                if (cancelled) return
                setAllUsers(users)
            } catch {
                if (!cancelled) {
                    setAllUsers([])
                }
            }
        }

        async function loadGroupings(): Promise<void> {
            if (!meetingDatabase) {
                const defaults: SelectableGrouping[] = getUserGroupingDefinitions().map((definition) => ({
                    id: definition.id as UserGroupingId,
                    label: definition.label,
                    kind: 'builtin',
                }))
                if (!cancelled) {
                    setAvailableGroupings(defaults)
                }
                return
            }

            try {
                const config: UserGroupingConfig | null = await getUserGroupingConfig(meetingDatabase)
                const items = config?.items ?? []

                const builtinMap = new Map<UserGroupingId, SelectableGrouping>()
                getUserGroupingDefinitions().forEach((definition) => {
                    builtinMap.set(definition.id as UserGroupingId, {
                        id: definition.id as UserGroupingId,
                        label: definition.label,
                        kind: 'builtin',
                    })
                })

                const merged: SelectableGrouping[] = []
                getUserGroupingDefinitions().forEach((definition) => {
                    const baseId = definition.id as UserGroupingId
                    const configItem = items.find((item) => item.id === baseId)
                    const enabled = configItem ? configItem.enabled : baseId !== 'none'
                    if (!enabled) return
                    const label = configItem?.label && configItem.label.trim().length > 0
                        ? configItem.label
                        : definition.label
                    merged.push({ id: baseId, label, kind: 'builtin' })
                })

                items.forEach((item) => {
                    const isBuiltin = builtinMap.has(item.id)
                    if (isBuiltin || !item.enabled) return
                    const label = item.label && item.label.trim().length > 0 ? item.label : item.id
                    merged.push({
                        id: item.id,
                        label,
                        kind: item.kind ?? 'byField',
                        fieldKey: item.fieldKey ?? undefined,
                    })
                })

                if (!cancelled) {
                    setAvailableGroupings(merged)
                }
            } catch {
                if (!cancelled) {
                    const defaults: SelectableGrouping[] = getUserGroupingDefinitions().map((definition) => ({
                        id: definition.id as UserGroupingId,
                        label: definition.label,
                        kind: 'builtin',
                    }))
                    setAvailableGroupings(defaults)
                }
            }
        }

        loadUsers().catch(() => { })
        loadGroupings().catch(() => { })

        return () => {
            cancelled = true
        }
    }, [meetingDatabase])

    useEffect(() => {
        if (availableGroupings.length === 0) {
            return
        }
        const exists = availableGroupings.some((item) => item.id === groupBy)
        if (!exists) {
            setGroupBy(availableGroupings[0]?.id ?? 'none')
        }
    }, [availableGroupings, groupBy])

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return allUsers
        return allUsers.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    }, [allUsers, search])

    const userGroups = useMemo(() => {
        const selected = availableGroupings.find((item) => item.id === groupBy)
        if (!selected) {
            return buildUserGroups<UserItem>(filteredUsers, 'none')
        }
        if (selected.kind === 'byField' && selected.fieldKey) {
            return buildUserGroupsByField<UserItem>(filteredUsers, selected.fieldKey)
        }
        return buildUserGroups<UserItem>(filteredUsers, groupBy)
    }, [availableGroupings, filteredUsers, groupBy])

    const canManageAnyMeeting = hasPermission('meetings_manage_any')
    const canManageOwnedMeeting = hasPermission('meetings_manage_owned')
    const canEdit = useMemo(() => {
        if (!meeting || !user) return false
        const isCreator = meeting.createdBy === user.uid
        const isManager = Array.isArray(meeting.managers) ? meeting.managers.includes(user.uid) : false
        return canManageAnyMeeting || (canManageOwnedMeeting && (isCreator || isManager))
    }, [meeting, user, canManageAnyMeeting, canManageOwnedMeeting])

    const isFinalStatus = useMemo(() => {
        const status = meeting?.status
        return status === 'closed' || status === 'completed'
    }, [meeting])

    useEffect(() => {
        if (!id || !meetingDatabase) {
            return
        }

        let cancelled = false

        const loadMeeting = async () => {
            try {
                setLoading(true)
                setError(null)

                const loadedMeeting = await getMeetingById(meetingDatabase, id)
                if (cancelled) return
                if (!loadedMeeting) {
                    throw new Error('No se encontró la actividad.')
                }
                setMeeting(loadedMeeting)
                const isOnlineMeeting = loadedMeeting.isOnline ?? (loadedMeeting as unknown as { isOnlineMeeting?: boolean }).isOnlineMeeting ?? (loadedMeeting as unknown as { isVirtual?: boolean }).isVirtual ?? false
                originalModalityRef.current = {
                    isOnlineMeeting,
                    location: loadedMeeting.location,
                }
                setForm({
                    title: loadedMeeting.title,
                    type: loadedMeeting.type,
                    customType: loadedMeeting.customType ?? '',
                    satisfactionSurveyId: loadedMeeting.satisfactionSurveyId ?? '',
                    description: loadedMeeting.description ?? '',
                    location: loadedMeeting.location,
                    isOnlineMeeting,
                    startTime: loadedMeeting.startTime,
                    endTime: loadedMeeting.endTime,
                    trainerName: loadedMeeting.trainerName ?? '',
                })

                const surveys = await getSurveys(meetingDatabase)
                if (cancelled) return
                setTrainingSurveys(surveys.filter((survey) => survey.category === 'training' && survey.isActive))
            } catch {
                if (!cancelled) {
                    setError('No fue posible cargar la actividad.')
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        void loadMeeting()

        return () => {
            cancelled = true
        }
    }, [id, meetingDatabase])

    useEffect(() => {
        if (!meetingDatabase || !meeting) {
            return
        }

        const currentMeeting = meeting
        let cancelled = false

        async function loadParticipants(): Promise<void> {
            try {
                const participantsMap = await getMeetingParticipants(meetingDatabase, currentMeeting.id)
                if (cancelled) return
                setSelectedParticipants(Object.values(participantsMap).map((participant) => ({
                    uid: participant.uid,
                    name: participant.name,
                    email: participant.email,
                    role: participant.role,
                })))
            } catch {
                if (!cancelled) {
                    setSelectedParticipants([])
                }
            }
        }

        void loadParticipants()

        return () => {
            cancelled = true
        }
    }, [meetingDatabase, meeting])

    useEffect(() => {
        if (form.type !== 'training' || String(form.satisfactionSurveyId ?? '').trim().length > 0 || trainingSurveys.length === 0) {
            return
        }

        const defaultSurvey = trainingSurveys.find((survey) => Boolean(survey.predetermined)) ?? trainingSurveys[0]
        if (defaultSurvey) {
            setForm((prev) => ({ ...prev, satisfactionSurveyId: defaultSurvey.id }))
        }
    }, [form.type, form.satisfactionSurveyId, trainingSurveys])

    const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = event.target
        setForm((prev) => ({ ...prev, [name]: value }))
    }

    function addUser(user: UserItem, role: ParticipantRole = 'attendee'): void {
        setSelectedParticipants((prev) => {
            if (prev.some((p) => p.uid === user.uid)) return prev
            return [...prev, { uid: user.uid, name: user.name, email: user.email, role }]
        })
    }

    function addUsersBulk(users: UserItem[], role: ParticipantRole = 'attendee'): void {
        setSelectedParticipants((prev) => {
            const existing = new Set(prev.map((p) => p.uid))
            const additions: ParticipantInput[] = []
            users.forEach((user) => {
                if (!existing.has(user.uid)) {
                    additions.push({ uid: user.uid, name: user.name, email: user.email, role })
                }
            })
            if (additions.length === 0) return prev
            return [...prev, ...additions]
        })
    }

    function removeUser(uid: string): void {
        setSelectedParticipants((prev) => prev.filter((p) => p.uid !== uid))
    }

    function changeRole(uid: string, role: ParticipantRole): void {
        setSelectedParticipants((prev) => prev.map((p) => (p.uid === uid ? { ...p, role } : p)))
    }

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setError(null)
        setSuccess(null)

        if (!meetingDatabase || !id) {
            setError('No se encontró la base de datos de origen.')
            return
        }
        if (!meeting) {
            setError('No se encontró la actividad.')
            return
        }
        if (!canEdit) {
            setError('No tienes permisos para editar esta actividad.')
            return
        }
        if (isFinalStatus) {
            setError('La actividad está cerrada o completada y no permite edición.')
            return
        }

        if (!form.title.trim()) {
            setError('El título es obligatorio.')
            return
        }
        if (!form.isOnlineMeeting && !form.location.trim()) {
            setError('La ubicación es obligatoria.')
            return
        }
        if (!form.startTime || !form.endTime) {
            setError('Las fechas de inicio y fin son obligatorias.')
            return
        }
        const startMs = form.startTime
        const endMs = form.endTime
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
            setError('Fechas inválidas.')
            return
        }
        if (startMs >= endMs) {
            setError('La hora de inicio debe ser menor que la de fin.')
            return
        }

        setSubmitting(true)
        setCreatingTeams(false)

        try {
            const selectedTrainer = selectedParticipants.find((participant) => participant.role === 'speaker')
            const resolvedTrainerName = form.type === 'training'
                ? (form.trainerName?.trim() || selectedTrainer?.name?.trim() || null)
                : null

            const original = originalModalityRef.current
            const originalIsOnline = original?.isOnlineMeeting ?? false
            const originalLocation = original?.location ?? ''
            const formIsOnline = form.isOnlineMeeting ?? false
            const toggleChanged = formIsOnline !== originalIsOnline
            const locationChanged = form.location.trim() !== originalLocation.trim()

            let effectiveIsOnlineMeeting: boolean
            let effectiveLocation: string
            if (toggleChanged) {
                effectiveIsOnlineMeeting = formIsOnline
                effectiveLocation = formIsOnline ? 'Virtual' : form.location
            } else if (locationChanged) {
                const normalizedLocation = form.location.trim().toLowerCase()
                effectiveIsOnlineMeeting = normalizedLocation === 'virtual'
                effectiveLocation = effectiveIsOnlineMeeting ? 'Virtual' : form.location
            } else {
                effectiveIsOnlineMeeting = originalIsOnline
                effectiveLocation = originalLocation
            }

            if (effectiveIsOnlineMeeting && !effectiveLocation.trim()) {
                effectiveLocation = 'Virtual'
            }

            let updatedTeamsEventId = meeting.teamsEventId ?? null
            let updatedTeamsJoinUrl = meeting.teamsJoinUrl ?? null
            let updatedTeamsOrganizerEmail = meeting.teamsOrganizerEmail ?? null

            await updateMeeting(meetingDatabase, id, {
                title: form.title,
                type: form.type,
                customType: form.type === 'custom' ? form.customType || null : null,
                satisfactionSurveyId: form.type === 'training' ? form.satisfactionSurveyId || null : null,
                description: form.description || null,
                location: effectiveLocation,
                isOnlineMeeting: effectiveIsOnlineMeeting,
                startTime: startMs,
                endTime: endMs,
                trainerName: resolvedTrainerName,
            })

            await syncMeetingParticipants(meetingDatabase, id, selectedParticipants, {
                startTime: startMs,
                status: meeting.status,
            })

            const hostParticipant = selectedParticipants.find((participant) => participant.role === 'host')
            const organizerEmail = meeting.teamsOrganizerEmail ?? hostParticipant?.email ?? user?.email ?? null
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

            try {
                setCreatingTeams(true)

                if (meeting.teamsEventId) {
                    const updateResult = await updateTeamsMeetingViaCloudFunction({
                        eventId: meeting.teamsEventId,
                        organizerEmail,
                        subject: form.title,
                        bodyHtml: form.description ?? undefined,
                        startTime: startMs,
                        endTime: endMs,
                        timeZone,
                        location: effectiveIsOnlineMeeting ? undefined : effectiveLocation,
                        attendees: selectedParticipants.map((participant) => ({
                            email: participant.email,
                            name: participant.name,
                            type: 'required',
                        })),
                        isOnlineMeeting: effectiveIsOnlineMeeting,
                    })

                    await updateMeeting(meetingDatabase, id, {
                        teamsJoinUrl: effectiveIsOnlineMeeting ? (updateResult.joinUrl ?? meeting.teamsJoinUrl ?? null) : null,
                        teamsOrganizerEmail: meeting.teamsOrganizerEmail ?? organizerEmail,
                    })

                    updatedTeamsEventId = meeting.teamsEventId
                    updatedTeamsJoinUrl = effectiveIsOnlineMeeting ? (updateResult.joinUrl ?? meeting.teamsJoinUrl ?? null) : null
                    updatedTeamsOrganizerEmail = meeting.teamsOrganizerEmail ?? organizerEmail
                } else {
                    const createResult = await createTeamsMeetingViaCloudFunction({
                        organizerEmail,
                        subject: form.title,
                        bodyHtml: form.description ?? undefined,
                        startTime: startMs,
                        endTime: endMs,
                        timeZone,
                        location: effectiveIsOnlineMeeting ? undefined : effectiveLocation,
                        attendees: selectedParticipants.map((participant) => ({
                            email: participant.email,
                            name: participant.name,
                            type: 'required',
                        })),
                        isOnlineMeeting: effectiveIsOnlineMeeting,
                    })

                    await updateMeeting(meetingDatabase, id, {
                        teamsEventId: createResult.eventId,
                        teamsJoinUrl: effectiveIsOnlineMeeting ? (createResult.joinUrl ?? null) : null,
                        teamsOrganizerEmail: organizerEmail,
                    })

                    updatedTeamsEventId = createResult.eventId
                    updatedTeamsJoinUrl = effectiveIsOnlineMeeting ? (createResult.joinUrl ?? null) : null
                    updatedTeamsOrganizerEmail = organizerEmail
                }
            } catch (teamsError) {
                const message = teamsError instanceof Error
                    ? teamsError.message
                    : 'Error al actualizar la actividad en el calendario'
                setError(message)
            } finally {
                setCreatingTeams(false)
            }

            setSuccess('Actividad actualizada correctamente.')
            setMeeting((prev) => prev ? {
                ...prev,
                title: form.title,
                type: form.type,
                customType: form.type === 'custom' ? form.customType || null : null,
                satisfactionSurveyId: form.type === 'training' ? form.satisfactionSurveyId || null : null,
                description: form.description || null,
                location: effectiveLocation,
                isOnlineMeeting: effectiveIsOnlineMeeting,
                startTime: startMs,
                endTime: endMs,
                trainerName: resolvedTrainerName,
                teamsEventId: updatedTeamsEventId,
                teamsJoinUrl: updatedTeamsJoinUrl,
                teamsOrganizerEmail: updatedTeamsOrganizerEmail,
            } : prev)
            originalModalityRef.current = {
                isOnlineMeeting: effectiveIsOnlineMeeting,
                location: effectiveLocation,
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No fue posible guardar los cambios.')
        } finally {
            setSubmitting(false)
        }
    }

    if (!meetingDatabase) {
        return (
            <Layout
                header={{
                    breadcrumbs: [{ label: 'Actividades', to: '/meets' }, { label: 'Editar' }],
                    title: 'Editar actividad',
                }}
            >
                <div className="max-w-7xl mx-auto p-6">
                    <div className="rounded-2xl border border-border bg-card p-6 text-sm text-[#8b918d]">No se encontró la base de datos de origen.</div>
                </div>
            </Layout>
        )
    }

    return (
        <Layout
            header={{
                breadcrumbs: [{ label: 'Actividades', to: '/meets' }, { label: 'Editar' }],
                title: 'Editar actividad',
                description: meeting?.title ?? undefined,
            }}
        >
            <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
                <div className="px-4 md:px-12 py-10 md:py-10 max-w-7xl mx-auto">
                    <form className="space-y-8" onSubmit={handleSubmit}>
                        <section className="bg-[#f3f4f3] p-6 rounded-xl space-y-6">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold mb-2">Datos de la actividad</p>
                            </div>
                            {isFinalStatus && (
                                <div className="rounded-2xl border border-[#edeeed] bg-white p-4 text-sm text-[#5f6560]">
                                    Esta actividad está cerrada o completada. Para editarla primero debes reabrirla.
                                </div>
                            )}
                            {loading ? (
                                <div className="rounded-2xl border border-border bg-white p-6 text-sm text-[#5f6560]">Cargando actividad...</div>
                            ) : (
                                <>
                                    <div className="grid md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Título *</label>
                                            <input
                                                type="text"
                                                name="title"
                                                value={form.title}
                                                onChange={handleChange}
                                                placeholder="Título de la reunión"
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] appearance-none focus:ring-2 focus:ring-primary-container"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Tipo *</label>
                                            <select
                                                name="type"
                                                value={form.type}
                                                onChange={handleChange}
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] focus:ring-2 focus:ring-primary-container"
                                            >
                                                <option value="meeting">Reunión</option>
                                                <option value="training">Capacitación</option>
                                                <option value="custom">Personalizado</option>
                                            </select>
                                        </div>
                                    </div>

                                    {form.type === 'training' && (
                                        <div className="grid md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Encuesta de satisfacción</label>
                                                {trainingSurveys.length === 0 ? (
                                                    <p className="text-sm text-[#5f6560] bg-white rounded-xl px-4 py-3">No hay encuestas de capacitación configuradas en esta base de datos.</p>
                                                ) : (
                                                    <select
                                                        name="satisfactionSurveyId"
                                                        value={form.satisfactionSurveyId ?? ''}
                                                        onChange={handleChange}
                                                        className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] focus:ring-2 focus:ring-primary-container"
                                                    >
                                                        <option value="">Sin encuesta asociada</option>
                                                        {trainingSurveys.map((survey) => (
                                                            <option key={survey.id} value={survey.id}>
                                                                {survey.name}{survey.predetermined ? ' (Predeterminada)' : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                            </div>

                                            <div>
                                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Capacitador</label>
                                                <input
                                                    type="text"
                                                    name="trainerName"
                                                    value={form.trainerName ?? ''}
                                                    onChange={handleChange}
                                                    placeholder="Nombre del capacitador si no está registrado"
                                                    className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                                />
                                                <p className="text-[11px] text-[#5f6560] mt-2 px-1">
                                                    Si dejas este campo vacío, se usará el participante marcado como capacitador.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {form.type === 'custom' && (
                                        <div>
                                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Tipo personalizado *</label>
                                            <input
                                                type="text"
                                                name="customType"
                                                value={form.customType ?? ''}
                                                onChange={handleChange}
                                                placeholder="Ej. Taller, Charla"
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Descripción</label>
                                        <textarea
                                            name="description"
                                            value={form.description ?? ''}
                                            onChange={handleChange}
                                            placeholder="Descripción de la reunión"
                                            rows={4}
                                            className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                        />
                                    </div>

                                    <div className="flex items-center space-x-2">
                                        <span className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-0.5 ml-1">Modalidad</span>
                                        <button
                                            type="button"
                                            aria-pressed={form.isOnlineMeeting}
                                            onClick={() => setForm((prev) => ({
                                                ...prev,
                                                isOnlineMeeting: !prev.isOnlineMeeting,
                                                location: !prev.isOnlineMeeting ? 'Virtual' : '',
                                            }))}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${form.isOnlineMeeting ? 'bg-primary' : 'bg-gray-300'}`}
                                        >
                                            <span
                                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${form.isOnlineMeeting ? 'translate-x-5' : 'translate-x-1'}`}
                                            />
                                        </button>
                                        <span className="text-sm font-semibold text-[#191c1c]">{form.isOnlineMeeting ? 'Virtual' : 'Presencial'}</span>
                                    </div>

                                    {!form.isOnlineMeeting && (
                                        <div>
                                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Ubicación *</label>
                                            <input
                                                type="text"
                                                name="location"
                                                value={form.location}
                                                onChange={handleChange}
                                                placeholder="Sala de conferencias o ubicación"
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                            />
                                        </div>
                                    )}
                                    {form.isOnlineMeeting && (
                                        <div>
                                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Ubicación</label>
                                            <input
                                                type="text"
                                                readOnly
                                                value="Virtual"
                                                className="w-full bg-[#f3f4f3] border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] focus:ring-2 focus:ring-primary-container"
                                            />
                                        </div>
                                    )}

                                    <div className="grid md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Hora de Inicio *</label>
                                            <input
                                                type="datetime-local"
                                                name="startTime"
                                                value={formatDateTimeLocal(form.startTime)}
                                                onChange={(event) => setForm((prev) => ({ ...prev, startTime: toEpochMs(event.target.value) }))}
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Hora de Fin *</label>
                                            <input
                                                type="datetime-local"
                                                name="endTime"
                                                value={formatDateTimeLocal(form.endTime)}
                                                onChange={(event) => setForm((prev) => ({ ...prev, endTime: toEpochMs(event.target.value) }))}
                                                className="w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] focus:ring-2 focus:ring-primary-container"
                                            />
                                        </div>
                                    </div>
                                </>
                            )}
                        </section>

                        <section className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden">
                            <div className="p-8 border-b border-[#edeeed] flex items-center justify-between gap-4">
                                <div>
                                    <h2 className="text-xl font-bold text-emerald-950 flex items-center gap-2">
                                        <Users className="w-5 h-5" />
                                        Participantes
                                    </h2>
                                    <p className="text-xs text-outline font-medium mt-1">Busca, agrupa y administra los asistentes de la actividad.</p>
                                </div>
                                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#d0e9d4] text-[#1b3022]">
                                    {selectedParticipants.length} seleccionado{selectedParticipants.length === 1 ? '' : 's'}
                                </span>
                            </div>
                            <div className="p-8 grid md:grid-cols-2 gap-6">
                                <div>
                                    <div className="flex flex-col gap-3">
                                        <input
                                            type="text"
                                            name="participantSearch"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            placeholder="Buscar por nombre o correo"
                                            className={helperFieldClassName}
                                        />
                                        <div className="flex items-center gap-2 text-xs text-[#5f6560]">
                                            <span className="font-semibold uppercase tracking-widest">Agrupar por</span>
                                            <select
                                                value={groupBy}
                                                onChange={(e) => setGroupBy(e.target.value as UserGroupingId)}
                                                className="px-3 py-2 bg-[#fcfcfb] border border-[#edeeed] rounded-lg text-xs font-medium text-[#191c1c]"
                                            >
                                                {availableGroupings.map((grouping) => (
                                                    <option key={grouping.id} value={grouping.id}>
                                                        {grouping.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className={listContainerClassName}>
                                        {filteredUsers.length === 0 ? (
                                            <div className="p-4 text-sm text-[#5f6560]">Sin resultados</div>
                                        ) : groupBy === 'none' || userGroups.length === 0 ? (
                                            <ul>
                                                {filteredUsers.map((u) => (
                                                    <li key={u.uid} className="flex items-center justify-between px-4 py-3 border-b border-[#edeeed] last:border-b-0 hover:bg-[#f8f9f8] transition-colors">
                                                        <div>
                                                            <p className="text-sm font-semibold text-[#191c1c]">{u.name}</p>
                                                            <p className="text-xs text-[#5f6560]">{u.email}</p>
                                                        </div>
                                                        <button type="button" onClick={() => addUser(u)} className="px-3 py-2 text-xs font-semibold bg-[#1b3022] text-white rounded-lg hover:bg-primary transition-colors">Añadir</button>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="space-y-3">
                                                {userGroups.map((group) => (
                                                    <div key={group.key} className="border-b border-[#edeeed] last:border-b-0 pb-2">
                                                        <div className="flex items-center justify-between px-4 py-3">
                                                            <div>
                                                                <p className="text-xs font-semibold text-[#5f6560] uppercase tracking-wider">{group.header}</p>
                                                                {group.helperText && <p className="text-[11px] text-[#5f6560]">{group.helperText}</p>}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => addUsersBulk(group.users as UserItem[])}
                                                                className="px-3 py-2 text-xs font-semibold bg-[#1b3022] text-white rounded-lg hover:bg-primary transition-colors"
                                                            >
                                                                Agregar todos
                                                            </button>
                                                        </div>
                                                        <ul>
                                                            {group.users.map((u) => (
                                                                <li key={u.uid} className="flex items-center justify-between px-4 py-2 hover:bg-[#f8f9f8] transition-colors">
                                                                    <div>
                                                                        <p className="text-sm font-semibold text-[#191c1c]">{u.name}</p>
                                                                        <p className="text-xs text-[#5f6560]">{u.email}</p>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => addUser(u as UserItem)}
                                                                        className="px-3 py-2 text-xs font-semibold bg-[#1b3022] text-white rounded-lg hover:bg-primary transition-colors"
                                                                    >
                                                                        Añadir
                                                                    </button>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-[#191c1c] mb-2">Seleccionados</p>
                                    {selectedParticipants.length === 0 ? (
                                        <div className="p-4 text-sm text-[#5f6560] border border-[#edeeed] rounded-2xl bg-[#fcfcfb]">Aún no hay participantes</div>
                                    ) : (
                                        <ul className="h-80 overflow-y-auto border border-[#edeeed] rounded-2xl bg-[#fcfcfb]">
                                            {selectedParticipants.map((p) => (
                                                <li key={p.uid} className="grid grid-cols-5 items-center gap-3 px-4 py-3 border-b border-[#edeeed] last:border-b-0">
                                                    <div className="col-span-3">
                                                        <p className="text-sm font-semibold text-[#191c1c]">{p.name}</p>
                                                        <p className="text-xs text-[#5f6560]">{p.email}</p>
                                                    </div>
                                                    <div>
                                                        <select value={p.role} onChange={(e) => changeRole(p.uid, e.target.value as ParticipantRole)} className="w-full px-3 py-2 bg-white border border-[#edeeed] rounded-lg text-sm font-medium text-[#191c1c]">
                                                            <option value="attendee">Asistente</option>
                                                            <option value="speaker">Capacitador</option>
                                                            <option value="host">Anfitrión</option>
                                                        </select>
                                                    </div>
                                                    <div className="text-right">
                                                        <button type="button" onClick={() => removeUser(p.uid)} className="px-3 py-2 text-xs font-semibold border border-[#d7d9d8] rounded-lg text-[#434843] hover:bg-[#edeeed] transition-colors">Quitar</button>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </section>

                        {error && (
                            <div className="p-4 border border-[#f0c7c2] text-[#8c1d18] rounded-2xl bg-[#fff6f5]">{error}</div>
                        )}
                        {success && (
                            <div className="p-4 border border-[#b7d6be] text-[#1b5e20] rounded-2xl bg-[#f3fbf4]">{success}</div>
                        )}

                        <div className="flex justify-center items-center">
                                <button
                                type="submit"
                                    disabled={submitting || loading || isFinalStatus}
                                className="px-8 py-3 bg-[#1b3022] text-white font-bold rounded-xl transition-all shadow-md hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting || creatingTeams ? 'Guardando…' : 'Guardar cambios'}
                            </button>
                        </div>
                    </form>

                    {(error || success) && (
                        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
                            <div className="w-full max-w-md rounded-3xl border border-[#edeeed] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden">
                                <div className="px-6 py-5 border-b border-[#edeeed] bg-[#f8faf8]">
                                    <h2 className="text-xl font-bold text-[#191c1c]">{success ? 'Actividad actualizada' : 'Error'}</h2>
                                </div>
                                <div className="p-6 space-y-4">
                                    <p className={`text-sm ${success ? 'text-[#1b5e20]' : 'text-[#8c1d18]'}`}>
                                        {success ?? error}
                                    </p>
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (success) {
                                                    setSuccess(null)
                                                    navigate('/meets')
                                                }
                                                if (error) {
                                                    setError(null)
                                                }
                                            }}
                                            className="inline-flex items-center justify-center rounded-xl bg-[#1b3022] px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#14251a] transition-colors"
                                        >
                                            Cerrar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    )
}

export default EditMeetPage
