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

    type UserItem = { uid: string; name: string; email: string; recinto: RecintoKey; department?: string | null }
    const [allUsers, setAllUsers] = useState<UserItem[]>([])
    const [search, setSearch] = useState<string>('')
    const [groupBy, setGroupBy] = useState<'none' | 'recinto' | 'department' | 'recintoDepartment'>('none')
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

    const groupedUsers = useMemo(() => {
        if (groupBy === 'none') return null
        const groups: Record<string, UserItem[]> = {}
        filteredUsers.forEach(u => {
            const departmentKey = u.department && u.department.trim().length > 0 ? u.department.trim() : 'Sin departamento'
            const key = groupBy === 'recinto'
                ? u.recinto
                : groupBy === 'department'
                    ? departmentKey
                    : `${u.recinto}||${departmentKey}`
            if (!groups[key]) groups[key] = []
            groups[key].push(u)
        })
        return groups
    }, [filteredUsers, groupBy])

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
                    attendees: selected.map(participant => ({
                        email: participant.email,
                        name: participant.name,
                        type: 'required',
                    })),
                })

                setSuccess('Reunión creada correctamente y sincronizada con Teams')
            } catch (teamsError) {
                const message = teamsError instanceof Error ? teamsError.message : 'Error al crear la reunión en Teams'
                // No interrumpe la creación local; solo informa el problema con Teams.
                setSuccess('Reunión creada correctamente, pero hubo un problema al crearla en Teams')
                console.error('Error al crear reunión en Teams:', message)
            } finally {
                setCreatingTeams(false)
            }
            setForm({
                title: '', type: 'meeting', customType: '', satisfactionSurveyId: '', description: '', location: '', startTime: '', endTime: '',
            })
            setSelected([])
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Error al crear la reunión'
            setError(message)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-10 backdrop-blur-xl">
                    <nav className="max-w-4xl mx-auto px-6 py-4">
                        <h1 className="text-3xl font-bold mt-4 text-foreground">Nueva Reunión</h1>
                    </nav>
                </header>

                <div className="max-w-4xl mx-auto p-6 mt-8">
                    <form className="bg-card rounded-2xl border border-border p-6" onSubmit={handleSubmit}>
                        <div className="grid md:grid-cols-2 gap-6 mb-6">
                            <div>
                                <label className="block text-sm font-semibold text-foreground mb-2">Título *</label>
                                <input
                                    type="text"
                                    name="title"
                                    value={form.title}
                                    onChange={handleChange}
                                    placeholder="Título de la reunión"
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-foreground mb-2">Tipo *</label>
                                <select
                                    name="type"
                                    value={form.type}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800"
                                >
                                    <option value="meeting">Reunión</option>
                                    <option value="training">Capacitación</option>
                                    <option value="custom">Personalizado</option>
                                </select>
                            </div>
                        </div>

                        {form.type === 'training' && (
                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-foreground mb-2">Encuesta de satisfacción</label>
                                {trainingSurveys.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        No hay encuestas de capacitación configuradas en esta base de datos.
                                    </p>
                                ) : (
                                    <select
                                        name="satisfactionSurveyId"
                                        value={form.satisfactionSurveyId}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800"
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
                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-foreground mb-2">Tipo personalizado *</label>
                                <input
                                    type="text"
                                    name="customType"
                                    value={form.customType}
                                    onChange={handleChange}
                                    placeholder="Ej. Taller, Charla"
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        )}

                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-foreground mb-2">Descripción</label>
                            <textarea
                                name="description"
                                value={form.description}
                                onChange={handleChange}
                                placeholder="Descripción de la reunión"
                                rows={4}
                                className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800"
                            />
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-foreground mb-2">Ubicación *</label>
                            <input
                                type="text"
                                name="location"
                                value={form.location}
                                onChange={handleChange}
                                placeholder="Sala de conferencias o ubicación"
                                className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800"
                            />
                        </div>

                        <div className="grid md:grid-cols-2 gap-6 mb-6">
                            <div>
                                <label className="block text-sm font-semibold text-foreground mb-2">Hora de Inicio *</label>
                                <input
                                    type="datetime-local"
                                    name="startTime"
                                    value={form.startTime}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-foreground mb-2">Hora de Fin *</label>
                                <input
                                    type="datetime-local"
                                    name="endTime"
                                    value={form.endTime}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800"
                                />
                            </div>
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-foreground mb-2">Participantes</label>
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <div className="flex flex-col gap-3">
                                        <input
                                            type="text"
                                            name="participantSearch"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            placeholder="Buscar por nombre o correo"
                                            className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>Agrupar por</span>
                                            <select
                                                value={groupBy}
                                                onChange={(e) => setGroupBy(e.target.value as 'none' | 'recinto' | 'department' | 'recintoDepartment')}
                                                className="px-3 py-1.5 bg-input border border-border rounded text-xs"
                                            >
                                                <option value="none">Sin agrupación</option>
                                                <option value="recinto">Recinto</option>
                                                <option value="department">Departamento</option>
                                                <option value="recintoDepartment">Recinto y departamento</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="mt-3 h-80 overflow-y-auto border border-border rounded">
                                        {filteredUsers.length === 0 ? (
                                            <div className="p-3 text-sm text-muted-foreground">Sin resultados</div>
                                        ) : groupBy === 'none' || !groupedUsers ? (
                                            <ul>
                                                {filteredUsers.map(u => (
                                                    <li key={u.uid} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-b-0">
                                                        <div>
                                                            <p className="text-sm font-medium text-foreground">{u.name}</p>
                                                            <p className="text-xs text-muted-foreground">{u.email}</p>
                                                        </div>
                                                        <button type="button" onClick={() => addUser(u)} className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary-light">Añadir</button>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="space-y-3">
                                                {Object.entries(groupedUsers).map(([groupKey, users]) => {
                                                    const isRecintoDepartment = groupBy === 'recintoDepartment'
                                                    let displayRecinto: string | null = null
                                                    let displayDepartment: string | null = null

                                                    if (isRecintoDepartment) {
                                                        const [recintoKey, departmentKey] = groupKey.split('||')
                                                        displayRecinto = recintoKey
                                                        displayDepartment = departmentKey
                                                    }

                                                    return (
                                                        <div key={groupKey} className="border-b border-border last:border-b-0 pb-2">
                                                            <div className="flex items-center justify-between px-3 py-2">
                                                                <div>
                                                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                                                        {groupBy === 'recinto' && `Recinto: ${groupKey}`}
                                                                        {groupBy === 'department' && `Departamento: ${groupKey}`}
                                                                        {isRecintoDepartment && displayRecinto && displayDepartment && `Recinto: ${displayRecinto} · Departamento: ${displayDepartment}`}
                                                                    </p>
                                                                    {(groupBy === 'department' || isRecintoDepartment) && (
                                                                        <p className="text-[11px] text-muted-foreground">
                                                                            {isRecintoDepartment && displayDepartment && displayRecinto
                                                                                ? `Estos son los de ${displayDepartment.toLowerCase()} del recinto ${displayRecinto.toLowerCase()}.`
                                                                                : `Estos son los de ${groupKey.toLowerCase()}.`}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => addUsersBulk(users)}
                                                                    className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary-light"
                                                                >
                                                                    Agregar todos
                                                                </button>
                                                            </div>
                                                            <ul>
                                                                {users.map(u => (
                                                                    <li key={u.uid} className="flex items-center justify-between px-3 py-1.5">
                                                                        <div>
                                                                            <p className="text-sm font-medium text-foreground">{u.name}</p>
                                                                            <p className="text-xs text-muted-foreground">{u.email}</p>
                                                                        </div>
                                                                        <button type="button" onClick={() => addUser(u)} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary-light">Añadir</button>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground mb-2">Seleccionados</p>
                                    {selected.length === 0 ? (
                                        <div className="p-3 text-sm text-muted-foreground border border-border rounded">Aún no hay participantes</div>
                                    ) : (
                                        <ul className="h-80 overflow-y-auto border border-border rounded">
                                            {selected.map(p => (
                                                <li key={p.uid} className="grid grid-cols-5 items-center gap-2 px-3 py-2 border-b border-border last:border-b-0">
                                                    <div className="col-span-3">
                                                        <p className="text-sm font-medium text-foreground">{p.name}</p>
                                                        <p className="text-xs text-muted-foreground">{p.email}</p>
                                                    </div>
                                                    <div>
                                                        <select value={p.role} onChange={(e) => changeRole(p.uid, e.target.value as ParticipantRole)} className="w-full px-2 py-2 bg-input border border-border rounded text-sm">
                                                            <option value="attendee">Asistente</option>
                                                            <option value="speaker">Ponente</option>
                                                            <option value="host">Anfitrión</option>
                                                        </select>
                                                    </div>
                                                    <div className="text-right">
                                                        <button type="button" onClick={() => removeUser(p.uid)} className="px-2 py-1 text-sm border border-border rounded hover:bg-muted">Quitar</button>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="mb-4 p-3 border border-red-300 text-red-700 rounded">{error}</div>
                        )}
                        {success && (
                            <div className="mb-4 p-3 border border-green-300 text-green-700 rounded">{success}</div>
                        )}

                        <div className='flex justify-center items-center'>
                            <div>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-1 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md disabled:opacity-50"
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