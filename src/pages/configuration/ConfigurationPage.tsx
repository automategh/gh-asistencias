import { useAuth } from '@/context/AuthContext';
import { get, ref } from 'firebase/database';
import { Building2, Eye, EyeOff, Lock, Mail, Shield, User, Save, IdCardIcon, Briefcase } from 'lucide-react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import type { UserProfile } from '@/types/user'
import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { getDepartaments } from '@/services/departaments/departments.service';
import type { Departament } from '@/types/departament';
import { getLeaderNames, updateUserProfile } from '@/services/user.service';
import Layout from '@/components/layouts/layout';
import { useDatabase } from '@/context/DatabaseContext';
import { DEFAULT_DATABASE_URL } from '@/services/firebase';
import { SignaturePadCanvas } from '@/components/profile/signature-pad';
import { persistUserSignature } from '@/services/user-signature.service';


function ConfigurationProfilePage() {

    const { user: firebaseUser } = useAuth();
    const { database, isCorporateUser, databaseUrl } = useDatabase();
    const [user, setUser] = useState<UserProfile | null>(null)
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [departaments, setDepartaments] = useState<Departament[]>([]);
    const [signature, setSignature] = useState<string | null>(null);
    type EditableProfile = Partial<Pick<UserProfile, 'name' | 'department' | 'identify' | 'immediateBoss'>>
    const [formData, setFormData] = useState<EditableProfile>({
        name: '',
        department: '',
        identify: '',
        immediateBoss: '',
    })
    const [leaders, setLeaders] = useState<string[]>([]);
    const [passwordForm, setPasswordForm] = useState<{ current: string; next: string; confirm: string }>({ current: '', next: '', confirm: '' });
    const [showPwd, setShowPwd] = useState<{ current: boolean; next: boolean; confirm: boolean }>({ current: false, next: false, confirm: false });
    const isEmailPasswordUser = Boolean(firebaseUser?.providerData?.some(p => p?.providerId === 'password'));

    const [isMyDatabase, setIsMyDatabase] = useState<boolean | null>(null);
    const isLocked = isMyDatabase === false;


    useEffect(() => {
        if (!database) {
            return
        }

        const fetchUserData = async () => {
            try {
                const userRef = ref(database, `users/${firebaseUser?.uid}`);
                const snapshot = await get(userRef);
                const value = snapshot.val();
                setUser(value);
                setSignature(typeof value?.signatureUrl === 'string' ? value.signatureUrl : null);
            } catch (error) {
                console.error("Error al obtener datos del usuario:", error);
            }
        }

        getDepartaments(database)
            .then(departaments => {
                setDepartaments(departaments);
            })
            .catch(error => {
                console.error("Error al cargar departamentos:", error);
            });

        getLeaderNames(database)
            .then(names => {
                // Aquí podrías usar los nombres de líderes si es necesario
                setLeaders(names);
            })
            .catch(error => {
                console.error("Error al obtener nombres de líderes:", error);
            });

        if (isCorporateUser) {
            if (DEFAULT_DATABASE_URL === databaseUrl) {
                setIsMyDatabase(true);
            } else {
                setIsMyDatabase(false);
            }
        } else {
            setIsMyDatabase(true);
        }

        fetchUserData();
    }, [database, firebaseUser, isCorporateUser, databaseUrl]);


    /**
     * Maneja cambios del formulario de perfil.
     * Actualiza `formData` de forma segura y tipada.
     */
    function handleInputChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void {
        const { name, value } = event.target
        const key = name as keyof EditableProfile
        const nextValue = typeof value === 'string' ? value : String(value)
        setFormData(prev => {
            const updated = { ...prev, [key]: nextValue }
            console.log('Formulario actualizado:', updated)
            return updated
        })
    }

    async function handleSave(): Promise<void> {
        if (!database || !firebaseUser?.uid) {
            console.error("No se puede guardar el perfil: falta base de datos o usuario");
            return;
        }
        if (isLocked) {
            console.warn('Intento de guardar en base no propia');
            return;
        }
        try {
            const signatureUrlToSave = await persistUserSignature({
                uid: firebaseUser.uid,
                signature,
            })

            const updatedProfile = await updateUserProfile(database, firebaseUser.uid, {
                ...formData,
                signatureUrl: signatureUrlToSave,
            });

            console.log("Perfil actualizado:", updatedProfile);
            setUser(updatedProfile);
            setIsEditing(false);
        } catch (error) {
            console.error("Error al actualizar el perfil:", error);
        }
    }

    console.log(databaseUrl)

    function handlePasswordFieldChange(event: ChangeEvent<HTMLInputElement>): void {
        const { name, value } = event.target;
        setPasswordForm(prev => ({ ...prev, [name]: value }));
    }

    async function handleChangePassword(): Promise<void> {
        try {
            if (!firebaseUser) throw new Error('Usuario no autenticado');
            if (!isEmailPasswordUser) throw new Error('Proveedor no soportado para cambio de contraseña');
            if (!firebaseUser.email) throw new Error('El usuario no tiene email');

            const { current, next, confirm } = passwordForm;
            if (!current || !next || !confirm) {
                alert('Completa todos los campos de contraseña.');
                return;
            }
            if (next !== confirm) {
                alert('La confirmación no coincide.');
                return;
            }
            if (next.length < 6) {
                alert('La nueva contraseña debe tener al menos 6 caracteres.');
                return;
            }

            const credential = EmailAuthProvider.credential(firebaseUser.email, current);
            await reauthenticateWithCredential(firebaseUser, credential);
            await updatePassword(firebaseUser, next);
            alert('Contraseña actualizada correctamente.');
            setPasswordForm({ current: '', next: '', confirm: '' });
        } catch (error) {
            console.error('Error al cambiar la contraseña:', error);
            alert('No se pudo actualizar la contraseña. Verifica la contraseña actual.');
        }
    }

    // Inicial seguro para el avatar: displayName → name → espacio
    const initialLetter: string =
        (firebaseUser?.displayName ?? user?.name ?? '')
            .trim()
            .charAt(0)
            .toUpperCase() || ' '

    const completePerfil = user && user.identify && user.department && user.immediateBoss;

    const companyLabel: string = (user?.companyName && user.companyName.trim().length > 0)
        ? user.companyName
        : 'Grupo Heroica';

    return (
        <Layout>
            <div className="bg-linear-to-br from-background via-muted/5 to-background">
                <header className="bg-card border-b border-border sticky top-0 z-10 backdrop-blur-xl">
                    <nav className="max-w-4xl mx-auto px-6 py-4">
                        <h1 className="text-3xl font-bold mt-4 text-foreground">Configuración del perfil</h1>
                    </nav>
                </header>


                <div className="max-w-4xl mx-auto p-6 mt-8">
                    {isMyDatabase === false && (
                        <div className="mb-6 rounded-2xl border border-red-300 bg-red-50 text-red-700 p-4">
                            <p className="text-sm">
                                No estás en tu base de datos. Por lo tanto, no podrás ver tu información ni editar tu perfil en esta base.
                            </p>
                        </div>
                    )}
                    {/* Profile Card */}
                    <div className="bg-card rounded-2xl border border-border p-8 mb-6">
                        <div className="flex items-center gap-6 mb-8 pb-8 border-b border-border">
                            <div className="w-24 h-24 bg-linear-to-br from-secondary to-accent rounded-2xl flex items-center justify-center text-4xl font-bold text-secondary-foreground">
                                {initialLetter}
                            </div>
                            <div className="grow">
                                <h2 className="text-3xl font-bold text-foreground mb-2">{user?.name}</h2>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Shield className="w-4 h-4" />
                                    <span className="capitalize font-medium">{user?.role}</span>
                                </div>
                            </div>
                            {!isEditing && (
                                <button
                                    onClick={() => {
                                        setFormData({
                                            name: user?.name || '',
                                            department: user?.department || '',
                                            identify: user?.identify || '',
                                            immediateBoss: user?.immediateBoss || '',
                                        })
                                        setIsEditing(true)
                                    }}
                                    disabled={isLocked}
                                    title={isLocked ? 'No puedes editar tu perfil en esta base' : undefined}
                                    className={`px-6 py-3 font-semibold rounded-lg transition-all duration-300 ${isLocked ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5'}`}
                                >
                                    Editar Perfil
                                </button>
                            )}
                        </div>

                        {/* Information Fields */}
                        <div className="space-y-6">
                            {/* Name */}
                            <div>
                                <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <User className="w-4 h-4 text-primary" />
                                    Nombre Completo
                                </label>
                                {isEditing ? (
                                    <input
                                        disabled
                                        type="text"
                                        name="name"
                                        value={user?.name || ''}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 bg-muted/30 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                                    />
                                ) : (
                                    <div className="px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground">{user?.name}</div>
                                )}
                            </div>


                            {/* Identificación */}
                            <div>
                                <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <IdCardIcon className="w-4 h-4 text-primary" />
                                    Identificación
                                </label>
                                {isEditing ? (
                                    <input
                                        disabled={isLocked}
                                        type="text"
                                        name="identify"
                                        value={formData.identify || ""}
                                        onChange={handleInputChange}
                                        placeholder="Ej: 123456789, 00000000"
                                        className={`w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 ${isLocked ? 'bg-muted/30 text-muted-foreground' : 'focus:ring-primary text-foreground'}`}
                                    />
                                ) : (
                                    <div className="px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground">
                                        {user?.identify || "No especificado"}
                                    </div>
                                )}
                            </div>

                            {/* Jefe Inmediato */}
                            <div>
                                <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <User className="w-4 h-4 text-primary" />
                                    Jefe Inmediato
                                </label>
                                {isEditing ? (
                                    <select
                                        disabled={isLocked}
                                        name="immediateBoss"
                                        value={formData.immediateBoss || ""}
                                        onChange={handleInputChange}
                                        className={`w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 ${isLocked ? 'bg-muted/30 text-muted-foreground' : 'focus:ring-primary text-foreground'}`}
                                    >
                                        <option value="">Selecciona un líder</option>
                                        {leaders.map((leader, index) => (
                                            <option key={index} value={leader}>
                                                {leader}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground">
                                        {user?.immediateBoss || "No especificado"}
                                    </div>
                                )}
                            </div>
                            {/* Email (Read Only) */}
                            <div>
                                <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-primary" />
                                    Correo Electrónico
                                </label>
                                <div className="px-4 py-3 bg-muted/30 border border-border rounded-lg text-muted-foreground">
                                    {user?.email}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">El correo no puede ser modificado</p>
                            </div>

                            {/* Department */}
                            <div>
                                <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-primary" />
                                    Departamento
                                </label>
                                {isEditing ? (
                                    <select
                                        disabled={isLocked}
                                        name="department"
                                        value={formData.department || ""}
                                        onChange={handleInputChange}
                                        className={`w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 ${isLocked ? 'bg-muted/30 text-muted-foreground' : 'focus:ring-primary text-foreground'}`}
                                    >
                                        <option value="">Selecciona un departamento</option>
                                        {departaments.map((dep) => (
                                            <option key={dep.id} value={dep.name}>{dep.name}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground">
                                        {user?.department || "No especificado"}
                                    </div>
                                )}
                            </div>

                            {/* Empresa */}
                            <div>
                                <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <Briefcase className="w-4 h-4 text-primary" />
                                    Empresa donde trabajas
                                </label>
                                <div className="px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground">
                                    {companyLabel}
                                </div>
                            </div>

                            {/* Firma */}
                            <div className="space-y-3">
                                <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/40 text-[10px] text-primary font-semibold">
                                        F
                                    </span>
                                    Firma manuscrita
                                </label>

                                {user?.signatureUrl || signature ? (
                                    <div>
                                        <p className="text-xs text-muted-foreground mb-1">Firma actual registrada:</p>
                                        <div className="inline-block border border-border bg-white rounded-md px-3 py-2">
                                            <img
                                                src={signature || user?.signatureUrl || ''}
                                                alt="Firma registrada"
                                                className="max-h-24 object-contain"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground">Aún no has registrado tu firma.</p>
                                )}

                                {isEditing && !isLocked && (
                                    <div className="space-y-2">
                                        <p className="text-xs text-muted-foreground">
                                            Dibuja tu firma y pulsa "Confirmar" para asociarla a tu perfil. Los cambios se guardan al pulsar
                                            "Guardar Cambios".
                                        </p>
                                        {!signature && (
                                            <SignaturePadCanvas
                                                height={160}
                                                disabled={false}
                                                onSave={(sig) => {
                                                    setSignature(sig)
                                                }}
                                            />
                                            
                                        )}
                                    </div>
                                )}
                            </div>



                            {/* Action Buttons */}
                            {isEditing && (
                                <div className="flex gap-4 pt-6">
                                    <button
                                        onClick={handleSave}
                                        disabled={isLocked}
                                        title={isLocked ? 'No puedes guardar cambios en esta base' : undefined}
                                        className={`flex-1 px-6 py-3 font-semibold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 ${isLocked ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5'}`}
                                    >
                                        <Save className="w-5 h-5" />
                                        Guardar Cambios
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsEditing(false)
                                            setFormData({
                                                name: user?.name || "",
                                                department: user?.department || "",
                                                identify: user?.identify || "",
                                                immediateBoss: user?.immediateBoss || "",
                                            })
                                        }}
                                        className="flex-1 px-6 py-3 bg-transparent border-2 border-border text-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-muted"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Account Info */}
                    <div className="bg-card rounded-2xl border border-border p-6">
                        <h3 className="text-lg font-bold text-foreground mb-4">Información de Cuenta</h3>
                        <div className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Tipo de Usuario</span>
                                <span className="font-medium text-foreground capitalize">{user?.role}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Estado del Perfil</span>
                                <span className={`font-medium ${completePerfil ? "text-green-500" : "text-red-500"}`}> {completePerfil ? "Completo" : "Incompleto"}</span>
                            </div>
                        </div>
                    </div>

                    {/* Change Password */}
                    {isEmailPasswordUser && (
                        <div className="bg-card rounded-2xl border border-border p-6 mt-6">
                            <h3 className="text-lg font-bold text-foreground mb-4">Cambiar contraseña</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                        <Lock className="w-4 h-4 text-primary" />
                                        Contraseña actual
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showPwd.current ? 'text' : 'password'}
                                            name="current"
                                            value={passwordForm.current}
                                            onChange={handlePasswordFieldChange}
                                            className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground pr-12"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPwd(prev => ({ ...prev, current: !prev.current }))}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                            aria-label="Mostrar/ocultar contraseña actual"
                                        >
                                            {showPwd.current ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                        <Lock className="w-4 h-4 text-primary" />
                                        Nueva contraseña
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showPwd.next ? 'text' : 'password'}
                                            name="next"
                                            value={passwordForm.next}
                                            onChange={handlePasswordFieldChange}
                                            className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground pr-12"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPwd(prev => ({ ...prev, next: !prev.next }))}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                            aria-label="Mostrar/ocultar nueva contraseña"
                                        >
                                            {showPwd.next ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                        <Lock className="w-4 h-4 text-primary" />
                                        Confirmar nueva contraseña
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showPwd.confirm ? 'text' : 'password'}
                                            name="confirm"
                                            value={passwordForm.confirm}
                                            onChange={handlePasswordFieldChange}
                                            className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground pr-12"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPwd(prev => ({ ...prev, confirm: !prev.confirm }))}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                            aria-label="Mostrar/ocultar confirmación"
                                        >
                                            {showPwd.confirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                        </button>
                                    </div>
                                </div>
                                <div className="pt-2">
                                    <button
                                        type="button"
                                        onClick={handleChangePassword}
                                        className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg transition-all duration-300 hover:bg-primary-light"
                                    >
                                        Cambiar contraseña
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    )
}

export default ConfigurationProfilePage