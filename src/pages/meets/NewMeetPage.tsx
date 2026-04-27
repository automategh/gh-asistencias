/**
 * Página de creación de reuniones.
 *
 * Incluye:
 * - Formulario controlado con validaciones básicas
 * - Conversión segura de `datetime-local` a epoch ms
 * - Selector de participantes con búsqueda por texto y scroll con altura fija
 * - Persistencia: crea la reunión y añade participantes (fan-out)
 */
import Layout from '@/components/layouts/layout'
import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import type { ChangeEvent, FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { MeetingKind, ParticipantInput, ParticipantRole } from '@/types/meeting'
import { createMeeting, addParticipants } from '@/services/meetings.service'
import { listAllUsersAcrossDatabases } from '@/services/roles.service'
import type { RecintoKey } from '@/lib/firebase/databaseResolver'
import { getSurveys, type Survey } from '@/services/forms.service'
import { createTeamsMeetingViaCloudFunction } from '@/services/teams.service'
import { buildUserGroups, buildUserGroupsByField, getUserGroupingDefinitions, type GroupingFieldKey, type UserGroupingId } from '@/lib/userGrouping'
import { getUserGroupingConfig, type UserGroupingConfig } from '@/services/user-grouping.service'
import { ChevronRight, Users } from 'lucide-react'

/**
 * Convierte un valor `datetime-local` a epoch ms, interpretándolo en zona local
 * de forma segura (sin depender de parseo implícito del motor).
 *
 * Ejemplo de entrada: "2025-12-30T14:00"
 */
function toEpochMs(datetimeLocal: string): number {
    if (!datetimeLocal) return NaN
    const parts = datetimeLocal.split('T')
    if (parts.length !== 2) return NaN
    const [datePart, timePart] = parts
    const [yStr, mStr, dStr] = datePart.split('-')
    const [hStr, minStr] = timePart.split(':')

    const year = Number(yStr)
    const month = Number(mStr)
    const day = Number(dStr)
    const hour = Number(hStr)
    const minute = Number(minStr)

    if ([year, month, day, hour, minute].some(n => Number.isNaN(n))) return NaN

    // Construye fecha en zona local (Date(year, monthIndex, day, hour, minute))
    const d = new Date(year, month - 1, day, hour, minute, 0, 0)
    return d.getTime()
}

/**
 * Componente de creación de nueva reunión.
 * Gestiona estado de formulario, listado/selección de usuarios y
 * la persistencia en RTDB.
 */
function NewMeetPage() {
    const { user } = useAuth()
    const { database } = useDatabase()

    /** Estado del formulario de creación */
    type FormState = {
        title: string
        type: MeetingKind
        customType: string
        satisfactionSurveyId: string
        description: string
        location: string
        startTime: string
        endTime: string
    }

    const [form, setForm] = useState<FormState>({
        title: '',
        type: 'meeting',
        customType: '',
        satisfactionSurveyId: '',
        description: '',
        location: '',
        startTime: '',
        endTime: '',
    })

    const [submitting, setSubmitting] = useState<boolean>(false)
    const [creatingTeams, setCreatingTeams] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

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
    const [allUsers, setAllUsers] = useState<UserItem[]>([])
    const [search, setSearch] = useState<string>('')
    const [groupBy, setGroupBy] = useState<UserGroupingId>('none')
    const [selected, setSelected] = useState<Array<ParticipantInput>>([])
    const [trainingSurveys, setTrainingSurveys] = useState<Survey[]>([])

    /** Maneja cambios de cualquier control del formulario */
    function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>): void {
        const { name, value } = e.target
        setForm(prev => ({ ...prev, [name]: value }))
    }

    useEffect(() => {
        let cancelled = false
        async function loadUsers(): Promise<void> {
            const crossDbUsers = await listAllUsersAcrossDatabases()
            if (cancelled) return

            const list: UserItem[] = crossDbUsers.map(user => ({
                uid: user.uid,
                name: user.name,
                email: user.email,
                recinto: user.recinto,
                department: user.department ?? null,
                immediateBoss: user.immediateBoss ?? null,
                cargo: user.cargo ?? null,
                companyName: user.companyName ?? null,
            }))
            // Ordenar alfabéticamente por nombre para mejor UX
            list.sort((a, b) => a.name.localeCompare(b.name))
            setAllUsers(list)
        }
        loadUsers().catch(() => {})
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        if (!database) {
            setTrainingSurveys([])
            return
        }

        let cancelled = false

        async function loadTrainingSurveys(): Promise<void> {
            try {
                const surveys = await getSurveys(database)
                if (cancelled) return

                const trainings = surveys.filter(item => item.category === 'training' && item.isActive)
                setTrainingSurveys(trainings)

                if (trainings.length === 0) return

                setForm(prev => {
                    if (prev.type !== 'training') return prev
                    if (prev.satisfactionSurveyId && prev.satisfactionSurveyId.trim().length > 0) {
                        return prev
                    }
                    const predetermined = trainings.find(item => Boolean(item.predetermined)) ?? trainings[0]
                    return {
                        ...prev,
                        satisfactionSurveyId: predetermined?.id ?? '',
                    }
                })
            } catch {
                if (!cancelled) {
                    setTrainingSurveys([])
                }
            }
        }

        loadTrainingSurveys().catch(() => {})

        return () => {
            cancelled = true
        }
    }, [database])

    useEffect(() => {
        if (form.type !== 'training') return
        if (trainingSurveys.length === 0) return
        if (form.satisfactionSurveyId && form.satisfactionSurveyId.trim().length > 0) return

        const predetermined = trainingSurveys.find(item => Boolean(item.predetermined)) ?? trainingSurveys[0]
        if (!predetermined) return

        setForm(prev => ({
            ...prev,
            satisfactionSurveyId: predetermined.id,
        }))
    }, [form.type, form.satisfactionSurveyId, trainingSurveys])

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return allUsers
        return allUsers.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    }, [allUsers, search])

    /** Añade un usuario a la lista de seleccionados (evita duplicados) */
    function addUser(u: UserItem, role: ParticipantRole = 'attendee'): void {
        setSelected(prev => {
            if (prev.some(p => p.uid === u.uid)) return prev
            return [...prev, { uid: u.uid, name: u.name, email: u.email, role }]
        })
    }

    /** Añade en bloque todos los usuarios proporcionados (evita duplicados) */
    function addUsersBulk(users: UserItem[], role: ParticipantRole = 'attendee'): void {
        setSelected(prev => {
            const existing = new Set(prev.map(p => p.uid))
            const additions: ParticipantInput[] = []
            users.forEach(u => {
                if (!existing.has(u.uid)) {
                    additions.push({ uid: u.uid, name: u.name, email: u.email, role })
                }
            })
            if (additions.length === 0) return prev
            return [...prev, ...additions]
        })
    }

    /** Elimina un usuario de la lista de seleccionados */
    function removeUser(uid: string): void {
        setSelected(prev => prev.filter(p => p.uid !== uid))
    }

    /** Cambia el rol de un participante ya seleccionado */
    function changeRole(uid: string, role: ParticipantRole): void {
        setSelected(prev => prev.map(p => (p.uid === uid ? { ...p, role } : p)))
    }

    // Selección/rol de usuarios gestionados desde la lista filtrada y la lista de seleccionados

    type SelectableGrouping = {
        readonly id: UserGroupingId
        readonly label: string
        readonly kind: 'builtin' | 'byField'
        readonly fieldKey?: GroupingFieldKey
    }

    const builtinDefinitions = useMemo(() => getUserGroupingDefinitions(), [])

    const [availableGroupings, setAvailableGroupings] = useState<SelectableGrouping[]>([])

    useEffect(() => {
        let cancelled = false

        async function loadGroupings(): Promise<void> {
            if (!database) {
                const defaults: SelectableGrouping[] = builtinDefinitions.map((definition) => ({
                    id: definition.id,
                    label: definition.label,
                    kind: 'builtin',
                }))
                if (!cancelled) {
                    setAvailableGroupings(defaults)
                }
                return
            }

            try {
                const config: UserGroupingConfig | null = await getUserGroupingConfig(database)
                const items = config?.items ?? []

                const builtinMap = new Map<UserGroupingId, SelectableGrouping>()
                builtinDefinitions.forEach((definition) => {
                    builtinMap.set(definition.id as UserGroupingId, {
                        id: definition.id as UserGroupingId,
                        label: definition.label,
                        kind: 'builtin',
                    })
                })

                const merged: SelectableGrouping[] = []

                builtinDefinitions.forEach((definition) => {
                    const baseId = definition.id as UserGroupingId
                    const configItem = items.find((item) => item.id === baseId)
                    const enabled = configItem ? configItem.enabled : baseId !== 'none'
                    if (!enabled) {
                        return
                    }
                    const label = configItem?.label && configItem.label.trim().length > 0
                        ? configItem.label
                        : definition.label
                    merged.push({
                        id: baseId,
                        label,
                        kind: 'builtin',
                    })
                })

                items.forEach((item) => {
                    const isBuiltin = builtinMap.has(item.id)
                    if (isBuiltin) {
                        return
                    }
                    if (!item.enabled) {
                        return
                    }
                    const label = item.label && item.label.trim().length > 0
                        ? item.label
                        : item.id
                    const fieldKey: GroupingFieldKey | undefined = item.fieldKey ?? undefined

                    merged.push({
                        id: item.id,
                        label,
                        kind: item.kind ?? 'byField',
                        fieldKey,
                    })
                })

                if (!cancelled) {
                    setAvailableGroupings(merged)
                }
            } catch {
                if (!cancelled) {
                    const fallback: SelectableGrouping[] = builtinDefinitions.map((definition) => ({
                        id: definition.id,
                        label: definition.label,
                        kind: 'builtin',
                    }))
                    setAvailableGroupings(fallback)
                }
            }
        }

        loadGroupings().catch(() => {})

        return () => {
            cancelled = true
        }
    }, [database, builtinDefinitions])

    useEffect(() => {
        if (availableGroupings.length === 0) {
            return
        }
        const exists = availableGroupings.some((item) => item.id === groupBy)
        if (!exists) {
            setGroupBy(availableGroupings[0]?.id ?? 'none')
        }
    }, [availableGroupings, groupBy])

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

    /**
     * Envía el formulario: valida campos, crea la reunión y persiste
     * participantes seleccionados utilizando el servicio del módulo.
     */
    async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
        e.preventDefault()
        setSubmitting(true)
        setCreatingTeams(false)
        setError(null)
        setSuccess(null)
        try {
            if (!user) throw new Error('Usuario no autenticado')
            if (!database) throw new Error('Base de datos no disponible')

            const startMs = toEpochMs(form.startTime)
            const endMs = toEpochMs(form.endTime)
            if (!form.title.trim()) throw new Error('El título es obligatorio')
            if (!form.location.trim()) throw new Error('La ubicación es obligatoria')
            if (!form.startTime || !form.endTime) throw new Error('Hora de inicio y fin son obligatorias')
            if (Number.isNaN(startMs) || Number.isNaN(endMs)) throw new Error('Fechas inválidas')
            if (startMs >= endMs) throw new Error('La hora de inicio debe ser menor que la de fin')

            const meeting = await createMeeting(database, {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
            }, {
                title: form.title,
                type: form.type,
                customType: form.type === 'custom' ? form.customType || null : null,
                satisfactionSurveyId: form.type === 'training' && form.satisfactionSurveyId
                    ? form.satisfactionSurveyId
                    : null,
                description: form.description || null,
                location: form.location,
                startTime: startMs,
                endTime: endMs,
                managers: null,
            })

            if (selected.length > 0) {
                await addParticipants(database, meeting.id, selected, { startTime: meeting.startTime, status: meeting.status })
            }

            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

            const hostParticipant = selected.find(participant => participant.role === 'host')
            const organizerEmail = hostParticipant?.email ?? user.email ?? null

            try {
                setCreatingTeams(true)

                await createTeamsMeetingViaCloudFunction({
                    organizerEmail,
                    subject: meeting.title,
                    bodyHtml: meeting.description ?? undefined,
                    startTime: meeting.startTime,
                    endTime: meeting.endTime,
                    timeZone,
                    location: meeting.location,
                    attendees: selected.map(participant => ({
                        email: participant.email,
                        name: participant.name,
                        type: 'required',
                    })),
                })

                setSuccess('Actividad creada correctamente y sincronizada con Teams')
            } catch (teamsError) {
                const message = teamsError instanceof Error ? teamsError.message : 'Error al crear la actividad en Teams'
                // No interrumpe la creación local; solo informa el problema con Teams.
                setSuccess('Actividad creada correctamente, pero hubo un problema al crearla en Teams')
                console.error('Error al crear actividad en Teams:', message)
            } finally {
                setCreatingTeams(false)
            }
            setForm({
                title: '', type: 'meeting', customType: '', satisfactionSurveyId: '', description: '', location: '', startTime: '', endTime: '',
            })
            setSelected([])
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Error al crear la actividad'
            setError(message)
        } finally {
            setSubmitting(false)
        }
    }

    const fieldClassName = 'w-full bg-white border-none rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] placeholder:text-[#8b918d] appearance-none focus:ring-2 focus:ring-primary-container'
    const helperFieldClassName = 'w-full bg-[#fcfcfb] border border-[#edeeed] rounded-xl py-3 px-4 text-sm text-[#191c1c] placeholder:text-[#8b918d] focus:outline-none focus:ring-2 focus:ring-primary-container'
    const listContainerClassName = 'mt-3 h-80 overflow-y-auto border border-[#edeeed] rounded-2xl bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]'

    return (
        <Layout>
            <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs border-b border-[#edeeed]">
                    <nav className="px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto">
                        <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                            <span>Actividades</span>
                            <ChevronRight className="w-4 h-4" />
                            <span>Nueva actividad</span>
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-[#191c1c]">Nueva Actividad</h1>
                        <p className="text-sm text-[#5f6560] mt-1">
                            Crea reuniones, capacitaciones o actividades personalizadas con sus participantes.
                        </p>
                    </nav>
                </header>

                <div className="px-4 md:px-12 py-10 md:py-10 max-w-7xl mx-auto">
                    <form className="space-y-8" onSubmit={handleSubmit}>
                        <section className="bg-[#f3f4f3] p-6 rounded-xl space-y-6">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold mb-2">Datos de la actividad</p>
                            </div>
                            <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Título *</label>
                                <input
                                    type="text"
                                    name="title"
                                    value={form.title}
                                    onChange={handleChange}
                                    placeholder="Título de la reunión"
                                    className={fieldClassName}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Tipo *</label>
                                <select
                                    name="type"
                                    value={form.type}
                                    onChange={handleChange}
                                    className={fieldClassName}
                                >
                                    <option value="meeting">Reunión</option>
                                    <option value="training">Capacitación</option>
                                    <option value="custom">Personalizado</option>
                                </select>
                            </div>
                            </div>

                        {form.type === 'training' && (
                            <div>
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Encuesta de satisfacción</label>
                                {trainingSurveys.length === 0 ? (
                                    <p className="text-sm text-[#5f6560] bg-white rounded-xl px-4 py-3">
                                        No hay encuestas de capacitación configuradas en esta base de datos.
                                    </p>
                                ) : (
                                    <select
                                        name="satisfactionSurveyId"
                                        value={form.satisfactionSurveyId}
                                        onChange={handleChange}
                                        className={fieldClassName}
                                    >
                                        {trainingSurveys.map(survey => (
                                            <option key={survey.id} value={survey.id}>
                                                {survey.name}{survey.predetermined ? ' (Predeterminada)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        )}

                        {form.type === 'custom' && (
                            <div>
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Tipo personalizado *</label>
                                <input
                                    type="text"
                                    name="customType"
                                    value={form.customType}
                                    onChange={handleChange}
                                    placeholder="Ej. Taller, Charla"
                                    className={fieldClassName}
                                />
                            </div>
                        )}

                        <div>
                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Descripción</label>
                            <textarea
                                name="description"
                                value={form.description}
                                onChange={handleChange}
                                placeholder="Descripción de la reunión"
                                rows={4}
                                className={fieldClassName}
                            />
                        </div>

                        <div>
                            <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Ubicación *</label>
                            <input
                                type="text"
                                name="location"
                                value={form.location}
                                onChange={handleChange}
                                placeholder="Sala de conferencias o ubicación"
                                className={fieldClassName}
                            />
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Hora de Inicio *</label>
                                <input
                                    type="datetime-local"
                                    name="startTime"
                                    value={form.startTime}
                                    onChange={handleChange}
                                    className={fieldClassName}
                                />
                            </div>

                            <div>
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Hora de Fin *</label>
                                <input
                                    type="datetime-local"
                                    name="endTime"
                                    value={form.endTime}
                                    onChange={handleChange}
                                    className={fieldClassName}
                                />
                            </div>
                        </div>
                        </section>

                        <section className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden">
                            <div className="p-8 border-b border-[#edeeed] flex items-center justify-between gap-4">
                                <div>
                                    <h2 className="text-xl font-bold text-emerald-950 flex items-center gap-2">
                                        <Users className="w-5 h-5" />
                                        Participantes
                                    </h2>
                                    <p className="text-xs text-outline font-medium mt-1">Busca, agrupa y asigna roles a los asistentes de la actividad.</p>
                                </div>
                                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#d0e9d4] text-[#1b3022]">
                                    {selected.length} seleccionado{selected.length === 1 ? '' : 's'}
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
                                                {availableGroupings.map(grouping => (
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
                                                {filteredUsers.map(u => (
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
                                                {userGroups.map(group => (
                                                    <div key={group.key} className="border-b border-[#edeeed] last:border-b-0 pb-2">
                                                        <div className="flex items-center justify-between px-4 py-3">
                                                            <div>
                                                                <p className="text-xs font-semibold text-[#5f6560] uppercase tracking-wider">
                                                                    {group.header}
                                                                </p>
                                                                {group.helperText && (
                                                                    <p className="text-[11px] text-[#5f6560]">
                                                                        {group.helperText}
                                                                    </p>
                                                                )}
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
                                                            {group.users.map(u => (
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
                                    {selected.length === 0 ? (
                                        <div className="p-4 text-sm text-[#5f6560] border border-[#edeeed] rounded-2xl bg-[#fcfcfb]">Aún no hay participantes</div>
                                    ) : (
                                        <ul className="h-80 overflow-y-auto border border-[#edeeed] rounded-2xl bg-[#fcfcfb]">
                                            {selected.map(p => (
                                                <li key={p.uid} className="grid grid-cols-5 items-center gap-3 px-4 py-3 border-b border-[#edeeed] last:border-b-0">
                                                    <div className="col-span-3">
                                                        <p className="text-sm font-semibold text-[#191c1c]">{p.name}</p>
                                                        <p className="text-xs text-[#5f6560]">{p.email}</p>
                                                    </div>
                                                    <div>
                                                        <select value={p.role} onChange={(e) => changeRole(p.uid, e.target.value as ParticipantRole)} className="w-full px-3 py-2 bg-white border border-[#edeeed] rounded-lg text-sm font-medium text-[#191c1c]">
                                                            <option value="attendee">Asistente</option>
                                                            <option value="speaker">Ponente</option>
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

                        <div className='flex justify-center items-center'>
                            <div>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-8 py-3 bg-[#1b3022] text-white font-bold rounded-xl transition-all shadow-md hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {submitting || creatingTeams ? 'Creando…' : 'Crear Reunión'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>

            </div>

        </Layout>
    )
}

export default NewMeetPage