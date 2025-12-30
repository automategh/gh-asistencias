import Layout from '@/components/layouts/layout'
import { useParams } from 'react-router-dom'

function DetailMeetPage() {

    const { id } = useParams<{ id: string }>()
    if (!id) {
        return <div>Identificador de reunión no válido.</div>
    }

    return (
        <Layout>
            <div className="p-4">
            <h1 className="text-xl font-semibold">Detalle de reunión</h1>
            <p className="text-sm text-gray-600">ID: {id}</p>
            {/* Aquí puedes cargar datos de RTDB usando el id */}
        </div>
        </Layout>
        
    )
}

export default DetailMeetPage