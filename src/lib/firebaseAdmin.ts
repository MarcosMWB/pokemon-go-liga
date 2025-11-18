// Usar SOMENTE do lado do servidor (route handlers, scripts).
import { getApps, initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let _db: FirebaseFirestore.Firestore | null = null;

export function getAdminDb(): FirebaseFirestore.Firestore {
  if (_db) return _db;

  // Inicialização segura: usa ADC (GOOGLE_APPLICATION_CREDENTIALS)
  // ou as variáveis explícitas do service account.
  if (!getApps().length) {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
    } else {
      const projectId = process.env.FIREBASE_PROJECT_ID!;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
      const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    }
  }

  _db = getFirestore();
  return _db;
}
