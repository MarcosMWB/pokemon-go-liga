import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

admin.initializeApp();
const db = admin.firestore();

export const onResultadoWrite = onDocumentWritten('disputas_ginasio_resultados/{resultadoId}', async (event) => {
  const before = event.data?.before?.data() as any | undefined;
  const after  = event.data?.after?.data()  as any | undefined;
  const base   = after ?? before;
  if (!base) return;

  const disputaId  = (after?.disputa_id ?? before?.disputa_id) as string | undefined;
  const ginasioId  = (after?.ginasio_id ?? before?.ginasio_id) as string | undefined;
  if (!disputaId || !ginasioId) return;

  // Se a disputa já não está em andamento, resolva/oculte alerta e saia
  const disputaSnap = await db.doc(`disputas_ginasio/${disputaId}`).get();
  if (!disputaSnap.exists) return;
  const disputa = disputaSnap.data() as any;
  if (!['batalhando', 'inscricoes'].includes(disputa.status)) {
    await db.doc(`admin_alertas/disputa_${disputaId}_ready`).set(
      { status: 'resolvido', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return;
  }

  // Ainda existe algum resultado pendente nesta disputa?
  const pendenteSnap = await db
    .collection('disputas_ginasio_resultados')
    .where('disputa_id', '==', disputaId)
    .where('status', '==', 'pendente')
    .limit(1)
    .get();

  const alertRef = db.doc(`admin_alertas/disputa_${disputaId}_ready`);

  if (pendenteSnap.empty) {
    // Disputa sem pendências → cria/atualiza alerta "pronta para encerrar"
    const gSnap = await db.doc(`ginasios/${ginasioId}`).get();
    const g     = gSnap.exists ? (gSnap.data() as any) : {};

    await alertRef.set(
      {
        type: 'disputa_pronta_para_encerrar',
        disputa_id: disputaId,
        ginasio_id: ginasioId,
        ginasio_nome: g?.nome || ginasioId,
        liga: g?.liga || g?.liga_nome || '',
        status: 'novo',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    // Voltou a ter pendências → esconder/fechar alerta
    await alertRef.set(
      { status: 'resolvido', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
});
