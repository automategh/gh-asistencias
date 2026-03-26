import Layout from '@/components/layouts/layout'
import { GraduationCap } from 'lucide-react'

function ReportsPage() {
    return (
        <Layout>
            <header className="flex justify-between items-center w-full pl-12 pr-12 py-8 sticky top-0 z-20 bg-zinc-50/85 backdrop-blur-md">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Panel de Reportes</h1>
                    <p className="font-body text-on-surface-variant text-sm mt-1">Gestión integral y análisis de asistencia corporativa.</p>
                </div>
            </header>

            <div className='px-12 py-16 space-y-10'>
                <section className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-7xl">
                    <div className="bg-white rounded-4xl p-10 shadow-[0_4px_30px_rgba(0,0,0,0.02)] flex flex-col justify-between group cursor-pointer hover:shadow-[0_30px_60px_rgba(0,0,0,0.06)] transition-all duration-500 border border-transparent hover:border-emerald-900/10 h-105">
                        <div>
                            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-900 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
                                <GraduationCap className='w-8 h-8' />
                            </div>
                            <h4 className="text-3xl font-headline font-bold text-primary mb-4">Plan de Formación</h4>
                            <p className="font-body text-lg text-on-surface-variant leading-relaxed max-w-md">Supervisión detallada del progreso en habilidades, certificaciones y desarrollo profesional de todo el equipo.</p>
                        </div>
                    </div>
                </section>
            </div>



        </Layout>
    )
}

export default ReportsPage