import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import type { FirebaseApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Configuración de Firebase obtenida de las variables de entorno
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

let app: FirebaseApp | null = null;

try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  // Si ya está inicializada en HMR, ignorar
  console.warn('Firebase init error', e);
}

export const auth = app ? getAuth(app) : null;
export const analytics = app ? getAnalytics(app) : null;

export const DEFAULT_DATABASE_URL = firebaseConfig.databaseURL ?? null;

export const getDatabaseForUrl = (databaseUrl?: string | null) => {
  if (!app) {
    return null;
  }

  if (databaseUrl && databaseUrl !== DEFAULT_DATABASE_URL) {
    return getDatabase(app, databaseUrl);
  }

  return getDatabase(app);
};

export default app;