import { useAuth } from '@/context/AuthContext';
import { get, ref } from 'firebase/database';
import { Eye, EyeOff, Lock, Save, Loader2, IdCard, LucideFolderTree, AtSign, KeyRound, PenLine } from 'lucide-react';
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
import { Button } from '@/components/ui/button';


function ConfigurationProfilePage() {

    const { user: firebaseUser, profilePhotoUrl } = useAuth();
    const { database, isCorporateUser, databaseUrl } = useDatabase();
    const [user, setUser] = useState<UserProfile | null>(null)
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [departaments, setDepartaments] = useState<Departament[]>([]);
    const [signature, setSignature] = useState<string | null>(null);
    type EditableProfile = Partial<Pick<UserProfile, 'name' | 'department' | 'identify' | 'immediateBoss' | 'cargo'>>
    const [formData, setFormData] = useState<EditableProfile>({
        name: '',
        department: '',
        identify: '',
        immediateBoss: '',
        cargo: '',
    })
    const [leaders, setLeaders] = useState<string[]>([]);
    const [passwordForm, setPasswordForm] = useState<{ current: string; next: string; confirm: string }>({ current: '', next: '', confirm: '' });
    const [showPwd, setShowPwd] = useState<{ current: boolean; next: boolean; confirm: boolean }>({ current: false, next: false, confirm: false });
    const [savingProfile, setSavingProfile] = useState<boolean>(false);
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
            setSavingProfile(true);
            const signatureUrlToSave = await persistUserSignature({
                uid: firebaseUser.uid,
                signature,
            })

            const updatedProfile = await updateUserProfile(database, firebaseUser.uid, {
                ...formData,
                signatureUrl: signatureUrlToSave,
            });

            setUser(updatedProfile);
            setIsEditing(false);
        } catch (error) {
            console.error("Error al actualizar el perfil:", error);
        } finally {
            setSavingProfile(false);
        }
    }

    async function handleSignatureUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
        if (!event.target.files || event.target.files.length === 0) {
            return;
        }

        const file = event.target.files[0];

        if (!file.type.startsWith("image/")) {
            alert("Por favor selecciona un archivo de imagen válido (PNG, JPG, etc.).");
            return;
        }

        const reader = new FileReader();

        reader.onloadend = () => {
            const result = reader.result;
            if (typeof result === "string") {
                setSignature(result);
            }
        };

        reader.readAsDataURL(file);
        // Permitir volver a seleccionar el mismo archivo si el usuario lo desea
        event.target.value = "";
    }
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

    const companyLabel: string = (user?.companyName && user.companyName.trim().length > 0)
        ? user.companyName
        : 'Grupo Heroica';

    const getRoleDescription = (role: string | undefined | null): string => {
        if (!role) {
            return 'Usuario estándar del sistema con acceso a sus propias asistencias y capacitaciones.';
        }

        switch (role) {
            case 'Admin':
                return 'Administrador de sistema con permisos globales. Responsable de la gestión de departamentos y reportes mensuales.';
            case 'HR':
                return 'Rol de Talento Humano enfocado en la administración de personal, seguimiento de capacitaciones y análisis de reportes.';
            case 'Lider':
                return 'Líder de equipo encargado de gestionar las asistencias y capacitaciones de su grupo de colaboradores.';
            case 'User':
            default:
                return 'Colaborador que participa en las actividades de formación y registra sus asistencias.';
        }
    };

    return (
        <Layout>
            <div className="bg-linear-to-br from-background via-muted/5 to-background">
                <header className="sticky top-0 z-10 bg-zinc-50/85 backdrop-blur-xs">
                    <nav className='px-4 md:px-12 py-4 md:py-8 max-w-7xl mx-auto'>
                        <h1 className="text-3xl font-bold tracking-tight">Configuración del perfil</h1>
                        <p className="font-body text-[#434843] text-sm mt-1">Gestiona tu información personal y credenciales de acceso.</p>
                    </nav>
                </header>

                <div className='px-4 md:px-12 py-10 md:py-16 space-y-10'>
                    <div className="max-w-7xl md:mx-auto">
                        {isMyDatabase === false && (
                            <div className="mb-6 rounded-2xl border border-red-300 bg-red-50 text-red-700 p-4">
                                <p className="text-sm">
                                    No estás en tu base de datos. Por lo tanto, no podrás ver tu información ni editar tu perfil en esta base.
                                </p>
                            </div>
                        )}
                        <section className='bg-[#f3f4f3] rounded-3xl p-8 mb-8 flex flex-col md:flex-row items-center md:items-start gap-8'>
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full overflow-hidden border border-border bg-secondary flex items-center justify-center text-4xl font-bold text-secondary-foreground">
                                    {profilePhotoUrl ? (
                                        <img
                                            src={profilePhotoUrl}
                                            alt={firebaseUser?.displayName ?? user?.name ?? firebaseUser?.email ?? "Foto de perfil"}
                                            className="w-full h-full object-cover"
                                            referrerPolicy="no-referrer"
                                        />
                                    ) : (
                                        <span>{initialLetter}</span>
                                    )}
                                </div>
                            </div>
                            <div className="grow">
                                <h2 className="text-3xl font-bold text-foreground mb-2">{user?.name}</h2>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span className="text-xs px-2.5 py-1 rounded-lg bg-secondary-light/15 text-secondary">{user?.role === 'HR' ? 'Talento Humano' : user?.role}</span>
                                    <div className='flex gap-2 items-center justify-center'>
                                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                        <span className="text-xs">Activo</span>
                                    </div>
                                </div>
                                <p className="mt-3 text-sm text-muted-foreground max-w-xl">
                                    {getRoleDescription(user?.role ?? null)}
                                </p>
                            </div>
                            <div className="md:ml-auto flex gap-3 self-center md:self-start">

                                {!isEditing && (
                                    <button
                                        onClick={() => {
                                            setFormData({
                                                name: user?.name || '',
                                                department: user?.department || '',
                                                identify: user?.identify || '',
                                                immediateBoss: user?.immediateBoss || '',
                                                cargo: user?.cargo || '',
                                            })
                                            setIsEditing(true)
                                        }}
                                        disabled={isLocked}
                                        title={isLocked ? 'No puedes editar tu perfil en esta base' : undefined}
                                        className={`px-8 py-2.5 rounded-full font-medium transition-all duration-300 ${isLocked ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5'}`}
                                    >
                                        Editar Perfil
                                    </button>
                                )}

                                {isEditing && (
                                    <button
                                        onClick={() => {
                                            setIsEditing(false)
                                            setFormData({
                                                name: user?.name || "",
                                                department: user?.department || "",
                                                identify: user?.identify || "",
                                                immediateBoss: user?.immediateBoss || "",
                                                cargo: user?.cargo || "",
                                            })
                                        }}
                                        className="flex-1 px-8 py-2.5 bg-muted hover:bg-muted-light text-foreground font-medium rounded-full transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                                    >
                                        Cancelar
                                    </button>)}
                            </div>
                        </section>


                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            <div className="lg:col-span-2 space-y-8">
                                <div className="bg-white rounded-3xl p-8 shadow-[0_20px_20px_rgba(25,28,28,0.02)]">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-900">
                                            <IdCard className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold">Información Personal</h3>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                                        <div>
                                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                                                Nombre completo
                                            </label>
                                            <input
                                                type="text"
                                                value={user?.name || ''}
                                                disabled
                                                className="w-full px-3 py-2 text-sm bg-muted/40 rounded-lg text-foreground cursor-not-allowed"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                                                Identificación
                                            </label>
                                            <input
                                                type="text"
                                                name="identify"
                                                value={isEditing ? (formData.identify || '') : (user?.identify || '')}
                                                disabled={!isEditing || isLocked}
                                                onChange={handleInputChange}
                                                className={`w-full px-3 py-2 text-sm bg-muted/40 rounded-lg text-foreground ${!isEditing || isLocked ? 'cursor-not-allowed' : ''}`}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-3xl p-8 shadow-[0_20px_20px_rgba(25,28,28,0.02)]">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-900">
                                            <LucideFolderTree className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold">Estructura organizacional</h3>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                                        <div>
                                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                                                Área
                                            </label>
                                            <select
                                                name="department"
                                                value={isEditing ? (formData.department || '') : (user?.department || '')}
                                                disabled={!isEditing || isLocked}
                                                onChange={handleInputChange}
                                                className={`w-full px-3 py-2 text-sm bg-muted/40 rounded-lg text-foreground ${!isEditing || isLocked ? 'cursor-not-allowed' : ''}`}
                                            >
                                                <option value="">Selecciona un área</option>
                                                {departaments.map((dep) => (
                                                    <option key={dep.id} value={dep.name}>
                                                        {dep.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                                                Cargo
                                            </label>
                                            <input
                                                type="text"
                                                name="cargo"
                                                value={isEditing ? (formData.cargo || '') : (user?.cargo || '')}
                                                disabled={!isEditing || isLocked}
                                                onChange={handleInputChange}
                                                className={`w-full px-3 py-2 text-sm bg-muted/40 rounded-lg text-foreground ${!isEditing || isLocked ? 'cursor-not-allowed' : ''}`}
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                                                Jefe inmediato
                                            </label>
                                            {isEditing ? (
                                                <select
                                                    name="immediateBoss"
                                                    value={formData.immediateBoss || ""}
                                                    disabled={!isEditing || isLocked}
                                                    onChange={handleInputChange}
                                                    className={`w-full px-3 py-2 text-sm bg-muted/40 rounded-lg text-foreground ${!isEditing || isLocked ? 'cursor-not-allowed' : ''}`}
                                                >
                                                    <option value="">Selecciona un líder</option>
                                                    {leaders.map((leader) => (
                                                        <option key={leader} value={leader}>
                                                            {leader}
                                                        </option>
                                                    ))}
                                                </select>) : (
                                                <div className={`w-full px-3 py-2 text-sm bg-muted/40 rounded-lg text-foreground ${!isEditing || isLocked ? 'cursor-not-allowed' : ''}`}>
                                                    {user?.immediateBoss || 'No asignado'}
                                                </div>
                                            )}
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                                                Dónde labora
                                            </label>
                                            <input
                                                type="text"
                                                value={companyLabel}
                                                disabled
                                                className="w-full px-3 py-2 text-sm bg-muted/40 rounded-lg text-foreground cursor-not-allowed"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-3xl p-8 shadow-[0_20px_20px_rgba(25,28,28,0.02)]">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-900">
                                            <AtSign className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold">Contacto</h3>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                                        <div className='md:col-span-2'>
                                            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                                                Correo electrónico
                                            </label>
                                            <input
                                                type="email"
                                                value={user?.email || ''}
                                                disabled
                                                className="w-full px-3 py-2 text-sm bg-muted/40 rounded-lg text-foreground cursor-not-allowed"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-3xl p-8 shadow-[0_20px_20px_rgba(25,28,28,0.02)]">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-900">
                                            <PenLine className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold">Firma manuscrita</h3>
                                            <p className="text-xs text-muted-foreground">Visualiza tu firma registrada y accede rápidamente a su gestión.</p>
                                        </div>
                                    </div>
                                    <div className="mt-2">
                                        <div className="inline-block border border-border bg-white rounded-md px-3 py-2 min-h-18 min-w-40 items-center justify-center">
                                            {user?.signatureUrl || signature ? (
                                                <img
                                                    src={signature || user?.signatureUrl || ''}
                                                    alt="Firma registrada"
                                                    className="max-h-16 object-contain"
                                                />
                                            ) : (
                                                <span className="text-xs text-muted-foreground">Aún no has registrado tu firma.</span>
                                            )}
                                        </div>

                                        {isEditing && !isLocked && (
                                            <div className="space-y-3">
                                                <p className="text-xs text-muted-foreground">
                                                    Puedes dibujar tu firma o adjuntar una imagen. Los cambios se guardan al pulsar
                                                    {" "}
                                                    <span className="font-semibold">"Guardar Cambios"</span>.
                                                </p>

                                                {!signature && (
                                                    <>
                                                        <SignaturePadCanvas
                                                            height={160}
                                                            disabled={false}
                                                            onSave={(sig) => {
                                                                setSignature(sig)
                                                            }}
                                                        />

                                                        <div className="space-y-1">
                                                            <p className="text-xs text-muted-foreground">O bien adjunta una imagen de tu firma (PNG, JPG, etc.):</p>
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                onChange={handleSignatureUpload}
                                                                className="block w-full text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-border file:text-xs file:font-semibold file:bg-muted file:text-foreground hover:file:bg-muted/80"
                                                            />
                                                        </div>
                                                    </>
                                                )}

                                                {signature && (
                                                    <Button
                                                        type="button"
                                                        onClick={() => {
                                                            setSignature(null)
                                                        }}
                                                        className="text-xs"
                                                    >
                                                        Cambiar firma
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-8">
                                <div className="bg-[#1b3022] text-white rounded-3xl p-8 overflow-hidden relative">

                                    <div className="absolute -right-10 -top-10 w-40 h-40 bg-emerald-800/30 rounded-full blur-3xl"></div>
                                    <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-emerald-950/50 rounded-full blur-3xl"></div>
                                    <h3 className="text-xl font-bold mb-4 relative z-10">Seguridad de la Cuenta</h3>

                                    {isEmailPasswordUser ? (
                                        <>
                                            <p className="text-[#c8e3d2] text-sm mb-6 relative z-10">
                                                Mantén tu cuenta protegida cambiando tu contraseña periódicamente.
                                            </p>

                                            <div className="space-y-4 relative z-10">
                                                <div>
                                                    <label className="text-xs font-semibold text-emerald-50 mb-2 flex items-center gap-2">
                                                        <Lock className="w-4 h-4" />
                                                        Contraseña actual
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type={showPwd.current ? 'text' : 'password'}
                                                            name="current"
                                                            value={passwordForm.current}
                                                            onChange={handlePasswordFieldChange}
                                                            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm text-white placeholder:text-emerald-100/60 pr-10 focus:outline-none focus:ring-2 focus:ring-emerald-400/80"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowPwd(prev => ({ ...prev, current: !prev.current }))}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-100"
                                                            aria-label="Mostrar/ocultar contraseña actual"
                                                        >
                                                            {showPwd.current ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                        </button>
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="text-xs font-semibold text-emerald-50 mb-2 flex items-center gap-2">
                                                        <Lock className="w-4 h-4" />
                                                        Nueva contraseña
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type={showPwd.next ? 'text' : 'password'}
                                                            name="next"
                                                            value={passwordForm.next}
                                                            onChange={handlePasswordFieldChange}
                                                            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm text-white placeholder:text-emerald-100/60 pr-10 focus:outline-none focus:ring-2 focus:ring-emerald-400/80"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowPwd(prev => ({ ...prev, next: !prev.next }))}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-100"
                                                            aria-label="Mostrar/ocultar nueva contraseña"
                                                        >
                                                            {showPwd.next ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                        </button>
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="text-xs font-semibold text-emerald-50 mb-2 flex items-center gap-2">
                                                        <Lock className="w-4 h-4" />
                                                        Confirmar nueva contraseña
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type={showPwd.confirm ? 'text' : 'password'}
                                                            name="confirm"
                                                            value={passwordForm.confirm}
                                                            onChange={handlePasswordFieldChange}
                                                            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm text-white placeholder:text-emerald-100/60 pr-10 focus:outline-none focus:ring-2 focus:ring-emerald-400/80"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowPwd(prev => ({ ...prev, confirm: !prev.confirm }))}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-100"
                                                            aria-label="Mostrar/ocultar confirmación"
                                                        >
                                                            {showPwd.confirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                        </button>
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={handleChangePassword}
                                                    className="mt-2 w-full bg-white text-emerald-900 font-semibold rounded-xl py-3 flex items-center justify-center gap-2 hover:bg-emerald-50 transition-all"
                                                >
                                                    <KeyRound className="w-5 h-5" />
                                                    Cambiar contraseña
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-[#c8e3d2] text-sm relative z-10">
                                            Tu contraseña se administra desde tu cuenta corporativa. Si necesitas cambiarla,
                                            hazlo directamente en el portal de tu organización.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className='md:col-span-3'>

                                {isEditing && (
                                    <div className="flex justify-center items-center gap-4 pt-6">
                                        <button
                                            onClick={handleSave}
                                            disabled={isLocked || savingProfile}
                                            title={isLocked ? 'No puedes guardar cambios en esta base' : undefined}
                                            className={`flex-1 px-8 py-2.5 font-medium rounded-full transition-all duration-300 flex items-center justify-center gap-2 ${isLocked ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary-light hover:shadow-lg hover:-translate-y-0.5'}`}
                                        >
                                            {savingProfile ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Guardando cambios...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="w-5 h-5" />
                                                    Guardar Cambios
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsEditing(false)
                                                setFormData({
                                                    name: user?.name || "",
                                                    department: user?.department || "",
                                                    identify: user?.identify || "",
                                                    immediateBoss: user?.immediateBoss || "",
                                                    cargo: user?.cargo || "",
                                                })
                                            }}
                                            className="flex-1 px-8 py-2.5 bg-muted hover:bg-muted-light text-foreground font-medium rounded-full transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                )}

                            </div>
                        </div>
                    </div>
                </div>


            </div>
        </Layout >
    )
}

export default ConfigurationProfilePage