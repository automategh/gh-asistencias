import type React from "react";
import { useState, type JSX } from "react";
import PageHeader, { type PageHeaderConfig } from "./page-header";
import { Sidebar } from "./sidebar";

/**
 * Layout principal con sidebar.
 * @param props.children Contenido de la página
 * @returns Componente de layout
 */
interface LayoutProps {
    readonly children: React.ReactNode
    readonly header?: PageHeaderConfig
}

export default function Layout({ children, header }: LayoutProps): JSX.Element {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
        const saved = window.localStorage.getItem("sidebar:collapsed")
        return saved === "1"
    })
    return (
        <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background flex">
            <Sidebar onCollapsedChange={setIsSidebarCollapsed} />

            <main className={`flex-1 transition-all duration-300 ${isSidebarCollapsed ? "lg:ml-20" : "lg:ml-64"}`}>
                {header && <PageHeader config={header} />}
                {children}
            </main>
        </div>
    )
}