import { useAuth } from "@/context/AuthContext"
import { useDatabase } from "@/context/DatabaseContext"
import { cn } from "@/lib/utils"
import { Calendar, ChevronLeft, ChevronRight, LogOut, Menu, UserCircle, UserCog, X, LayoutDashboard, User, PlusCircleIcon, ChartColumnBig, Building2Icon, ClipboardList } from "lucide-react"
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

    const [showDbModal, setShowDbModal] = useState<boolean>(false)

    const { availableDatabases, isCorporateUser, setSelectedDatabase, recinto } = useDatabase()

    const handleDbChange = (url: string, key: typeof recinto) => {
        setSelectedDatabase(url, key);
        setShowDbModal(false);
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
                    <div
                        className={`flex items-center gap-3 p-3 bg-muted/30 rounded-lg ${isCollapsed ? "lg:justify-center lg:p-3" : ""} cursor-pointer`}
                        onClick={() => setShowDbModal(true)}
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
                            <p className="font-semibold text-sm text-foreground truncate whitespace-nowrap">{user?.displayName || "Usuario"}</p>
                            <p className="text-xs text-muted-foreground whitespace-nowrap">En línea</p>
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

            {/* Modal de selección de base de datos para usuarios corporativos  */}
            {isCorporateUser && showDbModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-[#273c2a]">Cambiar de recinto</h2>
                            <button
                                onClick={() => setShowDbModal(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                ✕
                            </button>
                        </div>
                        <p className="text-sm text-gray-600 mb-6">
                            Selecciona el recinto que deseas visualizar:
                        </p>
                        <div className="space-y-3">
                            {availableDatabases.map((db) => (
                                <button
                                    key={db.key}
                                    onClick={() => handleDbChange(db.url, db.key)}
                                    className={cn(
                                        "w-full px-4 py-3 text-left border rounded-lg transition-colors",
                                        db.key === recinto
                                            ? "border-[#F2B05F] bg-[#F2B05F]/10 font-semibold"
                                            : "border-[#B0B3B2] hover:bg-[#F2B05F]/10 hover:border-[#F2B05F]"
                                    )}
                                >
                                    <span className="text-[#273c2a]">{db.name}</span>
                                    {db.key === recinto && (
                                        <span className="ml-2 text-xs text-[#F2B05F]">(Actual)</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

            )}
        </>
    )
}