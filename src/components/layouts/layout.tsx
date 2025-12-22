import type React from "react";
import { useState, type JSX } from "react";
import { Sidebar } from "./sidebar";


export default function Layout({ children }: { children: React.ReactNode }): JSX.Element {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
        const saved = window.localStorage.getItem("sidebar:collapsed")
        return saved === "1"
    })
    return (
        <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background flex">
            <Sidebar onCollapsedChange={setIsSidebarCollapsed} />

            <main className={`flex-1 transition-all duration-300 ${isSidebarCollapsed ? "lg:ml-20" : "lg:ml-64"}`}>
                {children}
            </main>
        </div>
    )
}