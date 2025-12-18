
import { DEFAULT_DATABASE_URL } from "@/services/firebase";

export type RecintoKey = "corporativo" | "ccci" | "cccr" | "cevp";

interface DatabaseResolution {
    databaseUrl: string;
    recinto: RecintoKey;
}

const CORPORATE_DOMAIN = "grupoheroica.com";
const CCCR_DOMAIN = "costaricacc.com";
const CCCI_DOMAIN = "cccartagena.com";
const CEVP_DOMAIN = "valledelpacifico.co";

// Nombres de recintos para mapeo (case-insensitive)
const CCCI_RECINTO_NAMES = ["centro de convenciones cartagena de indias", "cartagena", "ccci"];
const CCCR_RECINTO_NAMES = ["centro de convenciones costa rica", "costa rica", "cccr"];
const CEVP_RECINTO_NAMES = ["centro de eventos valle del pacífico", "centro de eventos valle del pacifico", "valle del pacifico", "valle del pacífico", "cevp"];

const corporateUrl = DEFAULT_DATABASE_URL ?? null;
const ccciUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL_CCCI ?? null;
const cccrUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL_CCCR ?? null;
const cevpUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL_CEVP ?? null;

// Log de inicialización para debug
console.log("🔧 Inicializando DatabaseResolver con URLs:", {
    corporateUrl: corporateUrl ? "✅ Configurada" : "❌ No configurada",
    ccciUrl: ccciUrl ? "✅ Configurada" : "❌ No configurada",
    cccrUrl: cccrUrl ? "✅ Configurada" : "❌ No configurada",
    cevpUrl: cevpUrl ? "✅ Configurada" : "❌ No configurada"
});

const fallbackUrl = corporateUrl ?? ccciUrl;

const ensureUrl = (url: string | null, label: string): string => {
    if (url) return url;
    if (fallbackUrl) return fallbackUrl;
    throw new Error(`No se encontró una URL de base de datos configurada para ${label}`);
};

const normaliseDomain = (email?: string | null): string | null => {
    if (!email) return null;
    const [, domain] = email.split("@");
    return domain ? domain.trim().toLowerCase() : null;
};

export const isCorporateUser = (email?: string | null): boolean => {
    const domain = normaliseDomain(email);
    return domain === CORPORATE_DOMAIN;
};

export const resolveDatabaseByEmail = (email?: string | null): DatabaseResolution => {
    const domain = normaliseDomain(email);

    if (!domain) {
        return {
            databaseUrl: ensureUrl(corporateUrl, "Corporativo"),
            recinto: "corporativo",
        };
    }

    if (domain === CORPORATE_DOMAIN) {
        return {
            databaseUrl: ensureUrl(corporateUrl, "Corporativo"),
            recinto: "corporativo",
        };
    }

    if (domain === CCCR_DOMAIN) {
        return {
            databaseUrl: ensureUrl(cccrUrl, "CCCR"),
            recinto: "cccr",
        };
    }

    if (domain === CCCI_DOMAIN) {
        return {
            databaseUrl: ensureUrl(ccciUrl, "CCCI"),
            recinto: "ccci",
        };
    }

    if (domain === CEVP_DOMAIN) {
        return {
            databaseUrl: ensureUrl(cevpUrl, "CEVP"),
            recinto: "cevp",
        };
    }

    // Por defecto, si el dominio no coincide con ninguno conocido, usar corporativo
    return {
        databaseUrl: ensureUrl(corporateUrl, "Corporativo (default)"),
        recinto: "corporativo",
    };
};

export const getAllAvailableDatabases = (): Array<{ key: RecintoKey; name: string; url: string }> => {
    const databases: Array<{ key: RecintoKey; name: string; url: string }> = [];

    // Log para debug
    console.log("📊 Verificando bases de datos disponibles:", {
        corporateUrl,
        ccciUrl,
        cccrUrl,
        cevpUrl
    });

    if (corporateUrl) {
        databases.push({ key: "corporativo", name: "Corporativo", url: corporateUrl });
    }
    if (ccciUrl) {
        databases.push({ key: "ccci", name: "CCCI - Cartagena", url: ccciUrl });
    }
    if (cccrUrl) {
        databases.push({ key: "cccr", name: "CCCR - Costa Rica", url: cccrUrl });
    }
    if (cevpUrl) {
        databases.push({ key: "cevp", name: "CEVP - Valle del Pacífico", url: cevpUrl });
    }

    console.log("✅ Bases de datos encontradas:", databases.length, databases.map(db => db.name).join(", "));

    return databases;
};

/**
 * Resuelve la base de datos correcta según el nombre del recinto.
 * Útil para guardar encuestas en la BD correspondiente al recinto seleccionado.
 * @param recintoName Nombre del recinto (case-insensitive)
 * @returns Objeto con la URL de la base de datos y el código del recinto
 */
export const resolveDatabaseByRecintoName = (recintoName?: string | null): DatabaseResolution => {
    if (!recintoName) {
        return {
            databaseUrl: ensureUrl(corporateUrl, "Corporativo"),
            recinto: "corporativo",
        };
    }

    const normalizedName = recintoName.trim().toLowerCase();

    // Verificar si el nombre coincide con CCCI
    if (CCCI_RECINTO_NAMES.some(name => normalizedName.includes(name))) {
        return {
            databaseUrl: ensureUrl(ccciUrl, "CCCI"),
            recinto: "ccci",
        };
    }

    // Verificar si el nombre coincide con CCCR
    if (CCCR_RECINTO_NAMES.some(name => normalizedName.includes(name))) {
        return {
            databaseUrl: ensureUrl(cccrUrl, "CCCR"),
            recinto: "cccr",
        };
    }

    // Verificar si el nombre coincide con CEVP
    if (CEVP_RECINTO_NAMES.some(name => normalizedName.includes(name))) {
        return {
            databaseUrl: ensureUrl(cevpUrl, "CEVP"),
            recinto: "cevp",
        };
    }

    // Por defecto, usar corporativo
    console.warn(`Recinto "${recintoName}" no reconocido, usando base de datos corporativa`);
    return {
        databaseUrl: ensureUrl(corporateUrl, "Corporativo (default)"),
        recinto: "corporativo",
    };
};

