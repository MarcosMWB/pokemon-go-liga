import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

admin.initializeApp();
const db = admin.firestore();

/**
 * Trigger de Firestore:
 * dispara em qualquer write em disputas_ginasio_resultados/{resultadoId}
 * (mesma região do Firestore: southamerica-east1)
 */
export const onResultadoWrite = onDocumentWritten(
  {
    document: "disputas_ginasio_resultados/{resultadoId}",
    region: "southamerica-east1",
  },
  async (event: any) => {
    const before = event.data?.before?.data() as any | undefined;
    const after = event.data?.after?.data() as any | undefined;
    const base = after ?? before;
    if (!base) return;

    const disputaId = (after?.disputa_id ?? before?.disputa_id) as
      | string
      | undefined;
    const ginasioId = (after?.ginasio_id ?? before?.ginasio_id) as
      | string
      | undefined;
    if (!disputaId || !ginasioId) return;

    // Se a disputa já não está em andamento, resolva/oculte alerta e saia
    const disputaSnap = await db.doc(`disputas_ginasio/${disputaId}`).get();
    if (!disputaSnap.exists) return;
    const disputa = disputaSnap.data() as any;
    if (!["batalhando", "inscricoes"].includes(disputa.status)) {
      await db
        .doc(`admin_alertas/disputa_${disputaId}_ready`)
        .set(
          {
            status: "resolvido",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      return;
    }

    // Ainda existe algum resultado pendente nesta disputa?
    const pendenteSnap = await db
      .collection("disputas_ginasio_resultados")
      .where("disputa_id", "==", disputaId)
      .where("status", "==", "pendente")
      .limit(1)
      .get();

    const alertRef = db.doc(`admin_alertas/disputa_${disputaId}_ready`);

    if (pendenteSnap.empty) {
      // Disputa sem pendências → cria/atualiza alerta "pronta para encerrar"
      const gSnap = await db.doc(`ginasios/${ginasioId}`).get();
      const g = gSnap.exists ? (gSnap.data() as any) : {};

      await alertRef.set(
        {
          type: "disputa_pronta_para_encerrar",
          disputa_id: disputaId,
          ginasio_id: ginasioId,
          ginasio_nome: g?.nome || ginasioId,
          liga: g?.liga || g?.liga_nome || "",
          status: "novo",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      // Voltou a ter pendências → esconder/fechar alerta
      await alertRef.set(
        {
          status: "resolvido",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }
);

/**
 * HELPERS PARA OS JOBS DE DISPUTA (CRON)
 */

async function processCriarDisputaJob(job: any) {
  console.log("Processando job CRIAR_DISPUTA", job);

  if (!job.ginasio_id) {
    throw new Error("Job sem ginasio_id");
  }

  const gRef = db.collection("ginasios").doc(job.ginasio_id);
  const gSnap = await gRef.get();
  if (!gSnap.exists) {
    console.warn("Ginásio não encontrado, ignorando job", job.ginasio_id);
    return;
  }
  const g = gSnap.data() as any;

  // confere se já existe disputa ativa (inscricoes/batalhando)
  const dSnap = await db
    .collection("disputas_ginasio")
    .where("ginasio_id", "==", job.ginasio_id)
    .where("status", "in", ["inscricoes", "batalhando"])
    .limit(1)
    .get();

  if (!dSnap.empty) {
    console.log("Já existe disputa ativa para este ginásio, ignorando job.");
    return;
  }

  const tipoOriginal = job.tipo_original || g.tipo || "";
  const temporadaId = job.temporada_id || "";
  const temporadaNome = job.temporada_nome || "";
  const liga = job.liga || g.liga || g.liga_nome || "";

  const novaDisputaRef = await db.collection("disputas_ginasio").add({
    ginasio_id: job.ginasio_id,
    status: "inscricoes",
    tipo_original: tipoOriginal,
    lider_anterior_uid: g.lider_uid || "",
    temporada_id: temporadaId,
    temporada_nome: temporadaNome,
    liga,
    origem: job.origem || "job_cloud",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("Disputa criada via job:", novaDisputaRef.id);

  await gRef.update({
    em_disputa: true,
  });
}

async function processIniciarDisputaJob(job: any) {
  console.log("Processando job INICIAR_DISPUTA", job);

  if (!job.ginasio_id) {
    throw new Error("Job sem ginasio_id");
  }

  let disputaRef: FirebaseFirestore.DocumentReference | null = null;
  let disputaData: any = null;

  if (job.disputa_id) {
    const snap = await db
      .collection("disputas_ginasio")
      .doc(job.disputa_id)
      .get();
    if (!snap.exists) {
      console.warn("Disputa do job não existe mais, ignorando.", job.disputa_id);
      return;
    }
    disputaRef = snap.ref;
    disputaData = snap.data() as any;
  } else {
    // fallback: pega disputa em inscrições do ginásio
    const ds = await db
      .collection("disputas_ginasio")
      .where("ginasio_id", "==", job.ginasio_id)
      .where("status", "==", "inscricoes")
      .limit(1)
      .get();
    if (ds.empty) {
      console.log("Nenhuma disputa em inscrições para iniciar.");
      return;
    }
    disputaRef = ds.docs[0].ref;
    disputaData = ds.docs[0].data() as any;
  }

  if (!disputaRef) {
    console.warn("disputaRef nulo, saindo.");
    return;
  }

  if (disputaData.status !== "inscricoes") {
    console.log("Disputa não está mais em inscrições, ignorando job.");
    return;
  }

  const disputaId = disputaRef.id;

  // Marca como removidos os participantes sem tipo_escolhido
  const partSnap0 = await db
    .collection("disputas_ginasio_participantes")
    .where("disputa_id", "==", disputaId)
    .get();

  const batch1 = db.batch();
  for (const pDoc of partSnap0.docs) {
    const d = pDoc.data() as any;
    if (!d.tipo_escolhido || d.tipo_escolhido === "") {
      batch1.update(pDoc.ref, { removido: true });
    }
  }
  await batch1.commit();

  // Reconta válidos
  const partSnap = await db
    .collection("disputas_ginasio_participantes")
    .where("disputa_id", "==", disputaId)
    .get();

  const validos = partSnap.docs
    .map((p) => p.data() as any)
    .filter(
      (d) => !d.removido && d.tipo_escolhido && d.tipo_escolhido !== ""
    ).length;

  if (validos < 2) {
    console.log(
      `Menos de 2 participantes válidos na disputa ${disputaId}, não será iniciada.`
    );
    // mantém inscrições; job é considerado concluído
    return;
  }

  await disputaRef.update({
    status: "batalhando",
    iniciadaEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("Disputa iniciada via job:", disputaId);
}

/**
 * FUNÇÃO AGENDADA – V2
 * Roda a cada 5 minutos e processa jobs em /jobs_disputas
 */
export const processDisputeJobs = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Sao_Paulo",
  },
  async () => {
    const now = Date.now();

    const jobsSnap = await db
      .collection("jobs_disputas")
      .where("status", "==", "pendente")
      .where("runAtMs", "<=", now)
      .limit(20)
      .get();

    if (jobsSnap.empty) {
      console.log("Nenhum job pendente.");
      return;
    }

    console.log(`Encontrados ${jobsSnap.size} job(s) pendentes.`);

    for (const jobDoc of jobsSnap.docs) {
      const job = jobDoc.data() as any;

      try {
        if (job.acao === "criar_disputa") {
          await processCriarDisputaJob(job);
        } else if (job.acao === "iniciar_disputa") {
          await processIniciarDisputaJob(job);
        } else {
          console.warn("Ação desconhecida:", job.acao);
        }

        await jobDoc.ref.update({
          status: "executado",
          executedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e: any) {
        console.error("Erro ao executar job", jobDoc.id, e);
        await jobDoc.ref.update({
          status: "erro",
          errorMessage: (e?.message || String(e)).substring(0, 500),
          executedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }
);
