import { OAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { auth, getDatabaseForUrl } from "../firebase";
import { resolveDatabaseByEmail } from "@/lib/firebase/databaseResolver";
import { get, ref, set } from "firebase/database";


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
