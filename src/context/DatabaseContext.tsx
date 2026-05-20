import { getAllAvailableDatabases, isCorporateUser, resolveDatabaseByEmail, type RecintoKey } from "@/lib/firebase/databaseResolver";
import type { Database } from "firebase/database";
import { get, ref } from "firebase/database";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useAuth } from "./AuthContext";
import { getDatabaseForUrl } from "@/services/firebase";


interface DatabaseContextValue {
    database: Database | null;
    databaseUrl: string | null;
    recinto: RecintoKey;
    loading: boolean;
    isCorporateUser: boolean;
    availableDatabases: Array<{ key: RecintoKey; name: string; url: string }>;
    databasesForCorporate: string[];
    setSelectedDatabase: (url: string, recinto: RecintoKey) => void;
}

const DatabaseContext = createContext<DatabaseContextValue | undefined>(undefined);

export const DatabaseProvider: React.FC<PropsWithChildren> = ({ children }) => {
    const { user, loading: authLoading } = useAuth();

    const [resolved, setResolved] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const savedSelection = localStorage.getItem('selectedDatabase');
    const initialRecinto: RecintoKey =
        savedSelection && JSON.parse(savedSelection).key
            ? JSON.parse(savedSelection).key as RecintoKey
            : "corporativo";

    const initialUrl: string | null =
        savedSelection && JSON.parse(savedSelection).url
            ? JSON.parse(savedSelection).url
            : null;

    const [recinto, setRecinto] = useState<RecintoKey>(initialRecinto);
    const [databaseUrl, setDatabaseUrl] = useState<string | null>(initialUrl);

    const isCorporate = useMemo(() => isCorporateUser(user?.email), [user?.email]);
    const availableDatabases = useMemo(() => {
        const dbs = getAllAvailableDatabases();
        return dbs;
    }, []);

    const databasesForCorporate = useMemo<string[]>(() => {
        return availableDatabases.map((db) => db.url);
    }, [availableDatabases]);

    useEffect(() => {
        if (authLoading) {
            return;
        }

        let cancelled = false;

        const resolveDatabaseSelection = async (): Promise<void> => {
            try {
                const { databaseUrl: resolvedUrl, recinto: resolvedRecinto } = resolveDatabaseByEmail(user?.email ?? null);

                const savedSelection = localStorage.getItem('selectedDatabase');
                if (savedSelection && user?.uid) {
                    try {
                        const parsed = JSON.parse(savedSelection) as { url?: string; key?: RecintoKey };
                        const savedUrl = typeof parsed.url === 'string' ? parsed.url : null;
                        const savedKey = parsed.key;

                        if (savedUrl && savedKey) {
                            const savedDatabase = getDatabaseForUrl(savedUrl);
                            if (savedDatabase) {
                                const userSnapshot = await get(ref(savedDatabase, `users/${user.uid}`));
                                if (!cancelled && userSnapshot.exists()) {
                                    setDatabaseUrl(savedUrl);
                                    setRecinto(savedKey);
                                    setResolved(true);
                                    return;
                                }
                            }
                        }
                    } catch (error) {
                        console.warn('No fue posible usar la selección de base guardada:', error);
                    }
                }

                if (user?.uid) {
                    for (const candidateDatabase of availableDatabases) {
                        const candidateDb = getDatabaseForUrl(candidateDatabase.url);
                        if (!candidateDb) {
                            continue;
                        }

                        const candidateSnapshot = await get(ref(candidateDb, `users/${user.uid}`));
                        if (!candidateSnapshot.exists()) {
                            continue;
                        }

                        if (!cancelled) {
                            setDatabaseUrl(candidateDatabase.url);
                            setRecinto(candidateDatabase.key);
                            localStorage.setItem('selectedDatabase', JSON.stringify({ url: candidateDatabase.url, key: candidateDatabase.key }));
                            setResolved(true);
                        }
                        return;
                    }
                }

                if (!cancelled) {
                    setDatabaseUrl(resolvedUrl);
                    setRecinto(resolvedRecinto);
                    localStorage.setItem('selectedDatabase', JSON.stringify({ url: resolvedUrl, key: resolvedRecinto }));
                }
            } catch (error) {
                console.error("No fue posible resolver la base de datos del recinto", error);
                if (!cancelled) {
                    setDatabaseUrl(null);
                    setRecinto("corporativo");
                }
            } finally {
                if (!cancelled) {
                    setResolved(true);
                }
            }
        };

        resolveDatabaseSelection().catch(() => {
            if (!cancelled) {
                setDatabaseUrl(null);
                setRecinto("corporativo");
                setResolved(true);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [user?.email, user?.uid, authLoading, isCorporate, availableDatabases]);


     const setSelectedDatabase = (url: string, key: RecintoKey) => {
        setDatabaseUrl(url);
        setRecinto(key);
        localStorage.setItem('selectedDatabase', JSON.stringify({ url, key }));
        setShowModal(false);
    };

    const database = useMemo(() => {
        return getDatabaseForUrl(databaseUrl);
    }, [databaseUrl]);

    const loading = authLoading || !resolved;

    const contextValue = useMemo<DatabaseContextValue>(() => ({
        database,
        databaseUrl,
        recinto,
        loading,
        isCorporateUser: isCorporate,
        availableDatabases,
        databasesForCorporate,
        setSelectedDatabase,
    }), [database, databaseUrl, recinto, loading, isCorporate, availableDatabases, databasesForCorporate]);

    return (
        <DatabaseContext.Provider value={contextValue}>
            {showModal && isCorporate && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
                        <h2 className="text-2xl font-bold text-[#273c2a] mb-4">Seleccionar Base de Datos</h2>
                        <p className="text-sm text-gray-600 mb-2">
                            Como usuario corporativo, puedes acceder a cualquier base de datos. Selecciona la que deseas visualizar:
                        </p>
                        <p className="text-xs text-gray-500 mb-6">
                            ({availableDatabases.length} base{availableDatabases.length !== 1 ? 's' : ''} de datos disponible{availableDatabases.length !== 1 ? 's' : ''})
                        </p>
                        <div className="space-y-3">
                            {availableDatabases.length === 0 ? (
                                <div className="text-center py-4 text-gray-500">
                                    No hay bases de datos configuradas
                                </div>
                            ) : (
                                availableDatabases.map((db) => (
                                    <button
                                        key={db.key}
                                        onClick={() => setSelectedDatabase(db.url, db.key)}
                                        className="w-full px-4 py-3 text-left border border-[#B0B3B2] rounded-lg hover:bg-[#F2B05F]/10 hover:border-[#F2B05F] transition-colors"
                                    >
                                        <span className="font-semibold text-[#273c2a]">{db.name}</span>
                                        <span className="text-xs text-gray-500 block mt-1">{db.key}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
            {children}
        </DatabaseContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useDatabase = (): DatabaseContextValue => {
    const context = useContext(DatabaseContext);
    if (!context) {
        throw new Error("useDatabase must be used within a DatabaseProvider");
    }
    return context;
};
