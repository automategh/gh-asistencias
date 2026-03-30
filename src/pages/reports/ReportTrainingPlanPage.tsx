import Layout from "@/components/layouts/layout"
import { ChevronDown, Download, IterationCw } from "lucide-react"
import { useEffect, useState } from "react"
import { useDatabase } from "@/context/DatabaseContext"
import { getDepartmentNames } from "@/services/departaments/departments.service"

/**
 * Página de reporte para el plan de formación.
 * Permite filtrar por periodo anual y por área/departamento,
 * utilizando los departamentos configurados en la base de datos actual.
 */
function ReportTrainingPlanPage() {
    const { database } = useDatabase()
    const [departments, setDepartments] = useState<string[]>([])

    useEffect(() => {
        let cancelled = false

        async function loadDepartments(): Promise<void> {
            try {
                if (!database) {
                    setDepartments([])
                    return
                }

                const names = await getDepartmentNames(database)
                if (!cancelled) {
                    setDepartments(names)
                }
            } catch (error) {
                console.error("No fue posible cargar las áreas/departamentos:", error)
            }
        }

        void loadDepartments()

        return () => {
            cancelled = true
        }
    }, [database])

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


                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <section className="bg-[#f3f4f3] p-6 rounded-xl space-y-4 max-w-7xl mx-auto">
                        <div className="flex flex-wrap items-end gap-6">
                            <div className="flex-1 min-w-50">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Periodo Anual</label>
                                <div className="relative">
                                    <select className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-on-surface appearance-none focus:ring-2 focus:ring-primary-container">
                                        <option>2024 - Ciclo Actual</option>
                                        <option>2023 - Histórico</option>
                                        <option>2022 - Histórico</option>
                                    </select>
                                    <ChevronDown className="absolute right-3 top-3 text-outline pointer-events-none" />
                                </div>
                            </div>
                            <div className="flex-1 min-w-50">
                                <label className="text-[10px] uppercase tracking-widest text-outline font-bold block mb-2 ml-1">Área / Departamento</label>
                                <div className="relative">
                                    <select className="w-full bg-white border-none rounded-xl py-3 pl-4 pr-10 text-sm font-semibold text-on-surface appearance-none focus:ring-2 focus:ring-primary-container">
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
                                <button className="bg-[#1b3022] text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-primary transition-all shadow-md">
                                    <IterationCw className="w-4 h-4" />
                                    Generar Plan
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </Layout>
    )
}

export default ReportTrainingPlanPage