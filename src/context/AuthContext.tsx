import { resolveDatabaseByEmail } from "@/lib/firebase/databaseResolver";
import { ensureAuthorizationCatalog } from "@/services/authorization/role-permissions.service";
import { loginWithEmailPassword, loginWithMicrosoft, logout, registerWithEmailPassword } from "@/services/auth/auth.service";
import { auth, getDatabaseForUrl } from "@/services/firebase";
import type { PermissionId, RoleId } from "@/types/authorization";
import type { RegisterFormData } from "@/types/user";
import { onAuthStateChanged, type User } from "firebase/auth";
import { get, ref } from "firebase/database";
import React, { createContext, useContext, useEffect, useState } from "react";


interface AuthContextType {
    user: User | null;
    loading: boolean;
    roleId: RoleId | null;
    permissions: readonly PermissionId[];
    hasPermission: (permissionId: PermissionId) => boolean;
    profilePhotoUrl: string | null;
    loginWithMicrosoft: () => Promise<void>;
    loginWithEmailPassword: (email: string, password: string) => Promise<void>;
    registerWithEmailPassword: (data: RegisterFormData) => Promise<void>;
    logout: () => Promise<void>;
}

/** Contexto de autenticación para la aplicación.
 * Proporciona el estado de autenticación del usuario y funciones para iniciar y cerrar sesión.
 * @returns Contexto React para la autenticación de usuarios.
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Proveedor de contexto de autenticación.
 * Envuelve la aplicación y proporciona el estado de autenticación y funciones relacionadas.
 * @param children Componentes hijos que consumirán el contexto de autenticación.
 * @returns Componente React que envuelve a los hijos con el contexto de autenticación.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [loading, setLoading] = useState(false);
    const [roleId, setRoleId] = useState<RoleId | null>(null);
    const [permissions, setPermissions] = useState<PermissionId[]>([]);
    const [user, setUser] = useState<User | null>(null);
    const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!auth) {
            // Si auth no está definido, no hacemos nada y evitamos errores.
            setLoading(false);
            return;
        }

        interface DbUserPayload {
            readonly roleId?: RoleId | null;
            readonly photoUrl?: string | null;
        }

        interface DbRolePayload {
            readonly permissions?: Partial<Record<PermissionId, boolean>> | null;
        }

        const resolveUserRoleState = (data: DbUserPayload | null) => {
            const resolvedRoleId = data?.roleId ?? "user";
            setRoleId(resolvedRoleId);
        }

        const fetchRolePermissions = async (resolvedRoleId: RoleId, email: string | null) => {
            try {
                const { databaseUrl } = resolveDatabaseByEmail(email);
                const db = getDatabaseForUrl(databaseUrl);

                if (!db) {
                    setPermissions([]);
                    return;
                }

                // Asegura que el catalogo base exista en la BD activa antes de resolver permisos del rol.
                await ensureAuthorizationCatalog(db);

                const roleRef = ref(db, `roles/${resolvedRoleId}`);
                const roleSnapshot = await get(roleRef);
                const roleData = roleSnapshot.val() as DbRolePayload | null;
                const rolePermissions = roleData?.permissions ?? null;

                if (!rolePermissions) {
                    setPermissions([]);
                    return;
                }

                const grantedPermissions = Object.entries(rolePermissions)
                    .filter(([, granted]) => granted === true)
                    .map(([permissionId]) => permissionId as PermissionId);

                setPermissions(grantedPermissions);
            } catch (error) {
                console.error("Error al obtener permisos del rol:", error);
                setPermissions([]);
            }
        }

        // Función asyncrónica para obtener el rol
        const fetchUserRole = async (uid: string, email: string | null) => {
            try {
                // Resolver la base de datos segun el email del usuario
                const { databaseUrl } = resolveDatabaseByEmail(email);
                const db = getDatabaseForUrl(databaseUrl);


                // Verficamos si la db existe
                if (!db) {
                    console.error("No se pudo obtener la instancia de base de datos");
                    setRoleId("user");
                    setPermissions([]);
                    return;
                }

                // siguimos con la logica para obtener el rol del usuario
                const userRef = ref(db, `users/${uid}`);
                const snapshot = await get(userRef);

                if (snapshot.exists()) {
                    const data = snapshot.val() as DbUserPayload | null;

                    if (data) {
                        resolveUserRoleState(data);
                        const resolvedRoleId = data.roleId ?? "user";
                        await fetchRolePermissions(resolvedRoleId, email);

                        if (typeof data.photoUrl === "string" && data.photoUrl.trim().length > 0) {
                            setProfilePhotoUrl(data.photoUrl);
                        }
                    } else {
                        resolveUserRoleState(null);
                        await fetchRolePermissions("user", email);
                    }
                } else {
                    // Usuario autenticado pero sin registro en esta BD
                    // Asignar roleId por defecto para permitir acceso básico
                    console.warn(`Usuario ${uid} no encontrado en la base de datos, asignando roleId por defecto "user"`);
                    setRoleId("user");
                    await fetchRolePermissions("user", email);
                }
            } catch (error) {
                console.error("Error al obtener el rol del usuario:", error);
                setRoleId("user");
                setPermissions([]);
            }
        };

        // Escuchar cambios en el estado de autenticación
        const unsusbscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setProfilePhotoUrl(firebaseUser?.photoURL ?? null);
            setLoading(false);

            if (firebaseUser) {
                fetchUserRole(firebaseUser.uid, firebaseUser.email); // Llama la función async sin await
            } else {
                setRoleId(null);
                setPermissions([]);
            }
        });

        return () => unsusbscribe();
    }, [])


    const handleLoginWithMicrosoft = async () => {
        setLoading(true);
        try {
            const result = await loginWithMicrosoft();

            // Guardamos temporalmente la foto de perfil si viene desde Microsoft Graph
            if (result.photoUrl) {
                setProfilePhotoUrl(result.photoUrl);
            } else if (result.user?.photoURL) {
                setProfilePhotoUrl(result.user.photoURL);
            }

            // onAuthStateChanged actualizará 'user' y el efecto anterior sincronizará el resto.
        } finally {
            setLoading(false);
        }
    }

    const handleLoginWithEmailPassword = async (email: string, password: string) => {
        setLoading(true);
        try {
            const result = await loginWithEmailPassword({email, password});

            if (!result.active) {
                await logout();
                throw new Error("Error al obtener datos del usuario.");
            }

            if (!result.recinto || !result.databaseUrl) {
                await logout();
                throw new Error("Usuario sin recinto asignado. Contacte al administrador.");
            }

            localStorage.setItem('selectedDatabase', JSON.stringify({ url: result.databaseUrl, key: result.recinto ?? "" }));

            setUser(result.user);
        } catch (e) {
            console.error("Error login email:", e);
            setUser(null);
            localStorage.removeItem('selectedDatabase');
        } finally {
            setLoading(false);
        }
    }

    const handleRegisterWithEmailPassword = async (data: RegisterFormData) => {
        setLoading(true);
        try {
            await registerWithEmailPassword(data);
            // El usuario debe activar su cuenta y asignar recinto antes de poder loguearse
            setUser(null);
        } finally {
            setLoading(false);
        }
    }

    const handleLogout = async () => {
        setLoading(true);
        try {
            await logout();
            // opcional: redirigir a /login después del logout

        } finally {
            setLoading(false);
        }
    }

    const contextValue: AuthContextType = {
        user,
        loading,
        roleId,
        permissions,
        hasPermission: (permissionId: PermissionId) => permissions.includes(permissionId),
        profilePhotoUrl,
        loginWithMicrosoft: handleLoginWithMicrosoft,
        loginWithEmailPassword: handleLoginWithEmailPassword,
        registerWithEmailPassword: handleRegisterWithEmailPassword,
        logout: handleLogout,
    }

    return (
        <AuthContext.Provider value={contextValue}>
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth debe usarse dentro de AuthProvider");
    }
    return context;
};