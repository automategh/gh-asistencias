import Layout from "@/components/layouts/layout"
import { ArrowLeft } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router-dom"


function ChekinPage() {
    const { id } = useParams<{ id: string }>()
    const [searchParams] = useSearchParams()

    const method = searchParams.get('method')
    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-20 backdrop-blur-xl">
                    <nav className="max-w-2xl mx-auto px-6 py-4">
                        <Link
                            to="/meets"
                            className="inline-flex items-center gap-2 text-secondary hover:text-secondary-light transition-colors font-semibold"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            Volver
                        </Link>
                    </nav>
                </header>
            </div>


            {id} and the method is {method}
        </Layout>
    )
}

export default ChekinPage