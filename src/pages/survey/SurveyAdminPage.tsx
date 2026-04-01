import Layout from "@/components/layouts/layout"
import { Clock, Edit, Plus, Search } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useDatabase } from "@/context/DatabaseContext"
import { getSurveys, type Survey } from "@/services/forms.service"

/**
 * Panel principal de administración de encuestas.
 * Permite listar, filtrar y acceder a la gestión detallada de cada encuesta creada.
 */
function SurveyAdminPage() {
    const navigate = useNavigate()
    const { database } = useDatabase()
    const [surveys, setSurveys] = useState<Survey[]>([])
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [searchTerm, setSearchTerm] = useState<string>("")
    const [statusFilter, setStatusFilter] = useState<"all" | "active">("all")
    const [categoryFilter, setCategoryFilter] = useState<string>("all")
    const [onlyPredetermined, setOnlyPredetermined] = useState<boolean>(false)

    useEffect(() => {
        if (!database) {
            setSurveys([])
            return
        }

        let cancelled = false

        const loadSurveys = async () => {
            try {
                setIsLoading(true)
                const items = await getSurveys(database)
                if (!cancelled) {
                    setSurveys(items)
                }
            } catch (error) {
                console.error("No fue posible cargar las encuestas:", error)
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }

        void loadSurveys()

        return () => {
            cancelled = true
        }
    }, [database])

    const normalizedSearch = searchTerm.trim().toLowerCase()

    /**
     * Etiquetas legibles en español para las categorías conocidas de encuestas.
     */
    const CATEGORY_LABELS: Record<string, string> = {
        meeting: "Reunión",
        training: "Capacitación",
        custom: "Personalizada",
    }

    const categories = Array.from(new Set(surveys.map((survey) => survey.category))).sort()

    /**
     * Aplica los filtros de estado y búsqueda sobre el listado completo de encuestas.
     */
    const filteredSurveys = surveys.filter((survey) => {
        if (statusFilter === "active" && !survey.isActive) {
            return false
        }

        if (onlyPredetermined && !survey.predetermined) {
            return false
        }

        if (categoryFilter !== "all" && survey.category !== categoryFilter) {
            return false
        }

        if (!normalizedSearch) {
            return true
        }

        return survey.name.toLowerCase().includes(normalizedSearch)
    })

    /**
     * Formatea una fecha ISO a un string legible en español (dd MMM yyyy).
     */
    const formatDate = (value: string): string => {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) {
            return "Fecha no disponible"
        }
        return date.toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        })
    }

    /**
     * Determina la etiqueta de tiempo adecuada para la encuesta:
     * "Creado el" si nunca ha sido actualizada o "Actualizada el" en caso contrario.
     */
    const getTimestampLabel = (survey: Survey): string => {
        const isJustCreated = survey.createdAt === survey.updatedAt
        const baseDate = isJustCreated ? survey.createdAt : survey.updatedAt
        const formatted = formatDate(baseDate)
        return isJustCreated ? `Creado el ${formatted}` : `Actualizada el ${formatted}`
    }

    /**
     * Restablece todos los filtros del panel a sus valores por defecto.
     */
    const handleClearFilters = (): void => {
        setSearchTerm("")
        setStatusFilter("all")
        setCategoryFilter("all")
        setOnlyPredetermined(false)
    }

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
                            <input
                                className="w-full pl-12 pr-4 py-3 bg-white border-none rounded-lg focus:ring-2 focus:ring-[#1b3022] text-sm"
                                placeholder="Buscar encuestas por título..."
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                className={`px-4 py-2 text-sm font-medium rounded-lg shadow-sm transition-colors ${statusFilter === "all" ? "bg-primary text-white" : "bg-white text-[#434843] hover:bg-stone-100"}`}
                                type="button"
                                onClick={() => setStatusFilter("all")}
                            >
                                Todos
                            </button>
                            <button
                                className={`px-4 py-2 text-sm font-medium rounded-lg shadow-sm transition-colors ${statusFilter === "active" ? "bg-primary text-white" : "bg-white text-[#434843] hover:bg-stone-100"}`}
                                type="button"
                                onClick={() => setStatusFilter("active")}
                            >
                                Activos
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <select
                                    className="px-3 pr-8 py-2 bg-white border-none rounded-lg text-sm font-medium text-[#191c1c] focus:ring-2 focus:ring-[#1b3022]"
                                    value={categoryFilter}
                                    onChange={(event) => setCategoryFilter(event.target.value)}
                                >
                                    <option value="all">Todas las categorías</option>
                                    {categories.map((category) => (
                                        <option key={category} value={category}>
                                            {CATEGORY_LABELS[category] ?? category}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-[#434843]">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-0"
                                    checked={onlyPredetermined}
                                    onChange={(event) => setOnlyPredetermined(event.target.checked)}
                                />
                                Solo predeterminadas
                            </label>
                        </div>
                    </div>

                    <div className="max-w-7xl flex items-center justify-between mx-auto">
                        {!isLoading && surveys.length > 0 && (
                            <div className="text-xs text-[#5a665a] flex justify-between items-center">
                                <span>
                                    Mostrando <strong>{filteredSurveys.length}</strong> de <strong>{surveys.length}</strong> encuestas
                                </span>
                            </div>
                        )}

                        <button
                            type="button"
                            className="px-4 py-2 text-xs font-medium rounded-lg shadow-sm bg-white text-[#434843] hover:bg-stone-100 transition-colors"
                            onClick={handleClearFilters}
                        >
                            Limpiar filtros
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="group bg-white rounded-xl p-8 max-w-7xl mx-auto text-sm text-[#434843]">
                            Cargando encuestas...
                        </div>
                    ) : filteredSurveys.length === 0 ? (
                        <div className="group bg-white rounded-xl p-8 max-w-7xl mx-auto text-sm text-[#434843]">
                            No se encontraron encuestas para los filtros actuales.
                        </div>
                    ) : (
                        filteredSurveys.map((survey) => (
                            <div
                                key={survey.id}
                                className="group bg-white rounded-xl p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:shadow-[0_20px_40px_rgba(25,28,28,0.06)] transition-all border-l-4 border-[#1b3022] max-w-7xl mx-auto"
                            >
                                <div className="flex-1 space-y-2">
                                    <div className="flex items-center gap-3">
                                        <span className="px-2 py-1 bg-[#1b3022]/10 text-[#1b3022] text-[10px] font-bold tracking-wider uppercase rounded">
                                            {survey.isActive ? "Activa" : "Inactiva"}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs text-outline font-medium">
                                            <Clock className="w-4 h-4" />
                                            {getTimestampLabel(survey)}
                                        </span>
                                    </div>
                                    <h3 className="text-xl font-bold text-[#191c1c] group-hover:text-[#1b3022] transition-colors">
                                        {survey.name}
                                    </h3>
                                    {survey.description && (
                                        <p className="text-sm text-[#434843]">
                                            {survey.description}
                                        </p>
                                    )}
                                    <p className="text-xs font-medium text-[#5a665a]">
                                        Categoría: {CATEGORY_LABELS[survey.category] ?? survey.category}
                                    </p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <button
                                        type="button"
                                        className="flex items-center gap-2 bg-[#e1e3e2] text-[#191c1c] px-6 py-2.5 rounded-full font-bold text-sm hover:bg-[#1b3022] hover:text-white transition-all"
                                        onClick={() => navigate(`/survey/${survey.id}`)}
                                    >
                                        Gestionar
                                        <Edit className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </Layout>
    )
}

export default SurveyAdminPage