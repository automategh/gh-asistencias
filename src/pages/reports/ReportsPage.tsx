import Layout from '@/components/layouts/layout'
import { ArrowRightIcon, GraduationCap, User, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDatabase } from '@/context/DatabaseContext'
import { getTrainingCountForYear } from '@/services/meetings.analytics.service'

function ReportsPage() {
    const { database } = useDatabase()
    const [currentYearTrainings, setCurrentYearTrainings] = useState<number>(0)

    useEffect(() => {
        let cancelled = false

        async function loadCurrentYearTrainings(): Promise<void> {
            try {
                if (!database) {
                    return
                }
                const now = new Date()
                const trainingsCount = await getTrainingCountForYear(database, now.getFullYear())
                if (!cancelled) {
                    setCurrentYearTrainings(trainingsCount)
                }
            } catch (error) {
                console.error('No fue posible cargar las capacitaciones programadas del año actual:', error)
            }
        }

        void loadCurrentYearTrainings()

        return () => {
            cancelled = true
        }
    }, [database])

    return (
        <Layout>
            <header className="flex justify-between items-center w-full pl-12 pr-12 py-8 sticky top-0 z-20 bg-zinc-50/85 backdrop-blur-md">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Panel de Reportes</h1>
                    <p className="font-body text-on-surface-variant text-sm mt-1">Resumen y análisis centralizado de la asistencia en toda la organización.</p>
                </div>
            </header>

            <div className='px-12 py-16 space-y-10 mx-auto'>
                <section className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-7xl">

                    {/* primer grid */}
                    <div

                        className="bg-white rounded-4xl p-10 shadow-[0_4px_30px_rgba(0,0,0,0.02)] flex flex-col justify-between group cursor-pointer hover:shadow-[0_30px_60px_rgba(0,0,0,0.06)] transition-all duration-500 border border-transparent hover:border-emerald-900/10 h-105">
                        <div>
                            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-900 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
                                <GraduationCap className='w-8 h-8' />
                            </div>
                            <h4 className="text-3xl font-headline font-bold mb-4">Plan de Formación</h4>
                            <p className="font-body text-lg text-on-surface-variant leading-relaxed max-w-md">Visualiza y analiza reportes de asistencia por reuniones, áreas y periodos de tiempo para apoyar la toma de decisiones y el desarrollo del talento.</p>
                        </div>
                        <div className="mt-8 bg-[#f3f4f3] hover:shadow-[0_30px_60px_rgba(0,0,0,0.06)] hover:border-b-2 hover:border-b-emerald-900 rounded-3xl p-6 border border-zinc-100/50 transition-all duration-400 ease-in-out">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Capacitaciones programadas</span>
                                <span className="text-sm font-bold text-emerald-900">
                                    {currentYearTrainings} capacitaciones {new Date().getFullYear()}
                                </span>
                            </div>
                            <div className="flex gap-2 h-2.5">
                                <div className="flex-2 bg-emerald-900 rounded-full"></div>
                                <div className="flex-1 bg-emerald-900/30 rounded-full"></div>
                                <div className="flex-[0.5] bg-zinc-200 rounded-full"></div>
                            </div>
                            <div className="mt-6 flex items-center justify-between">
                                <span className="text-xs font-bold text-emerald-900 font-label uppercase tracking-widest">Generar Reporte</span>
                                <ArrowRightIcon className="text-emerald-900 group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>
                    </div>

                    {/* segundo grid */}
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-8'>

                        {/* primer grid */}
                        <div

                            className="bg-white rounded-4xl p-10 shadow-[0_4px_30px_rgba(0,0,0,0.02)] flex flex-col justify-between group cursor-pointer hover:shadow-[0_30px_60px_rgba(0,0,0,0.06)] transition-all duration-500 border border-transparent hover:border-emerald-900/10 h-105">
                            <div>
                                <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-900 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
                                    <User className='w-8 h-8' />
                                </div>
                                <h4 className="text-3xl font-headline font-bold mb-4">Reporte Individual</h4>
                                <p className="font-body text-lg text-on-surface-variant leading-relaxed max-w-md">Análisis profundo de asistencia por empleado.</p>


                            </div>
                            <div className="mt-6 flex items-center justify-between px-2">
                                <span className="text-xs font-bold text-emerald-900 font-label uppercase tracking-widest">Generar reporte</span>
                                <ArrowRightIcon className="text-emerald-900 group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>

                        {/* segundo grid */}
                        <div

                            className="bg-white rounded-4xl p-10 shadow-[0_4px_30px_rgba(0,0,0,0.02)] flex flex-col justify-between group cursor-pointer hover:shadow-[0_30px_60px_rgba(0,0,0,0.06)] transition-all duration-500 border border-transparent hover:border-emerald-900/10 h-105">
                            <div>
                                <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-900 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
                                    <Users className='w-8 h-8' />
                                </div>
                                <h4 className="text-3xl font-headline font-bold mb-4">Reporte Grupal</h4>
                                <p className="font-body text-lg text-on-surface-variant leading-relaxed max-w-md">Análisis profundo de asistencia por grupo.</p>
                            </div>
                            <div className="mt-6 flex items-center justify-between px-2">
                                <span className="text-xs font-bold text-emerald-900 font-label uppercase tracking-widest">Generar reporte</span>
                                <ArrowRightIcon className="text-emerald-900 group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>
                    </div>
                </section>
            </div>



        </Layout>
    )
}

export default ReportsPage