import { Mail, Lock, AlertCircle } from "lucide-react"

function LoginPage() {
    return (
        <div className="min-h-screen bg-linear-to-br from-background via-muted/20 to-background">
            <div className="flex justify-center items-center">
                <form className="bg-card rounded-2xl border border-border p-6 space-y-5">
                    <div className="mb-6">
                        <h2 className="text-2xl font-bold text-foreground mb-1">Inicio de Sesión </h2>
                        <p className="text-sm text-muted-foreground">Accede con tu correo </p>
                    </div>

                    {/* {error && (
                    <div className="flex gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <span className="text-sm font-medium">{error}</span>
                    </div>
                )} */}

                    <div>
                        <label className="block text-sm font-semibold text-foreground mb-2">Correo </label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                            <input
                                type="email"
                                // value={email}
                                // onChange={(e) => setEmail(e.target.value)}
                                placeholder="nombre@grupoheroica.com"
                                className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10"
                                required
                            />
                        </div>
                        
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-foreground mb-2">Contraseña</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                            <input
                                type="password"
                                // value={password}
                                // onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"

                        className="w-full px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                    >
                        {/* {loading ? (
                        <span className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin"></div>
                            Verificando...
                        </span>
                    ) : (
                        "Iniciar Sesión"
                    )} */}

                        Iniciar Sesión
                    </button>
                </form>
            </div>

        </div>
    )
}

export default LoginPage