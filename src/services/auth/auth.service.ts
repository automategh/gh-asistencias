import { OAuthProvider, type Auth, type OAuthCredential, type User, signInWithEmailAndPassword, signInWithPopup, signOut, getRedirectResult, signInWithRedirect } from "firebase/auth";
import { auth, DATABASE_CCCI_URL, DATABASE_CCCR_URL, DATABASE_CEVP_URL, DEFAULT_DATABASE_URL, functions, getDatabaseForUrl } from "../firebase";
import { getDatabaseUrlByRecinto, resolveDatabaseByEmail, type RecintoKey } from "@/lib/firebase/databaseResolver";
import { ensureDepartamentExists } from "@/services/departaments/departments.service";
import { validatePasswordPolicy } from "@/lib/password-policy";
import { get, ref, set } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import type { RegisterFormData } from "@/types/user";

interface UserRecord {
    uid: string;
    name: string;
    email: string;
    role: string;
    roleId?: string;
    immediateBoss?: string | null;
    identify?: string | null;
    department?: string | null;
    cargo?: string | null;
    photoUrl?: string | null;
    active: boolean;
    recint?: string | null;
    companyName?: string | null;
    createdAt: string;
    lastLogin: string;
}

interface UserLookupResult {
    readonly user: UserRecord;
    readonly databaseUrl: string;
    readonly matchedBy: "uid" | "email";
}

interface MicrosoftGraphProfile {
    readonly cargo: string | null;
    readonly department: string | null;
    readonly photoUrl: string | null;
}

interface GetMicrosoftUserProfileResponse {
    readonly cargo: string | null;
    readonly department: string | null;
    readonly photoUrl: string | null;
}

interface GetMicrosoftUserProfileRequest {
    readonly accessToken: string;
}

interface RegisterUserRequest {
    readonly name: string;
    readonly email: string;
    readonly password: string;
    readonly identify: string;
    readonly department: string;
    readonly cargo: string;
    readonly recint: string;
    readonly leader: string;
    readonly worksAtHeroica: boolean;
    readonly companyName: string;
}

