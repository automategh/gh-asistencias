import { get, ref, type Database } from "firebase/database";


export async function getDepartaments(database: Database) {

    if (!database) {
        throw new Error("La base de datos no está disponible");
    }

    const departamentsRef = ref(database, "departaments");
    const snapshot = await get(departamentsRef);
    const values = snapshot.val();

    // Convertir el objeto de departamentos en un array de departamentos pero añadiendo el id en su propio objeto
    const departaments = Object.keys(values || {}).map((key) => ({
        id: key,
        ...values[key],
    }));
    return departaments;
}