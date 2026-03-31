import Layout from "@/components/layouts/layout"
import { Clock, Edit, Plus, Search, Users } from "lucide-react"
import { useNavigate } from "react-router-dom"

function SurveyAdminPage() {

    const navigate = useNavigate()
    return (
        <Layout>
            <div className='bg-linear-to-br from-background via-muted/5 to-background'>

                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className='px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex justify-between items-center'>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">Panel de Encuestas</h1>
                            <p className="font-body text-[#434843] text-sm mt-1">Administra, crea y analiza las encuestas de la organización desde un solo lugar.</p>
                        </div>
                        <div className="relative">
                            <button
                                onClick={() => navigate('/survey/create')}
                                className="flex items-center gap-x-4 px-4 py-2.5 bg-primary rounded-2xl cursor-pointer text-primary-foreground text-sm font-medium hover:bg-primary-light transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                <span>Crear Nueva Encuesta</span>
                            </button>
                        </div>
                    </nav>
                </header>

                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <div className="bg-[#f3f4f3] rounded-xl p-6 mb-8 flex flex-wrap items-center gap-4 max-w-7xl mx-auto">
                        <div className="relative flex-1 min-w-75">
                            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input className="w-full pl-12 pr-4 py-3 bg-white border-none rounded-lg focus:ring-2 focus:ring-[#1b3022] text-sm" placeholder="Buscar encuestas por título..." type="text" />
                        </div>
                        <div className="flex gap-2">
                            <button className="px-4 py-2 bg-white text-[#191c1c] text-sm font-medium rounded-lg shadow-sm hover:bg-stone-100 transition-colors">Todos</button>
                            <button className="px-4 py-2 bg-white text-[#434843] text-sm font-medium rounded-lg shadow-sm hover:bg-stone-100 transition-colors">Activos</button>
                        </div>
                    </div>



                    <div className="group bg-white rounded-xl p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:shadow-[0_20px_40px_rgba(25,28,28,0.06)] transition-all border-l-4 border-[#1b3022] max-w-7xl mx-auto">
                        <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-3">
                                <span className="px-2 py-1 bg-[#1b3022]/10 text-[#1b3022] text-[10px] font-bold tracking-wider uppercase rounded">Activa</span>
                                <span className="text-xs text-outline font-medium">Actualizado hace 2 días</span>
                            </div>
                            <h3 className="text-xl font-bold text-[#191c1c] group-hover:text-[#1b3022] transition-colors">Encuesta de Satisfacción de Capacitación</h3>
                            <div className="flex items-center gap-4 text-sm text-[#434843]">
                                <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> 124 Respuestas</span>
                                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> 5 minutos de lectura</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex -space-x-2">
                                <div className="w-8 h-8 rounded-full border-2 border-white bg-[#efbe82]">
                                    <img alt="Collaborator" className="w-full h-full rounded-full" data-alt="professional avatar of a project manager" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAxrhI7F7wqMSlDkNcPiLNTNoMFtUh55BVVMCly5m4q3RxcYn2PvmNXHdLyFKlmPtIsBy-eIh_eRaunv7uyYpwGmnDaeBJbYCXNoPw4fS53KgsJILvI1jJnI9UEQKKEhh_WjwmfQpVbPe2Oj2x3TIwoi_aPzK-ky5pnDyEUUzt8YYmoW72jJBQKWFycWh6Ai8aS91IQYqgRWmOkElpKlWxZviv7D4vRwGgR_zCpqRy0R6g-sDwTtwA1PDh3ReUUVbFCBLCD8A5U_w4" />
                                </div>
                                <div className="w-8 h-8 rounded-full border-2 border-white bg-[#d9e6d8]">
                                    <img alt="Collaborator" className="w-full h-full rounded-full" data-alt="professional avatar of a data analyst" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCMQgqX6IZDcYKRUakNh0pHtc3POaK7uiW5pG21jAzNlazHcYIGsXKW0RGckAsZvCn6fflrwzdz-_9DDT7wTN0_vAeihQ67t_AWZQEEObN9lSP3zVAy4JxlCkDoTC_37AcOZczZWgInRlhSW3VKL-9OSQkH-qDlLGFxBPOjkiAujQ-HLwfT7uc8ZT2risIUpIqZr5g3xrsCD_Dbz4vOMBnDk4hS3uni5qkP_ldx4mgfm23wuRuY20nKM-uAWKE81yicxMs1iFjXXjA" />
                                </div>
                            </div>
                            <a className="flex items-center gap-2 bg-[#e1e3e2] text-[#191c1c] px-6 py-2.5 rounded-full font-bold text-sm hover:bg-[#1b3022] hover:text-white transition-all" href="{{DATA:SCREEN:SCREEN_13}}">
                                Gestionar
                                <Edit className="w-5 h-5" />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default SurveyAdminPage