import { resolveDatabaseByEmail } from "@/lib/firebase/databaseResolver";
import { loginWithMicrosoft, logout } from "@/services/auth/auth.service";
import { auth, getDatabaseForUrl } from "@/services/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";
import { get, ref } from "firebase/database";
import React, { createContext, useContext, useEffect, useState } from "react";


interface AuthContextType {
    user: User | null;
    loading: boolean;
    role: string | null;
    loginWithMicrosoft: () => Promise<void>;
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
    const [loading, setLoading] = useState(true);
    const [role, setRole] = useState<string | null>(null);
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        if (!auth) {
            // Si auth no está definido, no hacemos nada y evitamos errores.
            setLoading(false);
            return;
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
                    setRole("User");
                    return;
                }

                // siguimos con la logica para obtener el rol del usuario
                const userRef = ref(db, `users/${uid}`);
                const snapshot = await get(userRef);

                if (snapshot.exists()) {
                    const data = snapshot.val();
                    setRole(data.role ?? "User");
                } else {
                    // Usuario autenticado pero sin registro en esta BD
                    // Asignar rol por defecto "User" para permitir acceso básico
                    console.warn(`Usuario ${uid} no encontrado en la base de datos, asignando rol por defecto "User"`);
                    setRole("User");
                }
            } catch (error) {
                console.error("Error al obtener el rol del usuario:", error);
                setRole("User");
            }
        };

        // Escuchar cambios en el estado de autenticación
        const unsusbscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setLoading(false);

            if (firebaseUser) {
                fetchUserRole(firebaseUser.uid, firebaseUser.email); // Llama la función async sin await
            } else {
                setRole(null);
            }
        });

        return () => unsusbscribe();
    }, [])


    const handleLoginWithMicrosoft = async () => {
        setLoading(true);
        try {
            await loginWithMicrosoft();
            // onAuthStateChanged actualizará 'user' y el efecto anterior hará la redirección.
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
        role,
        loginWithMicrosoft: handleLoginWithMicrosoft,
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