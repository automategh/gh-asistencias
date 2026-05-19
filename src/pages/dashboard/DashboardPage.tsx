import Layout from '@/components/layouts/layout'
import { useAuth } from '@/context/AuthContext'
import { useDatabase } from '@/context/DatabaseContext'
import { BarChart3, Calendar, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MeetingKind } from '@/types/meeting'
import type { RecintoKey } from '@/lib/firebase/databaseResolver'
import {
    getAttendanceSummaryFromCloudFunction,
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
    const { databaseUrl, availableDatabases, recinto, loading: dbLoading, isCorporateUser } = useDatabase()
    const emptySummary = useMemo(() => getEmptyAttendanceSummary(), [])

    const now = useMemo(() => new Date(), [])
    const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear())
    const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1)
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
    const [recintoFilter, setRecintoFilter] = useState<RecintoFilter>(recinto)

    const [summary, setSummary] = useState<AttendanceSummary>(emptySummary)
    const [loading, setLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)

    /**
     * Indica si el usuario actual puede filtrar por recintos.
     * Solo es verdadero cuando el recinto resuelto es "corporativo".
     */
    const canFilterRecintos = isCorporateUser

    /**
     * Años disponibles para el filtro del dashboard (año anterior, actual y siguiente).
     */
    const years = useMemo<number[]>(() => {
        const currentYear = now.getFullYear()
        return [currentYear - 1, currentYear, currentYear + 1]
    }, [now])

    useEffect(() => {
        let cancelled = false

        /**
         * Carga y calcula las métricas de asistencia según los filtros
         * seleccionados (mes, año, tipo y recinto) y actualiza el estado
         * del resumen (`summary`).
         */
        async function loadMetrics(): Promise<void> {
            if (dbLoading) {
                setLoading(true)
                return
            }

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
                        result = await getAttendanceSummaryFromCloudFunction(
                            recintosToUse.map((db) => db.url),
                            options,
                        )
                    }
                } else {
                    if (!databaseUrl) {
                        result = getEmptyAttendanceSummary()
                    } else {
                        result = await getAttendanceSummaryFromCloudFunction([databaseUrl], options)
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
        databaseUrl,
        availableDatabases,
        canFilterRecintos,
        recintoFilter,
        selectedYear,
        selectedMonth,
        typeFilter,
    ])

    const isLoadingMetrics = dbLoading || loading

    const totalInvited = summary.totalInvited
    const totalPresent = summary.totalPresent + summary.totalLate
    const totalMeetings = summary.totalMeetings
    const attendanceRate = totalInvited > 0 ? Math.round((totalPresent * 100) / totalInvited) : 0
    const hasMetrics = totalMeetings > 0 || totalInvited > 0 || totalPresent > 0 || summary.totalAbsent > 0

    /**
     * Etiqueta legible del recinto actualmente aplicado en el dashboard.
     * Para corporativo puede ser "Todos los recintos" o un recinto específico;
     * para el resto, siempre muestra su propio recinto.
     */
    const currentRecintoLabel = useMemo(() => {
        if (canFilterRecintos) {
            if (recintoFilter === 'ALL') return 'Todos los recintos'
            const match = availableDatabases.find((db) => db.key === recintoFilter)
            return match?.name ?? recintoFilter
        }
        const match = availableDatabases.find((db) => db.key === recinto)
        return match?.name ?? recinto
    }, [availableDatabases, recinto, recintoFilter, canFilterRecintos])

    const byType = summary.byType

    const detailCards = [
        {
            title: 'Reuniones',
            subtitle: 'Tipo meeting',
            accentClass: 'bg-[#dce8f8] text-[#123a68]',
            stats: byType.meeting,
        },
        {
            title: 'Capacitaciones',
            subtitle: 'Tipo training',
            accentClass: 'bg-[#d0e9d4] text-[#1b3022]',
            stats: byType.training,
        },
        {
            title: 'Personalizados',
            subtitle: 'Tipo custom',
            accentClass: 'bg-[#ffefc2] text-[#5b4300]',
            stats: byType.custom,
        },
    ]

    return (
        <Layout>
            <div className="bg-linear-to-br from-background via-muted/5 to-background min-h-screen">
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs border-b border-[#edeeed]">
                    <nav className="px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center gap-6">
                        <div>
                            <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                                <span>Inicio</span>
                                <span>/</span>
                                <span>Dashboard</span>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight text-[#191c1c] flex items-center gap-3">
                                <BarChart3 className="w-7 h-7 text-[#1b3022]" />
                                Dashboard de Asistencias
                            </h1>
                            <p className="text-sm text-[#5f6560] mt-1">
                                Resumen mensual de actividades: asistencias vs citados.
                            </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            {user?.displayName && (
                                <span className="text-sm text-[#5f6560]">{user.displayName}</span>
                            )}
                            <button
                                type="button"
                                onClick={logout}
                                className="px-4 py-2.5 bg-zinc-300 rounded-2xl cursor-pointer text-sm font-medium text-foreground hover:bg-zinc-200 transition-colors"
                            >
                                Cerrar sesión
                            </button>
                        </div>
                    </nav>
                </header>

                <div className="px-4 md:px-12 py-10 md:py-10 space-y-10 max-w-7xl mx-auto">
                    <section className="bg-[#f3f4f3] p-6 rounded-xl space-y-4">
                        <div className="flex flex-wrap items-end gap-6">
                            <div className="flex-1 min-w-40">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Mes</label>
                                <div className="relative">
                                    <select
                                        value={selectedMonth}
                                        onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                        className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-[#191c1c] appearance-none focus:ring-2 focus:ring-primary-container"
                                    >
                                        {MONTH_LABELS.map((label, index) => (
                                            <option key={label} value={index + 1}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="flex-1 min-w-32">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Año</label>
                                <div className="relative">
                                    <select
                                        value={selectedYear}
                                        onChange={(e) => setSelectedYear(Number(e.target.value))}
                                        className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-[#191c1c] appearance-none focus:ring-2 focus:ring-primary-container"
                                    >
                                        {years.map((year) => (
                                            <option key={year} value={year}>
                                                {year}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="flex-1 min-w-40">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Tipo</label>
                                <div className="relative">
                                    <select
                                        value={typeFilter}
                                        onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                                        className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-[#191c1c] appearance-none focus:ring-2 focus:ring-primary-container"
                                    >
                                        <option value="ALL">Todos</option>
                                        <option value="meeting">Reuniones</option>
                                        <option value="training">Capacitaciones</option>
                                        <option value="custom">Personalizado</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex-1 min-w-48">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Recinto</label>
                                {canFilterRecintos ? (
                                    <div className="relative">
                                        <select
                                            value={recintoFilter}
                                            onChange={(e) => setRecintoFilter(e.target.value as RecintoFilter)}
                                            className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-[#191c1c] appearance-none focus:ring-2 focus:ring-primary-container"
                                        >
                                            <option value="ALL">Todos</option>
                                            {availableDatabases.map((db) => (
                                                <option key={db.key} value={db.key}>
                                                    {db.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div className="w-full bg-white rounded-xl py-3 px-4 text-sm font-semibold text-[#191c1c] flex items-center gap-2">
                                        <Users className="w-4 h-4 text-[#5f6560]" />
                                        {currentRecintoLabel}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#5f6560]">
                            <Calendar className="w-4 h-4" />
                            <span>
                                Mostrando métricas de <span className="font-semibold text-[#191c1c]">{MONTH_LABELS[selectedMonth - 1]} {selectedYear}</span> para <span className="font-semibold text-[#191c1c]">{currentRecintoLabel}</span>
                            </span>
                        </div>
                    </section>

                    {isLoadingMetrics && (
                        <div className="bg-white rounded-2xl p-6 text-sm text-[#5f6560] shadow-[0_20px_20px_rgba(25,28,28,0.04)]">
                            Cargando métricas...
                        </div>
                    )}
                    {error && (
                        <div className="bg-[#fff6f5] border border-[#f0c7c2] rounded-2xl p-6 text-sm text-[#8c1d18] shadow-[0_20px_20px_rgba(25,28,28,0.04)]">
                            {error}
                        </div>
                    )}

                    {!isLoadingMetrics && !hasMetrics && !error && (
                        <div className="bg-white rounded-2xl p-8 text-center shadow-[0_20px_20px_rgba(25,28,28,0.04)] border border-[#edeeed]">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#f3f4f3] flex items-center justify-center">
                                <Calendar className="w-8 h-8 text-[#5f6560]" />
                            </div>
                            <h2 className="text-lg font-bold text-[#191c1c] mb-2">No hay métricas para este periodo</h2>
                            <p className="text-sm text-[#5f6560] max-w-xl mx-auto">
                                No se encontraron actividades ni registros de asistencia para los filtros seleccionados.
                                Cambia el mes, año, tipo o recinto para consultar otro periodo.
                            </p>
                        </div>
                    )}

                    {!isLoadingMetrics && hasMetrics && (
                        <>
                            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                                <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 rounded-xl bg-[#dce8f8] text-[#123a68]">
                                            <Calendar className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <p className="text-3xl font-extrabold text-[#191c1c]">{totalMeetings}</p>
                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Actividades</p>
                                    <p className="text-xs text-[#5f6560] mt-3">Eventos programados en el mes filtrado.</p>
                                </div>
                                <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 rounded-xl bg-[#ede7d3] text-[#534520]">
                                            <Users className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <p className="text-3xl font-extrabold text-[#191c1c]">{totalInvited}</p>
                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Citados</p>
                                    <p className="text-xs text-[#5f6560] mt-3">Personas invitadas a las actividades del periodo.</p>
                                </div>
                                <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 rounded-xl bg-[#d0e9d4] text-[#1b3022]">
                                            <Users className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <p className="text-3xl font-extrabold text-[#191c1c]">{totalPresent}</p>
                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Asistencias</p>
                                    <p className="text-xs text-[#5f6560] mt-3">Presentes y llegadas tarde registradas.</p>
                                </div>
                                <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 rounded-xl bg-[#ffefc2] text-[#5b4300]">
                                            <BarChart3 className="w-5 h-5" />
                                        </div>
                                        <span className="text-xs font-bold text-[#7b5c00] bg-[#fff8df] px-2 py-1 rounded">{attendanceRate}%</span>
                                    </div>
                                    <p className="text-3xl font-extrabold text-[#191c1c]">{attendanceRate}%</p>
                                    <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Asistencia</p>
                                    <div className="mt-3 h-2.5 w-full bg-[#edeeed] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-[#1b3022] transition-all duration-500"
                                            style={{ width: `${attendanceRate}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-[#5f6560] mt-3">Relación de asistentes reales frente a citados.</p>
                                </div>
                            </section>

                            <section className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] overflow-hidden">
                                <div className="p-8 border-b border-[#edeeed] flex items-center justify-between gap-4">
                                    <div>
                                        <h2 className="text-xl font-bold text-emerald-950 flex items-center gap-2">
                                            <BarChart3 className="w-5 h-5" />
                                            Detalle por tipo de evento
                                        </h2>
                                        <p className="text-xs text-outline font-medium mt-1">Distribución de citados y asistencias por categoría.</p>
                                    </div>
                                </div>
                                <div className="p-8 grid md:grid-cols-3 gap-6">
                                    {detailCards.map((card) => (
                                        <div key={card.title} className="rounded-2xl border border-[#edeeed] p-6 bg-[#fcfcfb] shadow-[0_12px_24px_rgba(25,28,28,0.03)]">
                                            <div className="flex items-center justify-between gap-3 mb-5">
                                                <div>
                                                    <p className="text-lg font-bold text-[#191c1c]">{card.title}</p>
                                                    <p className="text-[11px] uppercase tracking-widest text-outline font-bold mt-1">{card.subtitle}</p>
                                                </div>
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${card.accentClass}`}>
                                                    {card.stats.meetings} eventos
                                                </span>
                                            </div>
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between text-sm text-[#434843]">
                                                    <span>Citados</span>
                                                    <span className="font-bold text-[#191c1c]">{card.stats.invited}</span>
                                                </div>
                                                <div className="flex items-center justify-between text-sm text-[#434843]">
                                                    <span>Presentes</span>
                                                    <span className="font-bold text-[#191c1c]">{card.stats.present}</span>
                                                </div>
                                                <div className="flex items-center justify-between text-sm text-[#434843]">
                                                    <span>Tarde</span>
                                                    <span className="font-bold text-[#191c1c]">{card.stats.late}</span>
                                                </div>
                                                <div className="flex items-center justify-between text-sm text-[#434843]">
                                                    <span>Ausentes</span>
                                                    <span className="font-bold text-[#191c1c]">{card.stats.absent}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
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