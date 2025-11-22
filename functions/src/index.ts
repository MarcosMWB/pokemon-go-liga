// functions/src/index.ts
import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

admin.initializeApp();
const db = admin.firestore();

/**
 * TRIGGER DE FIRESTORE:
 * dispara em qualquer write em disputas_ginasio_resultados/{resultadoId}
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
 * ===== HELPERS PARA OS JOBS DE DISPUTA (CRON) =====
 */

// lê tempo_inscricoes em horas de variables/global e devolve em ms
async function getTempoInscricoesMs(): Promise<number> {
  try {
    const snap = await db.collection("variables").doc("global").get();
    if (!snap.exists) return 0;
    const data = snap.data() as any;
    const raw = toHours(data?.tempo_inscricoes);
    const horas =
      typeof raw === "number"
        ? raw
        : raw != null
        ? Number(raw)
        : 0;
    if (!isNaN(horas) && horas > 0) {
      return horas * 60 * 60 * 1000;
    }
    return 0;
  } catch (e) {
    console.warn("Falha ao ler variables/global.tempo_inscricoes", e);
    return 0;
  }
}

async function scheduleIniciarDisputaJob(
  ginasioId: string,
  disputaId: string
): Promise<void> {
  const tempoMs = await getTempoInscricoesMs();

  if (tempoMs <= 0) {
    console.log(
      "tempo_inscricoes não configurado (>0). Iniciando disputa imediatamente."
    );
    await processIniciarDisputaJob({
      ginasio_id: ginasioId,
      disputa_id: disputaId,
    });
    return;
  }

  const runAtMs = Date.now() + tempoMs;

  await db.collection("jobs_disputas").add({
    acao: "iniciar_disputa",
    status: "pendente",
    ginasio_id: ginasioId,
    disputa_id: disputaId,
    origem: "auto_from_criar_disputa",
    runAtMs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(
    `Job INICIAR_DISPUTA agendado para ${runAtMs} (em ${tempoMs} ms) para disputa ${disputaId}`
  );
}

/** ===== NOVO: tempo de batalhas + agendamento do encerramento ===== */
async function getTempoBatalhasMs(): Promise<number> {
  try {
    const snap = await db.collection("variables").doc("global").get();
    if (!snap.exists) return 0;
    const data = snap.data() as any;
    const raw = toHours(data?.tempo_batalhas);
    const horas =
      typeof raw === "number"
        ? raw
        : raw != null
        ? Number(raw)
        : 0;
    if (!isNaN(horas) && horas > 0) {
      return horas * 60 * 60 * 1000;
    }
    return 0;
  } catch (e) {
    console.warn("Falha ao ler variables/global.tempo_batalhas", e);
    return 0;
  }
}

function toHours(raw: any): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw.trim().replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function scheduleEncerrarDisputaJob(
  ginasioId: string,
  disputaId: string
): Promise<void> {
  const tempoMs = await getTempoBatalhasMs();
  const runAtMs = Date.now() + (tempoMs > 0 ? tempoMs : 0);

  await db.collection("jobs_disputas").add({
    acao: "encerrar_disputa",
    status: "pendente",
    ginasio_id: ginasioId,
    disputa_id: disputaId,
    origem: "auto_from_iniciar_disputa",
    runAtMs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(
    `Job ENCERRAR_DISPUTA agendado para ${runAtMs} (em ${tempoMs} ms) para disputa ${disputaId}`
  );
}
/** ===== FIM DO BLOCO NOVO ===== */

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
  const liderAnterior = job.lider_anterior_uid || g.lider_uid || "";

  const novaDisputaRef = await db.collection("disputas_ginasio").add({
    ginasio_id: job.ginasio_id,
    status: "inscricoes",
    tipo_original: tipoOriginal,
    lider_anterior_uid: liderAnterior,
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

  // agenda automaticamente o job para INICIAR a disputa
  await scheduleIniciarDisputaJob(job.ginasio_id, novaDisputaRef.id);
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
      console.warn(
        "Disputa do job não existe mais, ignorando.",
        job.disputa_id
      );
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

  /** NOVO: agenda encerramento após o período de batalhas */
  await scheduleEncerrarDisputaJob(job.ginasio_id, disputaId);

  console.log("Disputa iniciada via job:", disputaId);
}

/** ===== NOVO: encerramento automático da disputa ===== */
async function processEncerrarDisputaJob(job: any) {
  console.log("Processando job ENCERRAR_DISPUTA", job);
  const { ginasio_id, disputa_id } = job;
  if (!ginasio_id || !disputa_id) throw new Error("Job sem ginasio_id/disputa_id");

  const dRef = db.collection("disputas_ginasio").doc(disputa_id);
  const dSnap = await dRef.get();
  if (!dSnap.exists) return;
  const d = dSnap.data() as any;

  // encerra apenas se ainda estiver batalhando
  if (d.status !== "batalhando") {
    console.log("Disputa não está mais batalhando, ignorando encerramento.");
    return;
  }

  // coleta resultados confirmados
  const resSnap = await db.collection("disputas_ginasio_resultados")
    .where("disputa_id", "==", disputa_id)
    .where("status", "==", "confirmado")
    .get();

  const vitorias = new Map<string, number>();
  for (const docu of resSnap.docs) {
    const r = docu.data() as any;
    const uid = r.vencedor_uid as string | undefined;
    if (!uid) continue;
    vitorias.set(uid, (vitorias.get(uid) || 0) + 1);
  }

  if (vitorias.size === 0) {
    // sem resultados confirmados
    await dRef.update({
      status: "finalizado",
      encerradaEm: admin.firestore.FieldValue.serverTimestamp(),
      motivo_encerramento: "sem_resultados_confirmados",
    });
    await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
    await db.collection("ginasios").doc(ginasio_id).update({ em_disputa: false });
    console.log("Disputa encerrada sem vencedor (sem resultados).");
    return;
  }

  // escolhe o UID com mais vitórias (desempate determinístico por UID)
  const vencedorUid = [...vitorias.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0][0];

  const gRef = db.collection("ginasios").doc(ginasio_id);

  // fecha lideranças abertas e cria a nova
  const abertas = await db.collection("ginasios_liderancas")
    .where("ginasio_id", "==", ginasio_id)
    .where("fim", "==", null)
    .get();

  const batch = db.batch();
  for (const l of abertas.docs) {
    batch.update(l.ref, { fim: admin.firestore.FieldValue.serverTimestamp() });
  }
  batch.set(db.collection("ginasios_liderancas").doc(), {
    ginasio_id,
    lider_uid: vencedorUid,
    inicio: admin.firestore.FieldValue.serverTimestamp(),
    fim: null,
    origem: "encerramento_automatico",
    disputa_id,
  });
  await batch.commit();

  // aplica no ginásio
  await gRef.update({
    lider_uid: vencedorUid,
    em_disputa: false,
    derrotas_seguidas: 0,
  });

  // finaliza disputa
  await dRef.update({
    status: "finalizado",
    encerradaEm: admin.firestore.FieldValue.serverTimestamp(),
    vencedor_uid: vencedorUid,
  });

  // resolve alerta
  await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });

  console.log(`Disputa ${disputa_id} encerrada. Novo líder: ${vencedorUid}`);
}
/** ===== FIM DO BLOCO NOVO ===== */

/**
 * FUNÇÃO AGENDADA – V2
 * Roda a cada 5 minutos e processa jobs em /jobs_disputas
 */
export const processDisputeJobs = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Sao_Paulo",
    region: "southamerica-east1",
  },
  async () => {
    const now = Date.now();

    const jobsSnap = await db
      .collection("jobs_disputas")
      .where("status", "==", "pendente")
      .limit(50)
      .get();

    const dueJobs = jobsSnap.docs.filter((doc) => {
      const data = doc.data() as any;
      const runAtMs =
        typeof data.runAtMs === "number" ? data.runAtMs : 0;
      return runAtMs <= now;
    });

    if (dueJobs.length === 0) {
      console.log("Nenhum job pendente no horário.");
      return;
    }

    console.log(`Processando ${dueJobs.length} job(s) vencidos.`);

    for (const jobDoc of dueJobs) {
      const job = jobDoc.data() as any;

      try {
        if (job.acao === "criar_disputa") {
          await processCriarDisputaJob(job);
        } else if (job.acao === "iniciar_disputa") {
          await processIniciarDisputaJob(job);
        } else if (job.acao === "encerrar_disputa") {
          await processEncerrarDisputaJob(job);
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
