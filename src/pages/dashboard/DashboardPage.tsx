import Layout from '@/components/layouts/layout';
import { useAuth } from '@/context/AuthContext';

function DashboardPage() {
    const { logout } = useAuth();

    return <Layout>
        
        <h1 className="text-2xl font-bold">Bienvenido
            <button onClick={logout}>Cerrar sesión</button>
        </h1>
    </Layout>
}

export default DashboardPage