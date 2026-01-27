import { get, push, ref, remove, set, update, type Database } from "firebase/database";
import { getDatabaseForUrl } from "@/services/firebase";
import { getAllAvailableDatabases, type RecintoKey } from "@/lib/firebase/databaseResolver";
import type { Departament } from "@/types/departament";


/**
 * Obtiene todos los departamentos de la base de datos actual.
 * Cada entrada incluye su `id` (clave en RTDB) y metadatos almacenados.
 */
export async function getDepartaments(database: Database): Promise<Departament[]> {

    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const departamentsRef = ref(database, "departaments");
    const snapshot = await get(departamentsRef);
    const values = snapshot.val() as Record<string, { name: string; createdAt: string }> | null;

    if (!values) return [];

    const departaments: Departament[] = Object.keys(values).map((key) => ({
        id: key,
        name: values[key].name,
        createdAt: values[key].createdAt,
    }));
    return departaments;
}

/**
 * Crea un nuevo departamento en la base de datos actual.
 *
 * @param database Instancia de Realtime Database
 * @param name Nombre del departamento
 */
export async function createDepartament(database: Database, name: string): Promise<Departament> {
    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const cleanName = name.trim();
    if (!cleanName) {
        throw new Error("El nombre del departamento es obligatorio");
    }

    const departamentsRef = ref(database, "departaments");
    const newRef = push(departamentsRef);
    const id = newRef.key;

    if (!id) {
        throw new Error("No fue posible generar el id del departamento");
    }

    const nowIso = new Date().toISOString();
    const departament: Departament = {
        id,
        name: cleanName,
        createdAt: nowIso,
    };

    await set(newRef, { name: departament.name, createdAt: departament.createdAt });
    return departament;
}

/**
 * Actualiza el nombre de un departamento existente.
 *
 * @param database Instancia de Realtime Database
 * @param id Clave del departamento en RTDB
 * @param name Nuevo nombre del departamento
 */
export async function updateDepartament(database: Database, id: string, name: string): Promise<void> {
    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const cleanName = name.trim();
    if (!cleanName) {
        throw new Error("El nombre del departamento es obligatorio");
    }

    const departamentRef = ref(database, `departaments/${id}`);
    await update(departamentRef, { name: cleanName });
}

/**
 * Elimina un departamento existente por su id.
 */
export async function deleteDepartament(database: Database, id: string): Promise<void> {
    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const departamentRef = ref(database, `departaments/${id}`);
    await remove(departamentRef);
}

/**
 * Obtiene SOLO los nombres de departamentos a través de todas las bases disponibles.
 * Deduplica case-insensitive y retorna ordenado alfabéticamente.
 */
export async function getDepartamentsAllDatabases(
    recintos?: Array<{ url: string; key: RecintoKey }>
): Promise<string[]> {
    const targets: Array<{ url: string; key: RecintoKey }> = recintos
        ? recintos
        : getAllAvailableDatabases().map((d) => ({ url: d.url, key: d.key }));

    const tasks = targets.map(async (t) => {
        const db = getDatabaseForUrl(t.url);
        if (!db) return [] as string[];
        return getDepartmentNames(db);
    });

    const parts = await Promise.all(tasks);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const arr of parts) {
        for (const name of arr) {
            const normalized = name.toLowerCase();
            if (!seen.has(normalized)) {
                seen.add(normalized);
                result.push(name);
            }
        }
    }
    return result.sort((a, b) => a.localeCompare(b));
}

/**
 * Obtiene solo los nombres de departamentos de una base de datos.
 * Retorna nombres únicos, ordenados alfabéticamente.
 */
export async function getDepartmentNames(database: Database): Promise<string[]> {
    if (!database) {
        throw new Error("La base de datos no está disponible");
    }
    const snap = await get(ref(database, "departaments"));
    const values = snap.val() as Record<string, { name?: string } | null> | null;
    if (!values) return [];

    // Normaliza espacios duplicados y deduplica case-insensitive
    const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ')
    const seen = new Set<string>();
    const names: string[] = [];
    for (const key of Object.keys(values)) {
        const raw = values[key]?.name ?? "";
        const name = normalizeName(String(raw));
        if (!name) continue;
        const normalizedLower = name.toLowerCase();
        if (!seen.has(normalizedLower)) {
            seen.add(normalizedLower);
            names.push(name);
        }
    }
    return names.sort((a, b) => a.localeCompare(b));
}

/**
 * Obtiene nombres únicos de departamentos a través de todas las bases disponibles.
 * Si se proporcionan recintos, usa solo esos; si no, descubre todas.
 */
export async function getDepartmentNamesAllDatabases(
    recintos?: Array<{ url: string; key: RecintoKey }>
): Promise<string[]> {
    const targets: Array<{ url: string; key: RecintoKey }> = recintos
        ? recintos
        : getAllAvailableDatabases().map((d) => ({ url: d.url, key: d.key }));

    const tasks = targets.map(async (t) => {
        const db = getDatabaseForUrl(t.url);
        if (!db) return [] as string[];
        return getDepartmentNames(db);
    });

    const parts = await Promise.all(tasks);
    const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ')
    const seen = new Set<string>();
    const result: string[] = [];
    for (const arr of parts) {
        for (const name of arr) {
            const clean = normalizeName(name)
            if (!clean) continue
            const normalizedLower = clean.toLowerCase();
            if (!seen.has(normalizedLower)) {
                seen.add(normalizedLower);
                result.push(clean);
            }
        }
    }
    return result.sort((a, b) => a.localeCompare(b));
}