interface RegisterUserResponse {
    readonly uid: string;
    readonly databaseUrl: string;
    readonly recinto: string;
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


async function getMicrosoftGraphProfileFromFunction(accessToken: string | null): Promise<MicrosoftGraphProfile> {
    if (!functions) {
        return {
            cargo: null,
            department: null,
            photoUrl: null,
        };
    }

    if (!accessToken || accessToken.trim().length === 0) {
        return {
            cargo: null,
            department: null,
            photoUrl: null,
        };
    }

    try {
        const callable = httpsCallable<GetMicrosoftUserProfileRequest, GetMicrosoftUserProfileResponse>(
            functions,
            "getMicrosoftUserProfile",
        );
        const result = await callable({ accessToken });
        return {
            cargo: result.data.cargo,
            department: result.data.department,
            photoUrl: result.data.photoUrl,
        };
    } catch (error) {
        console.warn("No se pudo obtener el perfil de Microsoft desde Cloud Functions:", error);
        return {
            cargo: null,
            department: null,
            photoUrl: null,
        };
    }
}

function getRequiredAuth(): Auth {
    if (!auth) {
        throw new Error('Firebase Auth no inicializado');
    }

    return auth;
}

async function syncMicrosoftUserInDatabase(options: {
    readonly user: User;
    readonly photoUrl: string | null;
    readonly graphProfile: MicrosoftGraphProfile;
}): Promise<void> {
    const { user, photoUrl, graphProfile } = options;
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

    if (graphProfile.department) {
        await ensureDepartamentExists(database, graphProfile.department);
    }

    const userRef = ref(database, `users/${user.uid}`);
    const snapshot = await get(userRef);
    const nowIso = new Date().toISOString();

    if (!snapshot.exists()) {
        console.log(`✅ Creando nuevo usuario ${user.email} en BD de ${recinto}`);
        await set(userRef, {
            uid: user.uid,
            name: user.displayName,
            email: user.email,
            role: "User",
            roleId: "user",
            active: true,
            createdAt: nowIso,
            lastLogin: nowIso,
            photoUrl: photoUrl ?? null,
            cargo: graphProfile.cargo,
            department: graphProfile.department,
        });
        return;
    }

    const existingData = snapshot.val() as UserRecord;
    if (!existingData.active) {
        if (auth) {
            await signOut(auth);
        }
        throw new Error('Usuario inactivo. Contacte al administrador.');
    }

    console.log(`🔄 Actualizando último login de ${user.email} en BD de ${recinto}`);
    await set(userRef, {
        ...existingData,
        lastLogin: nowIso,
        name: user.displayName || existingData.name,
        photoUrl: photoUrl ?? existingData.photoUrl ?? null,
        cargo: existingData.cargo ?? graphProfile.cargo,
        department: existingData.department ?? graphProfile.department,
    });
}


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
 * Además intenta obtener la foto de perfil desde Microsoft Graph y la devuelve
 * como data URL (no se almacena en el perfil de Firebase para evitar límites de tamaño).
 * @returns Objeto con la información del usuario autenticado y, si existe, la foto de perfil.
 */
export const loginWithMicrosoft = async (): Promise<{ user: User; photoUrl: string | null }> => {
    const firebaseAuth = getRequiredAuth();
    try {

        const result = await signInWithPopup(firebaseAuth, microsoftProvider);
        const userEmail = result.user.email;


        if (!isDomainAllowed(userEmail)) {
            await signOut(firebaseAuth);
            throw new Error('Dominio de correo no permitido.');
        }

        // Información del usuario autenticado
        const user = result.user;

        const credential = OAuthProvider.credentialFromResult(result) as OAuthCredential | null;
        const accessToken = credential?.accessToken ?? null;

        const resolvedGraphProfile = await getMicrosoftGraphProfileFromFunction(accessToken);
        const resolvedPhotoUrl = resolvedGraphProfile.photoUrl;

        await syncMicrosoftUserInDatabase({
            user,
            photoUrl: resolvedPhotoUrl,
            graphProfile: resolvedGraphProfile,
        });

        return { user, photoUrl: resolvedPhotoUrl };
    } catch (error) {
        console.error("Error durante la autenticación con Microsoft:", error);

        // Si el popup está bloqueado o estamos en un entorno móvil, usar redirect como fallback.
        try {
            const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
            const isMobile = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
            const errCode = (error && (error as { code?: string }).code) || '';

            if (isMobile || errCode === 'auth/popup-blocked' || errCode === 'auth/cancelled-popup-request' || errCode === 'auth/operation-not-supported-in-this-environment') {
                await signInWithRedirect(firebaseAuth, microsoftProvider);
                // la página se redirigirá y no se llegará a este punto normalmente
                return Promise.resolve({ user: firebaseAuth.currentUser as User, photoUrl: null });
            }
        } catch (redirErr) {
            console.error('Error al intentar signInWithRedirect:', redirErr);
        }

        throw error;
    }
}

/**
 * Procesa el resultado de un signInWithRedirect si existe.
 * Devuelve el usuario y la foto (si fue posible obtenerla), o null si no hay resultado.
 */
export const processMicrosoftRedirectResult = async (): Promise<{ user: User; photoUrl: string | null } | null> => {
    if (!auth) return null;
    const firebaseAuth = getRequiredAuth();
    try {
        const result = await getRedirectResult(firebaseAuth);
        if (!result || !result.user) return null;

        const user = result.user;

        const credential = OAuthProvider.credentialFromResult(result) as OAuthCredential | null;
        const accessToken = credential?.accessToken ?? null;

        const resolvedGraphProfile = await getMicrosoftGraphProfileFromFunction(accessToken);
        const resolvedPhotoUrl = resolvedGraphProfile.photoUrl;

        await syncMicrosoftUserInDatabase({
            user,
            photoUrl: resolvedPhotoUrl,
            graphProfile: resolvedGraphProfile,
        });

        return { user, photoUrl: resolvedPhotoUrl };
    } catch (err) {
        console.error('Error al procesar redirect result de Microsoft:', err);
        return null;
    }
}

/**
 * Registra un nuevo usuario con email y contraseña.
 *
 * El registro se delega a la cloud function `registerUser`, que usa el Admin SDK
 * para crear el usuario en Firebase Auth sin dejar al cliente autenticado.
 *
 * @param data Datos del formulario de registro.
 * @returns Objeto con la información del usuario registrado.
 * @throws Error si el correo ya está registrado o si ocurre un problema durante el registro.
 */
export const registerWithEmailPassword = async (data: RegisterFormData) => {
    if (!functions) throw new Error('Cloud Functions no está disponible en este entorno de Firebase.');

    const passwordPolicyError = validatePasswordPolicy(data.password)
    if (passwordPolicyError) {
        throw new Error(passwordPolicyError)
    }

    try {
        const callable = httpsCallable<RegisterUserRequest, RegisterUserResponse>(
            functions,
            "registerUser",
        );

        const result = await callable({
            name: data.name,
            email: data.email,
            password: data.password,
            identify: data.identify,
            department: data.department,
            cargo: data.cargo,
            recint: data.recint,
            leader: data.leader,
            worksAtHeroica: data.worksAtHeroica,
            companyName: data.companyName,
        });

        return { uid: result.data.uid, databaseUrl: result.data.databaseUrl, recinto: result.data.recinto };
    } catch (error) {
        console.error("Error durante el registro de usuario:", error);
        const code = (error as { code?: string }).code;
        if (code === "functions/already-exists") {
            throw new Error("El correo ya está registrado.");
        }
        const message = error instanceof Error ? error.message : "Error al crear la cuenta.";
        throw new Error(message);
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
        const userFound = await findUserInAllDatabases({
            uid: user.uid,
            email: user.email ?? "",
        });

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
function resolveUserDatabaseFromRecord(user: UserRecord, currentDatabaseUrl: string): string {
    const recinto = typeof user.recint === "string" ? user.recint.trim().toLowerCase() : "";
    const recintoDatabaseUrl = recinto ? getDatabaseUrlByRecinto(recinto as RecintoKey) : null;
    return recintoDatabaseUrl ?? currentDatabaseUrl;
}

async function findUserInAllDatabases({
    uid,
    email,
}: {
    readonly uid: string;
    readonly email: string;
}): Promise<UserLookupResult | null> {
    const allDatabases = [
        DEFAULT_DATABASE_URL,
        DATABASE_CCCI_URL,
        DATABASE_CCCR_URL,
        DATABASE_CEVP_URL,
    ];

    const matches: UserLookupResult[] = [];

    for (const databaseUrl of allDatabases) {
        const database = getDatabaseForUrl(databaseUrl);
        if (!database) continue;

        const usersRef = ref(database, 'users');
        const snapshot = await get(usersRef);

        if (snapshot.exists()) {
            const users = snapshot.val();
            for (const userId in users) {
                const user = users[userId] as UserRecord;
                const normalizedUserEmail = user.email?.toLowerCase() ?? "";
                const normalizedEmail = email.toLowerCase();
                const matchedByUid = user.uid === uid;
                const matchedByEmail = normalizedUserEmail === normalizedEmail;

                if (!matchedByUid && !matchedByEmail) {
                    continue;
                }

                matches.push({
                    user,
                    databaseUrl,
                    matchedBy: matchedByUid ? "uid" : "email",
                });
            }
        }
    }

    if (matches.length === 0) {
        return null;
    }

    const exactUidMatch = matches.find((match) => {
        return resolveUserDatabaseFromRecord(match.user, match.databaseUrl) === match.databaseUrl
            && match.matchedBy === "uid";
    });
    if (exactUidMatch) {
        return exactUidMatch;
    }

    const exactEmailMatch = matches.find((match) => {
        return resolveUserDatabaseFromRecord(match.user, match.databaseUrl) === match.databaseUrl
            && match.matchedBy === "email";
    });
    if (exactEmailMatch) {
        return exactEmailMatch;
    }

    const uidMatch = matches.find((match) => match.matchedBy === "uid") ?? matches[0];
    return {
        ...uidMatch,
        databaseUrl: resolveUserDatabaseFromRecord(uidMatch.user, uidMatch.databaseUrl),
    };
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
