import { useAuth } from "@/context/AuthContext";
import { getDatabaseByRecinto, type RecintoKey } from "@/lib/firebase/databaseResolver";
import { getDepartmentNamesAllDatabases } from "@/services/departaments/departments.service";
import { getLeaderNames } from "@/services/user.service";
import type { RegisterFormData } from "@/types/user";
import { Building2, ChevronDown, IdCard, Landmark, Lock, Mail, User } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom";

function RegisterPage() {

    const { registerWithEmailPassword } = useAuth();
    const navigate = useNavigate()
    const [departaments, setDepartaments] = useState<string[]>([]);
    const [leaders, setLeaders] = useState<string[]>([]);
    const [formData, setFormData] = useState<RegisterFormData>({
        name: "",
        email: "",
        identify: "",
        department: "",
        password: "",
        confirmPassword: "",
        recint: "",
        leader: "",
        worksAtHeroica: true,
        companyName: "",
    });
    const [error, setError] = useState<string | null>(null);

    const handleRecintoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const key = e.target.value as RecintoKey;

        const db = getDatabaseByRecinto(key);

        setFormData(prev => ({ ...prev, recint: key }));

        // Cargar líderes para el recinto seleccionado
        if (db) {
            getLeaderNames(db)
                .then((data) => {
                    setLeaders(data);
                    console.log("Líderes cargados para recinto", key, data);
                })
                .catch((error) => {
                    console.error("Error fetching leaders:", error);
                });
        }
    }

    useEffect(() => {
        getDepartmentNamesAllDatabases()
            .then((data) => {
                setDepartaments(data);
            })
            .catch((error) => {
                console.error("Error fetching departaments:", error);
            });
    }, [])

    /**
     * Maneja el cambio de valor en los elementos de formulario (inputs y selects)
     * y actualiza el estado formData usando el atributo name del elemento.
     *
     * @param e Evento de cambio del elemento HTML (input o select).
     * @returns void
     */
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target
        updateField(name as keyof RegisterFormData, value as RegisterFormData[keyof RegisterFormData])
    }

    /**
     * Maneja el cambio del checkbox "¿Trabajas en Grupo Heroica?".
     *
     * - Actualiza la bandera `worksAtHeroica` en el estado del formulario.
     * - Cuando el usuario marca que sí trabaja en Grupo Heroica, limpia el campo `companyName`
     *   porque no es necesario indicar una empresa externa.
     *
     * @param e Evento de cambio del input checkbox.
     * @returns void
     */    
    const handleHeroicaCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { checked } = e.target
        updateField("worksAtHeroica", checked)
        if (checked) {
            updateField("companyName", "")
        }
    }

    const updateField = <K extends keyof RegisterFormData>(name: K, value: RegisterFormData[K]) => {
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    const validateForm = (data: RegisterFormData): string | null => {
        if (!data.name.trim()) return "El nombre es obligatorio.";
        if (!data.email.trim()) return "El correo electrónico es obligatorio.";
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(data.email)) return "El correo no es válido."
        if (!data.identify.trim()) return "La identificación es obligatoria.";
        if (!data.department.trim()) return "El departamento es obligatorio.";
        if (!data.recint.trim()) return "El recinto es obligatorio.";
        if (!data.worksAtHeroica && !data.companyName.trim()) return "La empresa es obligatoria si no trabajas en Grupo Heroica.";
        if (!data.password) return "La contraseña es obligatoria.";
        if (data.password.length < 8) return "La contraseña debe tener al menos 8 caracteres."
        if (data.password !== data.confirmPassword) return "Las contraseñas no coinciden.";
        return null;
    }

    const handleRegister = async () => {
        setError(null);
        const validationError = validateForm(formData)
        if (validationError) {
            setError(validationError)
            return
        }
        try {
            const newUser = await registerWithEmailPassword(formData);
            // Aquí podrías redirigir al usuario o mostrar un mensaje de éxito
            console.log("Usuario registrado:", newUser);
            navigate('/login')
        } catch (error) {
            // Ajusta manejo de errores según tu AuthContext
            const message = error instanceof Error ? error.message : "Error al crear la cuenta."
            setError(message)
        }

    }


    return (
        <div className="min-h-screen bg-linear-to-br from-background via-muted/20 to-background">
            <div className="flex justify-center items-center pt-12">
                <form className="bg-card rounded-2xl border border-border p-6 space-y-5">
                    <div className="mb-6">
                        <h2 className="text-2xl font-bold text-foreground mb-1">Registro</h2>
                        <p className="text-sm text-muted-foreground">Completa tu información</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-foreground mb-2">Nombre Completo *</label>
                            <div className="relative">
                                <User className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    placeholder="Juan Pérez García"
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-foreground mb-2">Correo Electrónico *</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    placeholder="tu@correo.com"
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-foreground mb-2">Identificación *</label>
                            <div className="relative">
                                <IdCard className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                                <input
                                    type="text"
                                    name="identify"
                                    value={formData.identify}
                                    onChange={handleChange}
                                    placeholder="ej: 1225478963"
                                    className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10"
                                    required
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-foreground mb-2">Departamento *</label>

                            <div className="relative">
                                <Building2 className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                                <select
                                    name="department"
                                    defaultValue=""
                                    value={formData.department}
                                    onChange={handleChange}
                                    className="w-full bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10 pr-10 appearance-none cursor-pointer py-3"
                                    required
                                >
                                    <option value="" disabled>Selecciona tu departamento</option>
                                    {departaments.map((dept) => (
                                        <option key={dept} value={dept}>{dept}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-foreground mb-2">Recinto *</label>

                            <div className="relative">
                                <Landmark className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />

                                <select
                                    name="recinto"
                                    defaultValue=""
                                    value={formData.recint}
                                    onChange={handleRecintoChange}
                                    className="w-full bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10 pr-10 appearance-none cursor-pointer py-3"
                                    required
                                >
                                    <option value="" disabled>Selecciona tu recinto</option>
                                    <option value="ccci">CCCI</option>
                                    <option value="cevp">CEVP</option>
                                    <option value="cccr">CCCR</option>
                                    <option value="corporativo">Corporativo</option>
                                </select>
                                <ChevronDown className="absolute right-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                            </div>
                        </div>

                        <div className="md:col-span-2 flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <input
                                    type="checkbox"
                                    name="worksAtHeroica"
                                    checked={formData.worksAtHeroica}
                                    onChange={handleHeroicaCheckboxChange}
                                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                />
                                <span>¿Trabajas en Grupo Heroica?</span>
                            </label>
                            {!formData.worksAtHeroica && (
                                <div>
                                    <label className="block text-xs font-medium text-foreground mb-1">Empresa donde trabajas *</label>
                                    <input
                                        type="text"
                                        name="companyName"
                                        value={formData.companyName}
                                        onChange={handleChange}
                                        placeholder="Nombre de la empresa"
                                        className="w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800"
                                        required
                                    />
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-foreground mb-2">Jefe inmediato *</label>
                            <div className="relative">
                                <User className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                                <select
                                    name="leader"
                                    defaultValue=""
                                    value={formData.leader}
                                    onChange={handleChange}
                                    className="w-full bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10 pr-10 appearance-none cursor-pointer py-3"
                                    required
                                >
                                    <option value="">Selecciona tu jefe inmediato</option>
                                    {leaders.map((leader) => (
                                        <option key={leader} value={leader}>{leader}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-foreground mb-2">Contraseña *</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                            <input
                                type="password"
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                className="w-full bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10 pr-10 py-3"
                                placeholder="Ingresa tu contraseña"
                                required
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-foreground mb-2">Confirmar Contraseña *</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3.5 w-5 h-5 text-muted-foreground pointer-events-none" />
                            <input
                                type="password"
                                name="confirmPassword"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                className="w-full bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-transparent hover:bg-white dark:hover:bg-slate-800 pl-10 pr-10 py-3"
                                placeholder="Confirma tu contraseña"
                                required
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="text-sm text-red-600 font-semibold">
                            {error}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={handleRegister}
                        className="w-full bg-primary text-primary-foreground font-semibold rounded-lg px-6 py-3 hover:bg-primary-light transition-colors"
                    >
                        Registrarse
                    </button>

                </form>
            </div>
        </div>
    )
}

export default RegisterPage