import Layout from '@/components/layouts/layout'
import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import { BarChart3, Calendar, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MeetingKind } from '@/types/meeting'
import type { RecintoKey } from '@/lib/firebase/databaseResolver'
import {
    getAttendanceSummaryAcrossDatabases,
    getAttendanceSummaryForDatabase,
    getEmptyAttendanceSummary,
    type AttendanceSummary,
} from '@/services/meetings.analytics.service'

/**
 * Filtro de tipo para el dashboard: permite mostrar
 * todas las reuniones o filtrar por tipo específico.
 */
type TypeFilter = 'ALL' | MeetingKind

/**
 * Filtro de recinto para el dashboard: "ALL" para todos
 * o un recinto concreto cuando aplica multi-recinto.
 */
type RecintoFilter = 'ALL' | RecintoKey

/**
 * Etiquetas de meses usadas para mostrar y seleccionar
 * el periodo de análisis en el dashboard.
 */
const MONTH_LABELS = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
]

/**
 * Dashboard principal de asistencias.
 *
 * Muestra métricas mensuales de reuniones/capacitaciones (citados vs asistencias)
 * con filtros por mes, año, tipo de evento y recinto (incluyendo multi-recinto
 * para usuarios corporativos).
 */
function DashboardPage() {
    const { logout, user } = useAuth()
    const { database, availableDatabases, recinto, loading: dbLoading } = useDatabase()

    const now = useMemo(() => new Date(), [])
    const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear())
    const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1)
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
    const [recintoFilter, setRecintoFilter] = useState<RecintoFilter>('ALL')

    const [summary, setSummary] = useState<AttendanceSummary | null>(null)
    const [loading, setLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)

    const canFilterRecintos = recinto === 'corporativo'

    const years = useMemo<number[]>(() => {
        const currentYear = now.getFullYear()
        return [currentYear - 1, currentYear, currentYear + 1]
    }, [now])

    useEffect(() => {
        let cancelled = false

        async function loadMetrics(): Promise<void> {
            if (dbLoading) return

            setLoading(true)
            setError(null)

            try {
                const rangeStart = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0, 0).getTime()
                const rangeEndExclusive = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0).getTime() - 1

                const options = {
                    startTime: rangeStart,
                    endTime: rangeEndExclusive,
                    type: typeFilter === 'ALL' ? undefined : typeFilter,
                }

                let result: AttendanceSummary

                if (canFilterRecintos) {
                    const recintosToUse = recintoFilter === 'ALL'
                        ? availableDatabases
                        : availableDatabases.filter((db) => db.key === recintoFilter)

                    if (recintosToUse.length === 0) {
                        result = getEmptyAttendanceSummary()
                    } else {
                        result = await getAttendanceSummaryAcrossDatabases(
                            recintosToUse.map((db) => ({ url: db.url, key: db.key })),
                            options,
                        )
                    }
                } else {
                    if (!database) {
                        result = getEmptyAttendanceSummary()
                    } else {
                        result = await getAttendanceSummaryForDatabase(database, options)
                    }
                }

                if (!cancelled) {
                    setSummary(result)
                }
            } catch {
                if (!cancelled) {
                    setError('No fue posible cargar las métricas de asistencia')
                    setSummary(getEmptyAttendanceSummary())
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadMetrics().catch(() => {
            if (!cancelled) {
                setError('No fue posible cargar las métricas de asistencia')
                setSummary(getEmptyAttendanceSummary())
                setLoading(false)
            }
        })

        return () => {
            cancelled = true
        }
    }, [
        dbLoading,
        database,
        availableDatabases,
        canFilterRecintos,
        recintoFilter,
        selectedYear,
        selectedMonth,
        typeFilter,
    ])

    const totalInvited = summary?.totalInvited ?? 0
    const totalPresent = (summary?.totalPresent ?? 0) + (summary?.totalLate ?? 0)
    const totalMeetings = summary?.totalMeetings ?? 0
    const attendanceRate = totalInvited > 0 ? Math.round((totalPresent * 100) / totalInvited) : 0

    const currentRecintoLabel = useMemo(() => {
        if (canFilterRecintos) {
            if (recintoFilter === 'ALL') return 'Todos los recintos'
            const match = availableDatabases.find((db) => db.key === recintoFilter)
            return match?.name ?? recintoFilter
        }
        const match = availableDatabases.find((db) => db.key === recinto)
        return match?.name ?? recinto
    }, [availableDatabases, recinto, recintoFilter, canFilterRecintos])

    const byType = summary?.byType ?? getEmptyAttendanceSummary().byType

    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-20 backdrop-blur-xl">
                    <nav className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold mt-4 text-foreground flex items-center gap-3">
                                <BarChart3 className="w-7 h-7 text-primary" />
                                Dashboard de Asistencias
                            </h1>
                            <p className="text-sm text-muted-foreground mt-1">
                                Resumen mensual de reuniones y capacitaciones: asistencias vs citados.
                            </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            {user?.displayName && (
                                <span className="text-sm text-muted-foreground">{user.displayName}</span>
                            )}
                            <button
                                type="button"
                                onClick={logout}
                                className="px-3 py-1.5 text-xs bg-muted text-foreground rounded-lg border border-border hover:bg-muted/70 transition-colors"
                            >
                                Cerrar sesión
                            </button>
                        </div>
                    </nav>
                </header>

                <div className="max-w-6xl mx-auto p-6 mt-8 space-y-8">
                    <section className="bg-card rounded-2xl border border-border p-4 md:p-6">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Calendar className="w-4 h-4" />
                                <span>
                                    Mes seleccionado:{' '}
                                    <strong>
                                        {MONTH_LABELS[selectedMonth - 1]} {selectedYear}
                                    </strong>
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Mes</span>
                                    <select
                                        value={selectedMonth}
                                        onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                        className="px-3 py-1.5 bg-input border border-border rounded text-xs"
                                    >
                                        {MONTH_LABELS.map((label, index) => (
                                            <option key={label} value={index + 1}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Año</span>
                                    <select
                                        value={selectedYear}
                                        onChange={(e) => setSelectedYear(Number(e.target.value))}
                                        className="px-3 py-1.5 bg-input border border-border rounded text-xs"
                                    >
                                        {years.map((year) => (
                                            <option key={year} value={year}>
                                                {year}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Tipo</span>
                                    <select
                                        value={typeFilter}
                                        onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                                        className="px-3 py-1.5 bg-input border border-border rounded text-xs"
                                    >
                                        <option value="ALL">Todos</option>
                                        <option value="meeting">Reuniones</option>
                                        <option value="training">Capacitaciones</option>
                                        <option value="custom">Personalizado</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Recinto</span>
                                    {canFilterRecintos ? (
                                        <select
                                            value={recintoFilter}
                                            onChange={(e) => setRecintoFilter(e.target.value as RecintoFilter)}
                                            className="px-3 py-1.5 bg-input border border-border rounded text-xs"
                                        >
                                            <option value="ALL">Todos</option>
                                            {availableDatabases.map((db) => (
                                                <option key={db.key} value={db.key}>
                                                    {db.name}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span className="px-3 py-1.5 bg-muted border border-border rounded text-xs flex items-center gap-1">
                                            <Users className="w-3 h-3" />
                                            {currentRecintoLabel}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-2">
                            <Users className="w-3 h-3" />
                            Mostrando métricas para: <span className="font-medium">{currentRecintoLabel}</span>
                        </p>
                    </section>

                    {loading && (
                        <div className="p-3 text-sm text-muted-foreground">Cargando métricas…</div>
                    )}
                    {error && (
                        <div className="p-3 text-sm text-red-600 border border-red-300 rounded">{error}</div>
                    )}

                    {!loading && summary && (
                        <>
                            <section className="grid md:grid-cols-4 gap-6">
                                <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg">
                                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-semibold">
                                        Reuniones / Capacitaciones
                                    </p>
                                    <p className="text-4xl font-bold text-primary">{totalMeetings}</p>
                                    <p className="text-xs text-muted-foreground mt-1">Eventos programados en el mes filtrado.</p>
                                </div>
                                <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg">
                                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-semibold">Citados</p>
                                    <p className="text-4xl font-bold text-foreground">{totalInvited}</p>
                                    <p className="text-xs text-muted-foreground mt-1">Personas invitadas a estos eventos.</p>
                                </div>
                                <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg">
                                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-semibold">
                                        Asistencias (incluye tarde)
                                    </p>
                                    <p className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">{totalPresent}</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Presentes + llegadas tarde en los eventos del mes.
                                    </p>
                                </div>
                                <div className="bg-card rounded-2xl border border-border p-6 transition-all duration-300 hover:shadow-lg">
                                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-semibold">
                                        % Asistencia
                                    </p>
                                    <p className="text-4xl font-bold text-amber-600 dark:text-amber-400">{attendanceRate}%</p>
                                    <div className="mt-3 h-2 w-full bg-muted rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-primary transition-all duration-500"
                                            style={{ width: `${attendanceRate}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">Relación asistencias vs citados del periodo.</p>
                                </div>
                            </section>

                            <section className="bg-card rounded-2xl border border-border p-6">
                                <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                                    <BarChart3 className="w-5 h-5" />
                                    Detalle por tipo de evento
                                </h2>
                                <div className="grid md:grid-cols-3 gap-6">
                                    <div className="border border-border rounded-xl p-4">
                                        <p className="text-sm font-semibold text-foreground mb-1">Reuniones</p>
                                        <p className="text-xs text-muted-foreground mb-3">Tipo "meeting"</p>
                                        <p className="text-xs text-muted-foreground">Eventos: {byType.meeting.meetings}</p>
                                        <p className="text-xs text-muted-foreground">Citados: {byType.meeting.invited}</p>
                                        <p className="text-xs text-muted-foreground">Presentes: {byType.meeting.present}</p>
                                        <p className="text-xs text-muted-foreground">Tarde: {byType.meeting.late}</p>
                                        <p className="text-xs text-muted-foreground">Ausentes: {byType.meeting.absent}</p>
                                    </div>
                                    <div className="border border-border rounded-xl p-4">
                                        <p className="text-sm font-semibold text-foreground mb-1">Capacitaciones</p>
                                        <p className="text-xs text-muted-foreground mb-3">Tipo "training"</p>
                                        <p className="text-xs text-muted-foreground">Eventos: {byType.training.meetings}</p>
                                        <p className="text-xs text-muted-foreground">Citados: {byType.training.invited}</p>
                                        <p className="text-xs text-muted-foreground">Presentes: {byType.training.present}</p>
                                        <p className="text-xs text-muted-foreground">Tarde: {byType.training.late}</p>
                                        <p className="text-xs text-muted-foreground">Ausentes: {byType.training.absent}</p>
                                    </div>
                                    <div className="border border-border rounded-xl p-4">
                                        <p className="text-sm font-semibold text-foreground mb-1">Personalizados</p>
                                        <p className="text-xs text-muted-foreground mb-3">Tipo "custom"</p>
                                        <p className="text-xs text-muted-foreground">Eventos: {byType.custom.meetings}</p>
                                        <p className="text-xs text-muted-foreground">Citados: {byType.custom.invited}</p>
                                        <p className="text-xs text-muted-foreground">Presentes: {byType.custom.present}</p>
                                        <p className="text-xs text-muted-foreground">Tarde: {byType.custom.late}</p>
                                        <p className="text-xs text-muted-foreground">Ausentes: {byType.custom.absent}</p>
                                    </div>
                                </div>
                            </section>
                        </>
                    )}
                </div>
            </div>
        </Layout>
    )
}

export default DashboardPage