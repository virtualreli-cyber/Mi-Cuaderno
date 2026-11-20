import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

// Public Firebase Web client config for `mi-planner-clases`.
// Security is enforced on the backend via Authentication + RTDB Security Rules.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDE1zrBr-rSZDOwJiRQ-ylRBWJ-FOWJqYE',
  authDomain: 'mi-planner-clases.firebaseapp.com',
  databaseURL: 'https://mi-planner-clases-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'mi-planner-clases',
  storageBucket: 'mi-planner-clases.firebasestorage.app',
  messagingSenderId: '937193939100',
  appId: '1:937193939100:web:ce5d40ce7723832a7e0d59',
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || DEFAULT_FIREBASE_CONFIG.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.authDomain,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || DEFAULT_FIREBASE_CONFIG.databaseURL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.projectId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.appId,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.databaseURL &&
    firebaseConfig.projectId
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(() => {
    // Ignore persistence fallback in restricted contexts
  });
  db = getDatabase(app);
  googleProvider = new GoogleAuthProvider();
}

export { app as firebaseApp, auth as firebaseAuth, db as firebaseDb, googleProvider };
