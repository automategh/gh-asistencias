import { useDatabase } from "@/context/DatabaseContext"
import { ChevronRight, CircleHelp, Database, X } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"

export interface PageBreadcrumb {
    readonly label: string
    readonly to?: string
}

export interface PageHeaderConfig {
    readonly title: string
    readonly description?: string
    readonly breadcrumbs?: readonly PageBreadcrumb[]
    readonly actions?: ReactNode
}

interface PageHeaderProps {
    readonly config: PageHeaderConfig
}


export default function PageHeader({ config }: PageHeaderProps) {
    const { availableDatabases, isCorporateUser, recinto, setSelectedDatabase } = useDatabase()
    const breadcrumbs = config.breadcrumbs ?? []
    const selectedDatabase = availableDatabases?.find((database) => database.key === recinto)

    const [showVersionModal, setShowVersionModal] = useState<boolean>(false)
    type SidebarAppEnv = ImportMetaEnv & {
        readonly VITE_APP_VERSION?: string
        readonly VITE_APP_PUBLISHED_AT?: string
    }
    const appEnv = import.meta.env as SidebarAppEnv

    const appVersion = appEnv.VITE_APP_VERSION ?? "No disponible"
    const publishedAtRaw = appEnv.VITE_APP_PUBLISHED_AT ?? ""

    const publishedAtDate = publishedAtRaw ? new Date(publishedAtRaw) : null
    const publishedAtLabel = publishedAtDate && !Number.isNaN(publishedAtDate.getTime())
        ? publishedAtDate.toLocaleString("es-ES", {
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "No disponible"

    return (
        <>
            <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs border-b border-[#edeeed]">
                <nav className="px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-6">
                    <div className="min-w-0">
                        {breadcrumbs.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-outline mb-1 font-label tracking-wide uppercase">
                                {breadcrumbs.map((crumb, index) => {
                                    const isLast = index === breadcrumbs.length - 1
                                    return (
                                        <div key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                                            {crumb.to && !isLast ? (
                                                <Link
                                                    to={crumb.to}
                                                    className="hover:text-secondary cursor-pointer transition-colors"
                                                >
                                                    {crumb.label}
                                                </Link>
                                            ) : (
                                                <span>{crumb.label}</span>
                                            )}
                                            {!isLast && <ChevronRight className="w-4 h-4" />}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                        <h1 className="text-3xl font-bold tracking-tight text-[#191c1c]">
                            {config.title}
                        </h1>
                        {config.description && (
                            <p className="text-sm text-[#5f6560] mt-1">{config.description}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            className="flex items-center gap-3 px-2 py-2 rounded-lg text-foreground hover:bg-[#124734]/40 transition-all duration-300"
                            title="Versión de la aplicación"
                            onClick={() => setShowVersionModal(true)}
                        >
                            <CircleHelp className="w-5 h-5" />
                        </button>
                        <div className="shrink-0">
                            {availableDatabases && (
                                <div className={`relative inline-flex items-center gap-2 rounded-xl border border-[#124734] bg-white px-2 py-1.5 text-[#124734] shadow-sm ${isCorporateUser ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
                                    <Database className="w-4 h-4" />
                                    <span className="text-sm font-semibold">Base:</span>
                                    <span className="text-sm font-semibold">{selectedDatabase?.name ?? ""}</span>
                                    <select
                                        id="database-select"
                                        className="absolute inset-0 h-full w-full appearance-none opacity-0 cursor-pointer"
                                        value={recinto}
                                        onChange={(event) => {
                                            const nextKey = event.target.value
                                            const nextDatabase = availableDatabases.find((database) => database.key === nextKey)
                                            if (nextDatabase) {
                                                setSelectedDatabase(nextDatabase.url, nextDatabase.key)
                                            }
                                        }}
                                        disabled={!isCorporateUser}
                                    >
                                        {availableDatabases.map((database) => (
                                            <option key={database.key} value={database.key}>
                                                {database.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                    </div>
                </nav>

            </header>
            {showVersionModal && (
                <div className="fixed inset-0 z-120 bg-black/45 backdrop-blur-[2px] flex items-center justify-center px-4" onClick={() => setShowVersionModal(false)}>
                    <div className="w-full max-w-sm rounded-3xl border border-[#edeeed] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden" onClick={(event) => event.stopPropagation()}>
                        <div className="px-6 py-5 border-b border-[#edeeed] bg-[#f8f9f8] flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Información de la app</p>
                                <h2 className="text-xl font-bold text-[#191c1c] mt-1">Versión publicada</h2>
                                <p className="text-sm text-[#5f6560] mt-1">Datos de despliegue del frontend actual.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowVersionModal(false)}
                                className="w-9 h-9 rounded-full hover:bg-[#edeeed] transition-colors flex items-center justify-center text-[#5f6560]"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="rounded-2xl bg-[#f3f4f3] px-4 py-4">
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Versión</p>
                                <p className="text-lg font-bold text-[#191c1c] mt-2">{appVersion}</p>
                            </div>
                            <div className="rounded-2xl bg-[#f3f4f3] px-4 py-4">
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Fecha de publicación</p>
                                <p className="text-sm font-semibold text-[#191c1c] mt-2">{publishedAtLabel}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
