import { Sidebar } from '@/components/layouts/sidebar';
import { useAuth } from '@/context/AuthContext';

function DashboardPage() {
    const { logout } = useAuth();

    return <>
        <Sidebar onCollapsedChange={(collapsed) => {
            console.log("Sidebar collapsed:", collapsed);
        }} />
        <h1 className="text-2xl font-bold">Bienvenido
            <button onClick={logout}>Cerrar sesión</button>
        </h1>
    </>
}

export default DashboardPage