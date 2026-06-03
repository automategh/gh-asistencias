import { useAuth } from "@/context/AuthContext"
import { Mail, Lock, AlertCircle } from "lucide-react"
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

function LoginPage() {

    const { loginWithMicrosoft, loading, loginWithEmailPassword } = useAuth();

    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

    const handleLoginWithCredentials = async () => {
        setError("")
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email.trim())) {
            setError("El correo no es válido.")
            return
        }
        if (password.length < 8) {
            setError("La contraseña debe tener al menos 8 caracteres.")
            return
        }

        try {
            await loginWithEmailPassword(email.trim(), password)
            const redirectTo = searchParams.get("redirect")
            if (redirectTo && redirectTo.startsWith('/')) {
                navigate(redirectTo)
            } else {
                navigate("/")
            }
        } catch (err) {
            const e = err as { code?: string; message?: string }
            let message = e?.message || "Error al iniciar sesión."
            switch (e?.code) {
                case "auth/invalid-email":
                    message = "El correo no es válido."
                    break
                case "auth/user-not-found":
                    message = "Usuario no encontrado."
                    break
                case "auth/wrong-password":
                case "auth/invalid-credential":
                    message = "Credenciales inválidas."
                    break
                case "auth/too-many-requests":
                    message = "Demasiados intentos. Intenta más tarde."
                    break
                case "auth/user-disabled":
                    message = "Usuario deshabilitado."
                    break
            }
            setError(message)
        }
    }

    const handleLoginWithMicrosoft = async () => {
        setError("")
        try {
            await loginWithMicrosoft()
            const redirectTo = searchParams.get("redirect")
            if (redirectTo && redirectTo.startsWith('/')) {
                navigate(redirectTo)
            } else {
                navigate('/')
            }
        } catch (err) {
            const e = err as { message?: string }
            setError(e?.message ?? 'Error al iniciar sesión con Microsoft')
        }
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-background via-muted/20 to-background">
            <div className="flex justify-center items-center">
                <div>
                    <div className="max-w-sm w-full aspect-video relative">
                        <img
                            src="/Logo-heroica-green.png"
                            alt="Logo Heroica"
                            className="w-full h-full object-contain"
                        />
                    </div>
                    <form className=" bg-card rounded-2xl border border-border p-6 space-y-5">
                        <div className="mb-6">
                            <h2 className="text-2xl font-bold text-foreground mb-1">Inicio de Sesión </h2>
                            <p className="text-sm text-muted-foreground">Accede con tu correo </p>
                        </div>

                        {error && (
                            <div className="flex gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg">
                                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                <span className="text-sm font-medium">{error}</span>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-semibold text-foreground mb-2">Correo </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
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
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            onClick={handleLoginWithCredentials}
                            disabled={loading}
                            className="w-full px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin"></div>
                                    Verificando...
                                </span>
                            ) : (
                                "Iniciar Sesión"
                            )}

                        </button>

                        <div className="my-4">
                            <div className="flex items-center">
                                <div className="h-px flex-1 bg-border" />
                                <span className="mx-3 text-xs text-muted-foreground">o</span>
                                <div className="h-px flex-1 bg-border" />
                            </div>
                        </div>

                        <button
                            onClick={handleLoginWithMicrosoft}
                            type="button"
                            aria-label="Iniciar sesión con Microsoft"
                            className="w-full px-6 py-3 bg-white dark:bg-slate-900 border border-border text-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-muted/40 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 flex items-center justify-center gap-3"
                        >
                            <span className="inline-flex items-center gap-3">
                                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" focusable="false">
                                    <rect x="1" y="1" width="10" height="10" fill="#F25022" />
                                    <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
                                    <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
                                    <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
                                </svg>
                                <span>Iniciar sesión con Microsoft</span>
                            </span>
                        </button>

                        <div className="my-4">
                            <div className="flex items-center justify-center">
                                <span className="mx-3 text-sm">No tienes cuenta?</span>
                            </div >
                            <div className="flex items-center justify-center mt-2">
                                <span className="mx-3 text-xs text-blue-500 hover:text-blue-700 cursor-pointer">
                                    <Link to="/register" className="underline underline-offset-4 decoration-2">Regístrate aquí</Link>
                                </span>
                            </div>
                        </div>
                    </form>
                </div>

            </div>

        </div>
    )
}

export default LoginPage