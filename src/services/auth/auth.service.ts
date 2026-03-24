import { createUserWithEmailAndPassword, OAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from "firebase/auth";
import { auth, DATABASE_CCCI_URL, DATABASE_CCCR_URL, DATABASE_CEVP_URL, DEFAULT_DATABASE_URL, getDatabaseForUrl } from "../firebase";
import { getDatabaseByRecinto, resolveDatabaseByEmail, type RecintoKey } from "@/lib/firebase/databaseResolver";
import { get, ref, set } from "firebase/database";
import type { RegisterFormData } from "@/types/user";

interface UserRecord {
    uid: string;
    name: string;
    email: string;
    role: string;
    immediateBoss?: string | null;
    identify?: string | null;
    department?: string | null;
    cargo?: string | null;
    active: boolean;
    recint?: string | null;
    companyName?: string | null;
    createdAt: string;
    lastLogin: string;
}

// Configuración del proveedor de OAuth para Microsoft
const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({
    tenant: 'common', // Acepta cualquier tipo de cuenta de Microsoft (personal, trabajo, escuela)
    prompt: 'select_account'
});

microsoftProvider.addScope('User.Read'); // Permiso para leer el perfil del usuario

const ALLOWED_DOMAINS = [
    "grupoheroica.com",
    "valledelpacifico.co",
    "cccartagena.com",
    "costaricacc.com"
];


/**
 * Determina si el dominio de un correo electrónico está permitido.
 *
 * - La verificación es insensible a mayúsculas/minúsculas.
 * - Si el correo es `null` o no contiene un dominio válido, devuelve `false`.
 *
 * @param email Correo electrónico a validar (por ejemplo: "usuario@grupoheroica.com").
 * @returns `true` cuando el dominio del correo está en la lista permitida; `false` en caso contrario.
 */
function isDomainAllowed(email: string | null): boolean {
    if (!email) return false;
    const domain = email.split("@")[1]?.toLowerCase();
    return ALLOWED_DOMAINS.includes(domain);
}


/** Inicia sesión con Microsoft utilizando Firebase Authentication.
 * Si el usuario es nuevo, crea una entrada en la base de datos en Realtime Database.
 * @returns Objeto con la información del usuario autenticado y el token de acceso.
 */
export const loginWithMicrosoft = async () => {
    if (!auth) throw new Error('Firebase Auth no inicializado');
    try {

        const result = await signInWithPopup(auth, microsoftProvider);
        const userEmail = result.user.email;


        if (!isDomainAllowed(userEmail)) {
            await signOut(auth);
            throw new Error('Dominio de correo no permitido.');
        }

        // Informacion del usuario autenticado
        const user = result.user;

        // Resolver la base de datos según el email del usuario
        const { databaseUrl, recinto } = resolveDatabaseByEmail(user.email ?? null);
        const database = getDatabaseForUrl(databaseUrl);

        try {
            const selectedDatabase = { url: databaseUrl, key: recinto };
            localStorage.setItem("selectedDatabase", JSON.stringify(selectedDatabase));
        } catch {
            console.warn("No se pudo guardar selectedDatabase en LocalStorage.");
        }

        console.log(`🔵 Usuario ${user.email} asignado a BD de ${recinto}: ${databaseUrl}`);

        if (!database) {
            throw new Error('Realtime Database no inicializado');
        }

        const userRef = ref(database, `users/${user.uid}`);

        // Verificar si ya existe el usuario en esta BD
        const snapshot = await get(userRef);
        const value = snapshot.val();


        if (!snapshot.exists()) {
            // Usuario nuevo en esta BD - crear registro
            console.log(`✅ Creando nuevo usuario ${user.email} en BD de ${recinto}`);
            await set(userRef, {
                uid: user.uid,
                name: user.displayName,
                email: user.email,
                role: "User", // rol por defecto
                active: true,
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString(),
            });
        } else {

            if (!value.active) {
                await signOut(auth);
                throw new Error('Usuario inactivo. Contacte al administrador.');
            }

            // Usuario existente - actualizar último login
            console.log(`🔄 Actualizando último login de ${user.email} en BD de ${recinto}`);
            const existingData = snapshot.val();
            await set(userRef, {
                ...existingData,
                lastLogin: new Date().toISOString(),
                // Actualizar datos que puedan haber cambiado
                name: user.displayName || existingData.name,
            });
        }

        return { user };
    } catch (error) {
        console.error("Error durante la autenticación con Microsoft:", error);
        throw error;
    }
}

/**
 * Registra un nuevo usuario con email y contraseña.
 * 
 * @param data Datos del formulario de registro.
 * @returns Objeto con la información del usuario registrado.
 * @throws Error si el correo ya está registrado o si ocurre un problema durante el registro.
 */
export const registerWithEmailPassword = async (data: RegisterFormData) => {
    if (!auth) throw new Error('Firebase Auth no inicializado');

    try {

        // Validar que el email no exista en ninguna BD
        const existingUser = await findUserByEmailInAllDatabases(data.email);

        if (existingUser) {
            throw new Error("Este correo electrónico ya ha sido registrado.");
        }

        // Crear usuario en Firebase Auth
        const result = await createUserWithEmailAndPassword(auth, data.email, data.password);
        const user = result.user;

        //actualizamos el perfil del usuario con el nombre
        await updateProfile(user, { displayName: data.name });

        // Obtener la base de datos según el recinto seleccionado
        const db = getDatabaseByRecinto(data.recint as RecintoKey);

        if (!db) {
            throw new Error('Base de datos no encontrada para el recinto seleccionado.');
        }

        const userRef = ref(db, `users/${user.uid}`);

        // Crear el registro del usuario en la base de datos correspondiente
        const newUserRecord: UserRecord = {
            uid: user.uid,
            name: data.name,
            email: data.email,
            role: "User", // rol por defecto
            active: false, // el usuario debe ser activado por un admin
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            identify: data.identify,
            department: data.department,
            cargo: data.cargo,
            recint: data.recint,
            immediateBoss: data.leader,
            companyName: data.worksAtHeroica ? null : (data.companyName || null),
        };

        await set(userRef, newUserRecord);
        return { user };
    } catch (error) {
        console.error("Error durante el registro de usuario:", error);
        throw error;
    }
}

type LoginProps = {
    email: string;
    password: string;
}

export const loginWithEmailPassword = async (props: LoginProps) => {
    if (!auth) throw new Error("Firebase auth no está inicializado");

    try {
        // Autenticar usuario en Firebase Auth
        const result = await signInWithEmailAndPassword(auth, props.email, props.password);
        const user = result.user;

        // Buscar el usuario en todas las BDs para obtener su recinto
        const userFound = await findUserByEmailInAllDatabases(user.email ?? "");

        if (!userFound) {
            await logout();
            throw new Error('Usuario no encontrado en la base de datos.');
        }

        const { user: dbUser, databaseUrl } = userFound;

        // Validar si el usuario está activo
        if (dbUser.active == false) {
            await logout();
            throw new Error('Usuario inactivo. Contacte al administrador para la asignación de recinto.');
        }

        // Validar si tiene recinto asignado
        if (!dbUser.recint) {
            await logout();
            throw new Error('Usuario pendiente de asignación de recinto. Contacte al administrador.');
        }

        const database = getDatabaseForUrl(databaseUrl);

        if (!database) {
            throw new Error('Realtime Database no inicializado');
        }

        const userRef = ref(database, `users/${user.uid}`);

        await set(userRef, {
            ...dbUser,
            lastLogin: new Date().toISOString(),
        });

        localStorage.setItem("selectedDatabase", JSON.stringify({ url: databaseUrl, key: dbUser.recint as RecintoKey }));

        return {
            user: user,
            role: dbUser.role,
            recinto: dbUser.recint as RecintoKey,
            active: dbUser.active,
            databaseUrl,
        };
    } catch (error) {
        console.error("Error durante el login con email y contraseña:", error);
        throw error;
    }
}

/**
 * Busca un usuario por email en todas las bases de datos.
 * @param email Correo electrónico del usuario.
 * @returns El usuario encontrado y la URL de la BD donde se encuentra, o null si no existe.
 */
async function findUserByEmailInAllDatabases(email: string): Promise<{ user: UserRecord; databaseUrl: string } | null> {
    const allDatabases = [
        DEFAULT_DATABASE_URL,
        DATABASE_CCCI_URL,
        DATABASE_CCCR_URL,
        DATABASE_CEVP_URL,
    ];

    for (const databaseUrl of allDatabases) {
        const database = getDatabaseForUrl(databaseUrl);
        if (!database) continue;

        const usersRef = ref(database, 'users');
        const snapshot = await get(usersRef);

        if (snapshot.exists()) {
            const users = snapshot.val();
            for (const userId in users) {
                const user = users[userId] as UserRecord;
                if (user.email?.toLowerCase() === email.toLowerCase()) {
                    return { user, databaseUrl };
                }
            }
        }
    }

    return null;
}


export const logout = async () => {
    if (!auth) throw new Error('Firebase Auth no inicializado');
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error durante el logout:", error);
        throw error;
    }
}
