import { useAuth } from "@/context/AuthContext"
import { useDatabase } from "@/context/DatabaseContext"
import { cn } from "@/lib/utils"
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, LogOut, Menu, UserCircle, UserCog, X, LayoutDashboard, User, PlusCircleIcon, ChartColumnBig, Building2Icon, ClipboardList, GroupIcon } from "lucide-react"
import { useState } from "react"
import { Link, useLocation } from "react-router-dom"

interface SidebarProps {
    onCollapsedChange: (collapsed: boolean) => void
}

export function Sidebar({ onCollapsedChange }: SidebarProps) {

    const { user, logout, role, profilePhotoUrl } = useAuth()

    const location = useLocation()

    // Estado móvil del sidebar
    const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false)

    const [showDbDropdown, setShowDbDropdown] = useState<boolean>(false)

    const { availableDatabases, isCorporateUser, setSelectedDatabase, recinto } = useDatabase()

    const currentDatabase = availableDatabases.find((db) => db.key === recinto)

    const handleDbChange = (url: string, key: typeof recinto) => {
        setSelectedDatabase(url, key);
        setShowDbDropdown(false);
    };

    // Persistencia de colapso en localStorage para evitar “abrirse” en cada navegación
    const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
        const saved = window.localStorage.getItem("sidebar:collapsed")
        return saved === "1"
    })

    const pathname = location.pathname

    const toggleCollapsed = (): void => {
        const newState = !isCollapsed
        setIsCollapsed(newState)
        onCollapsedChange?.(newState)
        window.localStorage.setItem("sidebar:collapsed", newState ? "1" : "0")
    }

    const links = [
        { icon: LayoutDashboard, name: "Dashboard", path: "/", roles: ["Admin", "Lider", "User", "HR"] },
        { icon: PlusCircleIcon, name: "Nueva Actividad", path: "/new-meeting", roles: ["Admin", "Lider", "HR"] },
        { icon: Calendar, name: "Actividades", path: "/meets", roles: ["Admin", "Lider", "User", "HR"] },
        { icon: User, name: "Perfil", path: "/configure-profile", roles: ["Admin", "Lider", "User", "HR"] },
        { icon: ChartColumnBig, name: "Reportes", path: "/reports", roles: ["Admin", "HR", "Lider"] },
        { icon: Building2Icon, name: "Areas", path: "/departments", roles: ["Admin", "HR"] },
        { icon: GroupIcon, name: "Formas de agrupar", path: "/user-grouping", roles: ["Admin", "HR"] },
        { icon: ClipboardList, name: "Encuestas", path: "/survey", roles: ["Admin", "HR"] },
        { icon: UserCog, name: "Permisos", path: "/permissions", roles: ["Admin"] },
    ]


    return (
        <>
            {/* Mobile Toggle Button */}
            <button
                onClick={() => setIsMobileOpen(!isMobileOpen)}
                className="fixed top-4 left-4 z-50 lg:hidden p-2 bg-card border border-border rounded-lg shadow-lg hover:bg-muted transition-colors"
            >
                {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Mobile Overlay */}
            {isMobileOpen && (
                <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsMobileOpen(false)} />
            )}
            {/* Sidebar */}
            <aside
                className={`fixed top-0 left-0 h-full bg-card shadow-[20px_0_20px_rgba(25,28,28,0.04)] z-40 transition-all duration-300 flex flex-col ${isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                    } ${isCollapsed ? "lg:w-20" : "lg:w-64"} w-64`}
            >

                <button
                    onClick={toggleCollapsed}
                    className="hidden lg:flex absolute -right-3 top-8 w-8 h-8 bg-primary text-primary-foreground rounded-full items-center justify-center shadow-xl hover:bg-primary/90 transition-all hover:scale-110 z-50 border-2 border-background"
                >
                    {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
                </button>

                {/* Logo Section */}
                <div className="p-6">
                    <div className={`flex items-center gap-3 ${isCollapsed ? "lg:justify-center lg:flex-col lg:gap-2" : ""}`}>

                        <Calendar className="w-6 h-6 text-primary" />

                        <div className={`transition-all duration-300 overflow-hidden ${isCollapsed ? "lg:hidden" : "lg:block"}`}>
                            <h1 className="font-bold text-xl text-foreground whitespace-nowrap">Asistencias</h1>
                        </div>
                        
                    </div>
                </div>

                {/* Nav Links */}
                <nav className="flex-1 p-4 overflow-y-auto overflow-x-hidden">
                    <ul className="space-y-2">
                        {links.map((link) => {
                            if (!link.roles.includes(role || "")) return null
                            const isActive = link.path === "/"
                                ? pathname === "/"
                                : pathname === link.path || pathname.startsWith(`${link.path}/`)
                            const Icon = link.icon
                            return (
                                <li key={link.path}>
                                    <Link
                                        to={link.path}
                                        onClick={() => {
                                            setIsMobileOpen(false)
                                            setShowDbDropdown(false)

                                        }}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group relative ${isActive ? "bg-primary text-primary-foreground shadow-md" : "text-foreground hover:bg-muted/50"
                                            } ${isCollapsed ? "lg:justify-center lg:px-0" : ""}`}
                                        title={isCollapsed ? link.name : undefined}
                                    >
                                        <Icon className={`w-5 h-5 shrink-0 ${isCollapsed ? "lg:w-6 lg:h-6" : ""}`} />
                                        <span
                                            className={`font-medium text-sm whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "lg:hidden" : "lg:block"}`}
                                        >
                                            {link.name}
                                        </span>
                                        {isCollapsed && (
                                            <span className="hidden lg:block absolute left-full ml-4 px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-60">
                                                {link.name}
                                            </span>
                                        )}
                                    </Link>
                                </li>
                            )
                        })}
                    </ul>
                </nav>

                {/* User Info */}
                <div className="p-4">
                    <div className="relative">
                    <div
                        className={`flex items-center gap-3 p-3 bg-muted/30 rounded-lg ${isCollapsed ? "lg:justify-center lg:p-3" : ""} ${isCorporateUser && !isCollapsed ? "cursor-pointer" : ""}`}
                    >
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-border bg-muted flex items-center justify-center shrink-0">
                            {profilePhotoUrl ? (
                                <img
                                    src={profilePhotoUrl}
                                    alt={user?.displayName ?? user?.email ?? "Foto de perfil"}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                />
                            ) : (
                                <UserCircle className="w-5 h-5 text-secondary-foreground" />
                            )}
                        </div>
                        <div
                            className={`flex-1 min-w-0 transition-all duration-300 overflow-hidden ${isCollapsed ? "lg:hidden" : "lg:block"}`}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    if (!isCorporateUser) return
                                    setShowDbDropdown((previous) => !previous)
                                }}
                                className={`w-full flex items-center justify-between gap-2 text-left ${isCorporateUser ? "cursor-pointer" : "cursor-default"}`}
                            >
                                <span className="font-semibold text-sm text-foreground truncate whitespace-nowrap">{user?.displayName || "Usuario"}</span>
                                {isCorporateUser && (
                                    <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${showDbDropdown ? "rotate-180" : ""}`} />
                                )}
                            </button>
                            <p className="text-xs text-muted-foreground whitespace-nowrap truncate">
                                {isCorporateUser ? (currentDatabase?.name ?? "Seleccionar base de datos") : "En línea"}
                            </p>
                        </div>
                    </div>
                    </div>
                </div>

                {/* Logout Button */}
                <div className="p-4">
                    <button
                        onClick={logout}
                        className={`w-full flex items-center gap-2 px-4 py-3 text-red-500 hover:bg-red-200 font-semibold rounded-lg transition-all duration-300 hover:cursor-pointer ${isCollapsed ? "lg:justify-center lg:px-0" : "justify-center"
                            }`}
                        title={isCollapsed ? "Cerrar Sesión" : undefined}
                    >
                        <LogOut className={`w-5 h-5 shrink-0 ${isCollapsed ? "lg:w-6 lg:h-6" : ""}`} />
                        <span
                            className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "lg:hidden" : "lg:block"}`}
                        >
                            Cerrar Sesión
                        </span>
                    </button>
                </div>
            </aside>
            {isCorporateUser && showDbDropdown && (
                <div className="fixed inset-0 z-120 bg-black/45 backdrop-blur-[2px] flex items-center justify-center px-4" onClick={() => setShowDbDropdown(false)}>
                    <div className="w-full max-w-md rounded-3xl border border-[#edeeed] bg-white shadow-[0_24px_48px_rgba(15,23,42,0.18)] overflow-hidden" onClick={(event) => event.stopPropagation()}>
                        <div className="px-6 py-5 border-b border-[#edeeed] bg-[#f8f9f8] flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Cambiar base de datos</p>
                                <h2 className="text-xl font-bold text-[#191c1c] mt-1">Selecciona un recinto</h2>
                                <p className="text-sm text-[#5f6560] mt-1">Disponible solo para usuarios corporativos.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDbDropdown(false)}
                                className="w-9 h-9 rounded-full hover:bg-[#edeeed] transition-colors flex items-center justify-center text-[#5f6560]"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-3 max-h-96 overflow-y-auto">
                            {availableDatabases.map((db) => (
                                <button
                                    key={db.key}
                                    type="button"
                                    onClick={() => handleDbChange(db.url, db.key)}
                                    className={cn(
                                        "w-full px-4 py-4 rounded-2xl text-left transition-colors flex items-center justify-between gap-3",
                                        db.key === recinto
                                            ? "bg-[#d0e9d4] text-[#1b3022]"
                                            : "hover:bg-[#f3f4f3] text-[#191c1c]"
                                    )}
                                >
                                    <div>
                                        <p className="text-sm font-semibold">{db.name}</p>
                                        <p className="text-[11px] text-[#5f6560]">{db.key}</p>
                                    </div>
                                    {db.key === recinto && <Check className="w-4 h-4 shrink-0" />}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}