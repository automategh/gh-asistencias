import Layout from '@/components/layouts/layout'
import { ArrowRightIcon, GraduationCap, Plus, User, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDatabase } from '@/context/DatabaseContext'
import { getTrainingCountForYear } from '@/services/meetings.analytics.service'
import { useNavigate } from 'react-router-dom'

function ReportsPage() {
    const { database } = useDatabase()
    const [currentYearTrainings, setCurrentYearTrainings] = useState<number>(0)
    const navigate = useNavigate()

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
        <Layout
            header={{
                breadcrumbs: [{ label: 'Reportes' }],
                title: 'Panel de Reportes',
                description: 'Resumen y análisis centralizado de la asistencia en toda la organización.',
            }}
        >
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>
                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <section className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-7xl md:mx-auto">

                        {/* primer grid */}
                        <div
                            onClick={() => navigate('/reports/training-plan')}
                            className="bg-white rounded-4xl p-10 shadow-[0_4px_30px_rgba(0,0,0,0.02)] flex flex-col justify-between group cursor-pointer hover:shadow-[0_30px_60px_rgba(0,0,0,0.06)] transition-all duration-500 border border-transparent hover:border-emerald-900/10 h-105"
                        >
                            <div>
                                <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-900 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
                                    <GraduationCap className='w-8 h-8' />
                                </div>
                                <h4 className="text-3xl font-headline font-bold mb-4">Plan de Formación</h4>
                                <p className="font-body text-lg text-on-surface-variant leading-relaxed max-w-md">Visualiza y analiza reportes de asistencia por capacitaciones, áreas y periodos de tiempo para apoyar la toma de decisiones y el desarrollo del talento.</p>
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
                        <div className='grid grid-cols-1 md:grid-cols-2 gap-8 mt-32 md:mt-0'>

                            {/* primer grid */}
                            <div
                                onClick={() => navigate('/reports/individual')}
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
                                onClick={() => navigate('/reports/group')}
                                className="bg-white rounded-4xl p-10 shadow-[0_4px_30px_rgba(0,0,0,0.02)] flex flex-col justify-between group cursor-pointer hover:shadow-[0_30px_60px_rgba(0,0,0,0.06)] transition-all duration-500 border border-transparent hover:border-emerald-900/10 h-105">
                                <div>
                                    <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-900 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
                                        <Users className='w-8 h-8' />
                                    </div>
                                    <h4 className="text-3xl font-headline font-bold mb-4">Reporte General</h4>
                                    <p className="font-body text-lg text-on-surface-variant leading-relaxed max-w-md">Análisis profundo de asistencia por grupo.</p>
                                </div>
                                <div className="mt-6 flex items-center justify-between px-2">
                                    <span className="text-xs font-bold text-emerald-900 font-label uppercase tracking-widest">Generar reporte</span>
                                    <ArrowRightIcon className="text-emerald-900 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </div>

                        <div className="md:col-span-2 mt-10">
                            <div className="border-2 border-dashed border-zinc-200 rounded-4xl p-12 flex flex-col items-center justify-center text-center opacity-40 hover:opacity-60 transition-opacity">
                                <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center mb-4">
                                    <Plus className="w-6 h-6 text-zinc-400" />
                                </div>
                                <p className="font-body text-sm font-medium text-zinc-500">Módulos adicionales de reporte próximamente disponibles</p>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </Layout>
    )
}

export default ReportsPage