import Layout from "@/components/layouts/layout"
import { ArrowRight, ChevronDown, ChevronRight, Copy, PlusCircle, Trash } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"


function NewSurveyPage() {
    const navigate = useNavigate()


    const [data, setData] = useState({
        name: '',
        category: '',
        description: '',
        predetermined: false
    })

    console.log(data)

    // Opciones de categoría basadas en MeetingKind
    const meetingKindOptions = [
        { value: "meeting", label: "Reunión" },
        { value: "training", label: "Capacitación" },
        { value: "custom", label: "Personalizada" },
    ];

    return (
        <Layout>
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className='px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center'>
                        <div>
                            <div className="flex items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                                <span
                                    className="hover:text-secondary cursor-pointer transition-colors"
                                    onClick={() => navigate("/survey")}>Encuestas</span>
                                <ChevronRight className="w-4 h-4" />
                                <span>Nueva</span>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight">Crea nueva encuesta</h1>
                            <p className="font-body text-[#434843] text-sm mt-1">Diseña y configura los parámetros de la encuesta según tus necesidades.</p>
                        </div>
                    </nav>
                </header>


                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <div className="mx-auto max-w-7xl">
                        <section className="bg-white rounded-xl shadow-[0_20px_24px_-4px_rgba(25,28,28,0.04)] overflow-hidden">
                            <div className="p-8 border-b border-[#e1e3e2]/30 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm">1</span>
                                    <h3 className="font-headline font-bold text-xl text-primary">Información Básica</h3>
                                </div>
                                <span className="text-xs font-label uppercase tracking-widest text-outline bg-[#edeeed] px-3 py-1 rounded-full">Requerido</span>
                            </div>


                            <div className="p-8 space-y-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-[#434843] ml-1">Nombre de la Encuesta</label>
                                    <input
                                        onChange={(e) => setData({
                                            ...data, name: e.target.value
                                        })}
                                        value={data.name}
                                        className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] placeholder:text-outline/60" placeholder="Ej: Encuesta de satisfacción 2026" type="text" />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-[#434843] ml-1">Categoría</label>
                                        <div className="relative">
                                            <select
                                                onChange={(e) => setData({
                                                    ...data, category: e.target.value
                                                })}
                                                value={data.category}
                                                className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-primary-container/10 appearance-none transition-all text-[#191c1c]">
                                                <option value="">Seleccionar categoría...</option>
                                                {meetingKindOptions.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline w-5 h-5" />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 mt-6">
                                        <input
                                            onChange={(e) => setData({
                                                ...data, predetermined: e.target.checked
                                            })}
                                            checked={data.predetermined}
                                            id="default-category"
                                            type="checkbox"
                                            className="w-5 h-5 text-primary focus:ring-[#1b3022]/10 rounded transition-all"
                                        />
                                        <label htmlFor="default-category" className="text-sm font-bold text-[#434843] select-none cursor-pointer">
                                            ¿Predeterminado para esta categoría?
                                        </label>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-[#434843] ml-1">Descripción</label>
                                    <textarea
                                        onChange={(e) => setData({
                                            ...data, description: e.target.value
                                        })}
                                        value={data.description}
                                        className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] resize-none" placeholder="Describe brevemente el objetivo de esta encuesta..." rows={4}></textarea>
                                </div>
                            </div>
                        </section>


                        <div className="grid md:grid-cols-3 gap-8 mt-20">

                            {/* preguntas */}
                            <div className="md:col-span-2">
                                <div className="p-8 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <span className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm">2</span>
                                        <h3 className="font-headline font-bold text-xl text-primary">Preguntas</h3>
                                    </div>
                                    <span className="text-xs font-label uppercase tracking-widest text-outline bg-[#edeeed] px-3 py-1 rounded-full">Requerido</span>
                                </div>
                                <div className="p-8">
                                    <div className="bg-white rounded-2xl shadow-[0_20px_24px_-4px_rgba(25,28,28,0.04)] border border-[#e1e3e2]/30 p-6 space-y-9">
                                        <div className="flex gap-6 items-center justify-center">
                                            <input className="w-full px-5 py-4 bg-[#edeeed] border-none rounded-xl focus:ring-2 focus:ring-[#1b3022]/10 transition-all text-[#191c1c] placeholder:text-outline/60" placeholder="Nombre de la pregunta..." type="text" />
                                            <div className="flex items-center space-x-2">
                                                <span className="text-xs font-label uppercase tracking-widest text-outline">Obligatoria</span>
                                                <div className="w-10 h-6 bg-[#1b3022] rounded-full relative cursor-pointer">
                                                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-6 items-end">
                                            <div className="space-y-2">
                                                <label className="text-xs uppercase tracking-widest text-outline">Tipo de pregunta</label>
                                                <div className="relative">
                                                    <select className="w-full bg-[#edeeed] border-none rounded-md px-4 py-2.5 appearance-none focus:ring-2 focus:ring-[#1b3022] font-medium text-sm">
                                                        <option>NPS (0-10)</option>
                                                        <option selected>Escala numérica (1-5)</option>
                                                        <option>Texto libre</option>
                                                    </select>
                                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-outline w-5 h-5" />
                                                </div>
                                            </div>
                                            <div className="flex justify-end space-x-3">
                                                <button className="p-2.5 text-outline hover:bg-[#edeeed] rounded-lg transition-all">
                                                    <Copy className="w-5 h-5" />
                                                </button>
                                                <button className="p-2.5 text-error hover:bg-[#ffdad6] rounded-lg transition-all">
                                                    <Trash className="w-5 h-5 text-red-500 hover:text-[#93000a]" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* herramientas */}
                            <div className=" sticky top-24 space-y-6">
                                <div className="bg-[#f3f4f3] rounded-xl p-8 border border-[#e1e3e2]/30">
                                    <h4 className="font-headline font-bold text-lg mb-6">Herramientas</h4>
                                    <div className="space-y-4">
                                        <button className="w-full group bg-white p-4 rounded-xl flex items-center justify-between hover:bg-[#1b3022] hover:text-white transition-all duration-300">
                                            <div className="flex items-center space-x-4">
                                                <PlusCircle className="w-5 h-5 text-[#1b3022] group-hover:text-white" />
                                                <span className="font-semibold">Añadir Pregunta</span>
                                            </div>
                                            <ArrowRight className="w-5 h-5 text-[#1b3022] group-hover:text-white" />
                                        </button>
                                    </div>
                                    <div className="mt-8 pt-8 border-t border-[#e1e3e2]/50">
                                        <p className="text-xs font-label uppercase tracking-widest text-outline mb-4">Estadísticas de Estructura</p>
                                        <div className="space-y-3">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-on-surface-variant">Total Preguntas</span>
                                                <span className="font-bold">12</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-on-surface-variant">Tiempo Estimado</span>
                                                <span className="font-bold">4 min</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-on-surface-variant">Obligatorias</span>
                                                <span className="font-bold">8</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

            </div >
        </Layout >
    )
}

export default NewSurveyPage