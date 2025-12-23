import { useAuth } from "@/context/AuthContext"
import { Calendar, ChevronLeft, ChevronRight, Home, LogOut, Menu, Plus, UserCircle, UserCog, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"

interface SidebarProps {
    onCollapsedChange: (collapsed: boolean) => void
}

export function Sidebar({ onCollapsedChange }: SidebarProps) {

    const { user, logout, role } = useAuth()
    
const location = useLocation()

    // Estado móvil (se cierra automáticamente al cambiar de ruta)
    const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false)

    // Persistencia de colapso en localStorage para evitar “abrirse” en cada navegación
    const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
        const saved = window.localStorage.getItem("sidebar:collapsed")
        return saved === "1"
    })

    // Cierra el sidebar móvil al cambiar de ruta de forma asíncrona y solo si está abierto
    useEffect(() => {
        if (!isMobileOpen) return
        const id = window.setTimeout(() => setIsMobileOpen(false), 0)
        return () => window.clearTimeout(id)
    }, [location.pathname, isMobileOpen])

    const pathname = location.pathname

    const toggleCollapsed = (): void => {
        const newState = !isCollapsed
        setIsCollapsed(newState)
        onCollapsedChange?.(newState)
        window.localStorage.setItem("sidebar:collapsed", newState ? "1" : "0")
    }

    const links = [
        { icon: Home, name: "Dashboard", path: "/", roles: ["Admin", "Lider", "User"] },
        { icon: Plus, name: "Nueva Reunion", path: "/new-meeting", roles: ["Admin", "Lider"] },
        { icon: UserCog, name: "Perfil", path: "/configure-profile", roles: ["Admin", "Lider", "User"] },
        
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
                className={`fixed top-0 left-0 h-full bg-card border-r border-border z-40 transition-all duration-300 flex flex-col ${isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                    } ${isCollapsed ? "lg:w-20" : "lg:w-64"} w-64`}
            >

                <button
                    onClick={toggleCollapsed}
                    className="hidden lg:flex absolute -right-3 top-8 w-8 h-8 bg-primary text-primary-foreground rounded-full items-center justify-center shadow-xl hover:bg-primary/90 transition-all hover:scale-110 z-50 border-2 border-background"
                >
                    {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
                </button>

                {/* Logo Section */}
                <div className="p-6 border-b border-border">
                    <div className={`flex items-center gap-3 ${isCollapsed ? "lg:justify-center lg:flex-col lg:gap-2" : ""}`}>
                        <div className="w-10 h-10 bg-linear-to-br from-primary to-primary-light rounded-xl flex items-center justify-center shrink-0">
                            <Calendar className="w-5 h-5 text-primary-foreground" />
                        </div>
                        <div className={`transition-all duration-300 overflow-hidden ${isCollapsed ? "lg:hidden" : "lg:block"}`}>
                            <h1 className="font-bold text-lg text-foreground whitespace-nowrap">Asistencia</h1>
                            <p className="text-xs text-muted-foreground capitalize whitespace-nowrap">{role}</p>
                        </div>
                    </div>
                </div>

                {/* User Info */}
                <div className="p-4 border-b border-border">
                    <div
                        className={`flex items-center gap-3 p-3 bg-muted/30 rounded-lg ${isCollapsed ? "lg:justify-center lg:p-3" : ""}`}
                    >
                        <div className="w-10 h-10 bg-linear-to-br from-secondary to-accent rounded-full flex items-center justify-center shrink-0">
                            <UserCircle className="w-5 h-5 text-secondary-foreground" />
                        </div>
                        <div
                            className={`flex-1 min-w-0 transition-all duration-300 overflow-hidden ${isCollapsed ? "lg:hidden" : "lg:block"}`}
                        >
                            <p className="font-semibold text-sm text-foreground truncate whitespace-nowrap">{user?.displayName || "Usuario"}</p>
                            <p className="text-xs text-muted-foreground whitespace-nowrap">En línea</p>
                        </div>
                    </div>
                </div>

                {/* Nav Links */}
                <nav className="flex-1 p-4 overflow-y-auto overflow-x-hidden">
                    <ul className="space-y-2">
                        {links.map((link) => {
                            if (!link.roles.includes(role || "")) return null
                            const isActive = pathname === link.path
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

                {/* Logout Button */}
                <div className="p-4 border-t border-border">
                    <button
                        onClick={logout}
                        className={`w-full flex items-center gap-2 px-4 py-3 bg-transparent border-2 border-primary text-primary font-semibold rounded-lg transition-all duration-300 hover:bg-primary hover:text-primary-foreground hover:shadow-lg ${isCollapsed ? "lg:justify-center lg:px-0" : "justify-center"
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
        </>
    )
}