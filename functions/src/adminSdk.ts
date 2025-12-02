// Centraliza o Admin SDK e evita “The default Firebase app does not exist”
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp(); // em CF/Emulador pega as creds padrão
}

export { admin };
export const db = admin.firestore();
export const auth = admin.auth();
// Atalhos para FieldValue (serverTimestamp/delete etc.)
export const FieldValue = admin.firestore.FieldValue;
