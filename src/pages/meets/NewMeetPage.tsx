import Layout from '@/components/layouts/layout'

function NewMeetPage() {
    return (
        <Layout>
            <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-10 backdrop-blur-xl">
                    <nav className="max-w-4xl mx-auto px-6 py-4">
                        <h1 className="text-3xl font-bold mt-4 text-foreground">Nueva Reunión</h1>
                    </nav>
                </header>
            </div>

        </Layout>
    )
}

export default NewMeetPage