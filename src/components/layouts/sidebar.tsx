import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"
import type { PermissionId } from "@/types/authorization"
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, LogOut, Menu, UserCircle, UserCog, X, LayoutDashboard, User, PlusCircleIcon, ChartColumnBig, Building2Icon, ClipboardList, GroupIcon, Users } from "lucide-react"
import { useState } from "react"
import { Link, useLocation } from "react-router-dom"

interface SidebarProps {
    onCollapsedChange: (collapsed: boolean) => void
}

export function Sidebar({ onCollapsedChange }: SidebarProps) {

    const { user, logout, hasPermission, profilePhotoUrl } = useAuth()

    const location = useLocation()

    // Estado móvil del sidebar
    const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false)
    const [showUserDropdown, setShowUserDropdown] = useState<boolean>(false)

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

    const links: ReadonlyArray<{
        readonly icon: typeof LayoutDashboard
        readonly name: string
        readonly path: string
        readonly requireAny: readonly PermissionId[]
    }> = [
        { icon: LayoutDashboard, name: "Dashboard", path: "/", requireAny: ["dashboard_view"] },
        { icon: PlusCircleIcon, name: "Nueva Actividad", path: "/new-meeting", requireAny: ["meetings_create"] },
        { icon: Calendar, name: "Actividades", path: "/meets", requireAny: ["meetings_view"] },
        { icon: User, name: "Perfil", path: "/configure-profile", requireAny: ["profile_edit_self"] },
        { icon: ChartColumnBig, name: "Reportes", path: "/reports", requireAny: ["reports_view_team", "reports_view_all"] },
        { icon: Building2Icon, name: "Areas", path: "/departments", requireAny: ["departments_manage"] },
        { icon: GroupIcon, name: "Formas de agrupar", path: "/user-grouping", requireAny: ["user_grouping_manage"] },
        { icon: ClipboardList, name: "Encuestas", path: "/survey", requireAny: ["surveys_admin_view"] },
        { icon: Users, name: "Usuarios", path: "/users", requireAny: ["users_view", "users_activate", "users_deactivate", "users_assign_role"] },
        { icon: UserCog, name: "Permisos", path: "/permissions", requireAny: ["roles_view", "roles_manage"] },
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
                            const hasAccess = link.requireAny.some((permissionId) => hasPermission(permissionId))
                            if (!hasAccess) return null
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
                                            setShowUserDropdown(false)

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
                <div className="p-4 pt-0">
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowUserDropdown((previous) => !previous)}
                            className={`w-full flex items-center gap-3 p-3 bg-muted/30 rounded-lg hover:bg-muted/45 transition-colors ${isCollapsed ? "lg:justify-center lg:p-3" : ""}`}
                            title={isCollapsed ? (user?.displayName || "Usuario") : undefined}
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
                                <div className="w-full flex items-center justify-between gap-2 text-left">
                                    <span className="font-semibold text-sm text-foreground truncate whitespace-nowrap">{user?.displayName || "Usuario"}</span>
                                    <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${showUserDropdown ? "rotate-180" : ""}`} />
                                </div>
                                <p className="text-xs text-muted-foreground whitespace-nowrap truncate text-left">
                                    En linea
                                </p>
                            </div>

                        </button>

                        {showUserDropdown && (
                            <div className={cn(
                                "absolute bottom-full mb-3 rounded-2xl border border-border bg-white shadow-[0_20px_40px_rgba(15,23,42,0.18)] p-2 z-60",
                                isCollapsed ? "left-0 w-56" : "left-0 right-0"
                            )}>
                                <button
                                    type="button"
                                    onClick={logout}
                                    className="w-full px-4 py-3 rounded-xl text-left text-sm font-medium text-[#93000a] hover:bg-[#fff1f0] transition-colors flex items-center gap-2"
                                >
                                    <LogOut className="w-4 h-4" />
                                    <span>Cerrar sesión</span>
                                </button>
                                
                            </div>
                        )}
                    </div>
                </div>
            </aside>     
        </>
    )
}