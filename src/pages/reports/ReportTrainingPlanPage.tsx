import Layout from "@/components/layouts/layout"
import { ChevronDown, Clock, Download, IterationCw, Smile, TrendingUp, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { useDatabase } from "@/context/DatabaseContext"
import { getDepartmentNames } from "@/services/departaments/departments.service"
import {
    getTrainingCountsByDepartmentForYear,
    getTrainingKpiForYear,
    getTrainingYearsForDatabase,
    getTrainingHoursByRoleForYear,
    type DepartmentTrainingCount,
    type TrainingHoursByRole,
    type TrainingKpiSummary,
} from "@/services/meetings.analytics.service"

/**
 * Página de reporte para el plan de formación.
 * Permite filtrar por periodo anual y por área/departamento,
 * utilizando los departamentos configurados en la base de datos actual.
 */
function ReportTrainingPlanPage() {
    const { database } = useDatabase()
    const [departments, setDepartments] = useState<string[]>([])
    const [years, setYears] = useState<number[]>([])
    const [selectedYear, setSelectedYear] = useState<number | null>(null)
    const [selectedDepartment, setSelectedDepartment] = useState<string>("")

    const [totalTrainings, setTotalTrainings] = useState<number>(0)
    const [totalHours, setTotalHours] = useState<number>(0)
    const [totalAttended, setTotalAttended] = useState<number>(0)
    const [departmentTrainingCounts, setDepartmentTrainingCounts] = useState<DepartmentTrainingCount[]>([])
    const [hoursByRole, setHoursByRole] = useState<TrainingHoursByRole[]>([])
    const [selectedAreaForChart, setSelectedAreaForChart] = useState<string | null>(null)
    const [trainingsDeltaPct, setTrainingsDeltaPct] = useState<number | null>(null)
    const [hoursDeltaPct, setHoursDeltaPct] = useState<number | null>(null)
    const [attendedDeltaPct, setAttendedDeltaPct] = useState<number | null>(null)
    const [isGenerating, setIsGenerating] = useState<boolean>(false)

    useEffect(() => {
        let cancelled = false

        async function loadFilters(): Promise<void> {
            try {
                if (!database) {
                    setDepartments([])
                    setYears([])
                    return
                }

                const [names, trainingYears] = await Promise.all([
                    getDepartmentNames(database),
                    getTrainingYearsForDatabase(database),
                ])

                if (!cancelled) {
                    setDepartments(names)
                    setYears(trainingYears)

                    if (trainingYears.length > 0) {
                        setSelectedYear((current) => current ?? trainingYears[0])
                    } else {
                        setSelectedYear(null)
                    }
                }
            } catch (error) {
                console.error("No fue posible cargar los filtros del plan de formación:", error)
            }
        }

        void loadFilters()

        return () => {
            cancelled = true
        }
    }, [database])

    const handleGeneratePlan = async (): Promise<void> => {
        if (!database || selectedYear === null) {
            setTotalTrainings(0)
            setTotalHours(0)
            setTotalAttended(0)
            setTrainingsDeltaPct(null)
            setHoursDeltaPct(null)
            setAttendedDeltaPct(null)
            setDepartmentTrainingCounts([])
            setSelectedAreaForChart(null)
            setHoursByRole([])
            return
        }

        try {
            setIsGenerating(true)
            const previousYear = selectedYear - 1

            const [currentKpi, previousKpi, rawDepartmentCounts, hoursByRoleForYear] = await Promise.all([
                getTrainingKpiForYear(database, selectedYear, selectedDepartment || null),
                getTrainingKpiForYear(database, previousYear, selectedDepartment || null),
                getTrainingCountsByDepartmentForYear(database, selectedYear),
                getTrainingHoursByRoleForYear(database, selectedYear, selectedDepartment || null),
            ]) as [
                TrainingKpiSummary,
                TrainingKpiSummary,
                DepartmentTrainingCount[],
                TrainingHoursByRole[],
            ]

            setTotalTrainings(currentKpi.totalTrainings)
            setTotalHours(currentKpi.totalHours)
            setTotalAttended(currentKpi.totalAttended)

            const filteredDepartmentCounts = selectedDepartment
                ? rawDepartmentCounts.filter((item) => item.department === selectedDepartment)
                : rawDepartmentCounts

            setDepartmentTrainingCounts(filteredDepartmentCounts)
            setHoursByRole(hoursByRoleForYear)

            const calculateDelta = (current: number, previous: number): number | null => {
                if (previous <= 0) {
                    return null
                }
                return ((current - previous) / previous) * 100
            }

            setTrainingsDeltaPct(calculateDelta(currentKpi.totalTrainings, previousKpi.totalTrainings))
            setHoursDeltaPct(calculateDelta(currentKpi.totalHours, previousKpi.totalHours))
            setAttendedDeltaPct(calculateDelta(currentKpi.totalAttended, previousKpi.totalAttended))
        } catch (error) {
            console.error("No fue posible cargar los KPIs del plan de formación:", error)
        } finally {
            setIsGenerating(false)
        }
    }

    /**
     * Maneja la selección de un área/departamento desde la tarjeta
     * "Capacitaciones por Área" para actualizar el gráfico dependiente.
     */
    const handleAreaClick = (departmentName: string): void => {
        setSelectedAreaForChart(departmentName)
    }

    return (
        <Layout>
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className='px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center'>
                        <div>
                            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-[#664d2d] ">Modulo Reportes</span>
                            <h1 className="text-3xl font-bold tracking-tight">Plan de formación</h1>
                        </div>

                        <div>
                            <button className="flex items-center gap-x-4 px-4 py-2.5 bg-zinc-300 rounded-2xl cursor-pointer">
                                <Download className="w-4 h-4" />
                                <span className="text-sm font-medium text-foreground">Exportar</span>
                            </button>
                        </div>
                    </nav>
                </header>


                <div className='px-4 md:px-12 py-10 md:py-10 space-y-10'>
                    <section className="bg-[#f3f4f3] p-6 rounded-xl space-y-4 max-w-7xl mx-auto">
                        <div className="flex flex-wrap items-end gap-6">
                            <div className="flex-1 min-w-50">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Periodo Anual</label>
                                <div className="relative">
                                    <select
                                        className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-on-surface appearance-none focus:ring-2 focus:ring-primary-container"
                                        value={selectedYear ?? ""}
                                        onChange={(event) => {
                                            const value = event.target.value
                                            setSelectedYear(value ? Number(value) : null)
                                        }}
                                    >
                                        {years.length === 0 ? (
                                            <option value="" disabled>
                                                No hay capacitaciones registradas
                                            </option>
                                        ) : (
                                            years.map((year) => (
                                                <option key={year} value={year}>
                                                    {year} {year === new Date().getFullYear() ? "- Ciclo Actual" : "- Histórico"}
                                                </option>
                                            ))
                                        )}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-3 text-outline pointer-events-none" />
                                </div>
                            </div>
                            <div className="flex-1 min-w-50">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Área / Departamento</label>
                                <div className="relative">
                                    <select
                                        className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-on-surface appearance-none focus:ring-2 focus:ring-primary-container"
                                        value={selectedDepartment}
                                        onChange={(event) => {
                                            setSelectedDepartment(event.target.value)
                                        }}
                                    >
                                        <option value="">Todas las Áreas</option>
                                        {departments.map((name) => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-3 text-outline pointer-events-none" />
                                </div>
                            </div>
                            <div className="flex-none">
                                <button
                                    className="bg-[#1b3022] text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-primary transition-all shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
                                    onClick={() => { void handleGeneratePlan() }}
                                    disabled={isGenerating || !database || selectedYear === null}
                                >
                                    <IterationCw className={`w-4 h-4 ${isGenerating ? "animate-spin" : ""}`} />
                                    {isGenerating ? "Generando..." : "Generar Plan"}
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* kpi section */}
                    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">

                        {/* kpi total de capacitaciones */}
                        <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 rounded-xl bg-[#d0e9d4] text-emerald-900">
                                    <TrendingUp className="w-5 h-5" />
                                </div>
                                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                    {isGenerating
                                        ? "Calculando..."
                                        : selectedYear && trainingsDeltaPct !== null
                                            ? `${trainingsDeltaPct >= 0 ? "+" : ""}${trainingsDeltaPct.toFixed(0)}% vs ${selectedYear - 1}`
                                            : "Sin datos previos"}
                                </span>
                            </div>
                            <p className="text-3xl font-extrabold text-on-surface">
                                {isGenerating ? (
                                    <span className="inline-block h-7 w-20 bg-zinc-200 rounded-md animate-pulse" />
                                ) : (
                                    totalTrainings
                                )}
                            </p>
                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Total de Capacitaciones</p>
                        </div>

                        {/* kpi de total de horas */}
                        <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 rounded-xl bg-[#D9E6D8] text-emerald-900">
                                    <Clock className="w-5 h-5" />
                                </div>
                                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                    {isGenerating
                                        ? "Calculando..."
                                        : selectedYear && hoursDeltaPct !== null
                                            ? `${hoursDeltaPct >= 0 ? "+" : ""}${hoursDeltaPct.toFixed(0)}% vs ${selectedYear - 1}`
                                            : "Sin datos previos"}
                                </span>
                            </div>
                            <p className="text-3xl font-extrabold text-on-surface">
                                {isGenerating ? (
                                    <span className="inline-block h-7 w-24 bg-zinc-200 rounded-md animate-pulse" />
                                ) : (
                                    Math.round(totalHours)
                                )}
                            </p>
                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Total de Horas</p>
                        </div>

                        {/* kpi de promedio de asistencias */}
                        <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 rounded-xl bg-[#FFDD86] text-[#2a1800]">
                                    <Users className="w-5 h-5" />
                                </div>
                                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                    {isGenerating
                                        ? "Calculando..."
                                        : selectedYear && attendedDeltaPct !== null
                                            ? `${attendedDeltaPct >= 0 ? "+" : ""}${attendedDeltaPct.toFixed(0)}% vs ${selectedYear - 1}`
                                            : "Sin datos previos"}
                                </span>
                            </div>
                            <p className="text-3xl font-extrabold text-on-surface">
                                {isGenerating ? (
                                    <span className="inline-block h-7 w-20 bg-zinc-200 rounded-md animate-pulse" />
                                ) : (
                                    totalAttended
                                )}
                            </p>
                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Total de Asistencias</p>
                        </div>

                        {/* kpi de promedio de satisfacción */}
                        <div className="bg-white p-6 rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/20 group hover:border-emerald-900/30 transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 rounded-xl bg-[#ffdad6] text-[#93000a]">
                                    <Smile className="w-5 h-5" />
                                </div>
                                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">+12% vs 2023</span>
                            </div>
                            <p className="text-3xl font-extrabold text-on-surface">
                                {isGenerating ? (
                                    <span className="inline-block h-7 w-24 bg-zinc-200 rounded-md animate-pulse" />
                                ) : (
                                    148
                                )}
                            </p>
                            <p className="text-[10px] uppercase tracking-widest text-outline font-bold mt-1">Promedio de Satisfacción</p>
                        </div>
                    </section>



                    {/* section de los graficos de capacitaciones por area y horas por cargo 
                        - para este bloque vamos a mostrar una card donde se distribuya por area y en la otra card se muestre por cargo dependiendo de la seccion que el usuario le de click en la card anterior, para esto se puede usar un estado que guarde la seccion seleccionada y dependiendo de eso mostrar un grafico u otro, para los graficos se pueden usar componentes de librerias como recharts o chart.js, y para los datos se pueden generar datos de ejemplo o usar datos reales si es que ya existen en la base de datos
                    */}
                    <section className="grid md:grid-cols-2 gap-6 max-w-7xl mx-auto">
                        <div className="bg-white rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] p-8">
                            <div className="flex justify-between items-center mb-8">
                                <div>
                                    <h3 className="text-xl font-bold text-emerald-950">Capacitaciones por Área</h3>
                                    <p className="text-xs text-outline font-medium">Distribución departamental del plan actual</p>
                                </div>
                            </div>
                            <div className="space-y-6">
                                {isGenerating ? (
                                    <div className="space-y-3">
                                        {[1, 2, 3].map((row) => (
                                            <div key={row} className="space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="h-3 w-32 bg-zinc-200 rounded-md animate-pulse" />
                                                    <span className="h-3 w-16 bg-zinc-200 rounded-md animate-pulse" />
                                                </div>
                                                <div className="h-3 w-full bg-zinc-200 rounded-full animate-pulse" />
                                            </div>
                                        ))}
                                    </div>
                                ) : departmentTrainingCounts.length === 0 ? (
                                    <p className="text-xs text-on-surface-variant">
                                        Genera el plan para visualizar la distribución de capacitaciones por área en el
                                        periodo seleccionado.
                                    </p>
                                ) : (
                                    (() => {
                                        /**
                                         * Determina el número máximo de capacitaciones entre todos los departamentos
                                         * para poder escalar las barras de distribución de forma proporcional.
                                         */
                                        const maxTrainings = departmentTrainingCounts.reduce<number>((max, item) => {
                                            return item.trainings > max ? item.trainings : max
                                        }, 0)

                                        return departmentTrainingCounts.map((item) => {
                                            /**
                                             * Calcula el ancho de la barra para el departamento actual en función
                                             * de sus capacitaciones respecto al máximo del conjunto. Se garantiza un
                                             * ancho mínimo del 6% para que las barras con pocos registros sigan siendo visibles.
                                             */
                                            const widthPercentage = maxTrainings > 0
                                                ? Math.max(6, (item.trainings / maxTrainings) * 100)
                                                : 0

                                            const isSelected = selectedAreaForChart === item.department

                                            return (
                                                <div
                                                    key={item.department}
                                                    className={`space-y-2 rounded-lg px-2 py-1 transition-colors cursor-pointer ${isSelected ? "bg-emerald-50" : "hover:bg-emerald-50/70"}`}
                                                    onClick={() => handleAreaClick(item.department)}
                                                >
                                                    <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                                                        <span>{item.department}</span>
                                                        <span>{item.trainings} capacitaciones</span>
                                                    </div>
                                                    <div className="h-3 w-full bg-[#edeeed] rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-[#1b3022] rounded-full"
                                                            style={{ width: `${widthPercentage}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            )
                                        })
                                    })()
                                )}
                            </div>
                        </div>
                        <div className="bg-[#1b3022] rounded-2xl shadow-[0_20px_20px_rgba(25,28,28,0.04)] p-8">
                            <div className="flex justify-between items-center mb-8">
                                <div>
                                    <h3 className="text-xl font-bold text-white">Horas por cargo</h3>
                                    <p className="text-xs text-outline font-medium text-[#819986]">Intensidad formativa por cargo</p>
                                </div>
                            </div>
                            <div className="space-y-6">
                                {selectedAreaForChart === null ? (
                                    <p className="text-xs text-[#dbe7dd]">
                                        Selecciona un área en la tarjeta "Capacitaciones por Área" para visualizar el
                                        detalle de horas por cargo.
                                    </p>
                                ) : (
                                    (() => {
                                        const filteredHoursByRole = hoursByRole

                                        if (filteredHoursByRole.length === 0) {
                                            return (
                                                <p className="text-xs text-[#dbe7dd]">
                                                    No se encontraron horas de capacitación registradas por cargo para el
                                                    periodo seleccionado.
                                                </p>
                                            )
                                        }

                                        const maxHours = filteredHoursByRole.reduce<number>((max, item) => {
                                            return item.hours > max ? item.hours : max
                                        }, 0)

                                        return (
                                            <>
                                                <p className="text-xs text-[#dbe7dd]">
                                                    Horas totales de capacitación por cargo para el año
                                                    <span className="font-semibold"> {selectedYear}</span>
                                                    {selectedDepartment && (
                                                        <>
                                                            <span> · Área </span>
                                                            <span className="font-semibold">{selectedDepartment}</span>
                                                        </>
                                                    )}
                                                </p>
                                                <div className="space-y-3">
                                                    {filteredHoursByRole.map((item) => {
                                                        const widthPercentage = maxHours > 0
                                                            ? Math.max(6, (item.hours / maxHours) * 100)
                                                            : 0

                                                        return (
                                                            <div key={item.role} className="space-y-1">
                                                                <div className="flex justify-between text-[11px] font-medium text-[#e2efe4]">
                                                                    <span>{item.role}</span>
                                                                    <span>{item.hours.toFixed(0)} h</span>
                                                                </div>
                                                                <div className="h-2.5 w-full bg-[#243a2c] rounded-full overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-[#9ee6b3] rounded-full"
                                                                        style={{ width: `${widthPercentage}%` }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </>
                                        )
                                    })()
                                )}
                            </div>
                        </div>
                    </section>

                    {/* bloque de detalle del plan (placeholder) */}
                    <section className="max-w-7xl mx-auto bg-white rounded-xl shadow-[0_20px_20px_rgba(25,28,28,0.02)] border border-[#e1e3e2]/40 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-bold tracking-widest uppercase text-outline">Detalle del Plan de Formación</h2>
                            {isGenerating && (
                                <span className="text-xs font-medium text-on-surface-variant">Calculando resultados...</span>
                            )}
                        </div>

                        {isGenerating ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map((row) => (
                                    <div key={row} className="flex items-center justify-between gap-4">
                                        <span className="h-4 w-40 bg-zinc-200 rounded-md animate-pulse" />
                                        <span className="h-4 w-24 bg-zinc-200 rounded-md animate-pulse" />
                                        <span className="h-4 w-16 bg-zinc-200 rounded-md animate-pulse" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-on-surface-variant">
                                Configura los filtros y genera el plan para visualizar aquí el detalle (listado de
                                capacitaciones, asistentes, horas, etc.).
                            </p>
                        )}
                    </section>
                </div>
            </div>
        </Layout>
    )
}

export default ReportTrainingPlanPage