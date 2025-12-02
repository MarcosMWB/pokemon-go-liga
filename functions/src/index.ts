// functions/src/index.ts
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";

// se existir um arquivo desafios.ts que exporta a trigger, mantenha:
export { onDesafioResultadosWrite } from "./desafios";

import { admin, db, FieldValue } from "./adminSdk";

export const onDesafioConcluido = onDocumentWritten(
  {
    document: "desafios_ginasio/{desafioId}",
    region: "southamerica-east1",
  },
  async (event: any) => {
    const before = event.data?.before?.data() as any | undefined;
    const after  = event.data?.after?.data()  as any | undefined;
    if (!after) return;

    // só quando vira concluído
    const ficouConcluido = (before?.status !== "concluido") && (after.status === "concluido");
    if (!ficouConcluido) return;

    // idempotência rápida
    if (after.statsApplied === true) return;

    const desafioId   = event.params?.desafioId as string;
    const ginasioId   = after.ginasio_id as string | undefined;
    const liga        = (after.liga as string) || "";
    const liderUid    = after.lider_uid as string | undefined;
    const desafiante  = after.desafiante_uid as string | undefined;
    const vencedorTag = after.vencedor as ("lider" | "desafiante") | undefined;

    if (!desafioId || !ginasioId || !liderUid || !desafiante || !vencedorTag) return;

    const winnerUid = vencedorTag === "lider" ? liderUid : desafiante;
    const loserUid  = vencedorTag === "lider" ? desafiante : liderUid;

    await db.runTransaction(async (tx) => {
      const desafioRef = db.doc(`desafios_ginasio/${desafioId}`);
      const dSnap = await tx.get(desafioRef);
      const dNow = dSnap.data() as any | undefined;
      if (!dNow) return;
      if (dNow.status !== "concluido") return;        // ainda garantimos
      if (dNow.statsApplied === true) return;         // já processado

      // 1) stats dos usuários
      const winRef = db.doc(`usuarios/${winnerUid}`);
      const losRef = db.doc(`usuarios/${loserUid}`);
      tx.set(winRef, { statsVitorias: FieldValue.increment(1) }, { merge: true });
      tx.set(losRef, { statsDerrotas: FieldValue.increment(1) }, { merge: true });

      // 2) pontos do líder (só se o líder venceu e houver campeonato aberto na mesma liga)
      if (vencedorTag === "lider" && liga) {
        // campeonato aberto (o mais recente)
        const qCamp = await db.collection("campeonatos_elite4")
          .where("liga", "==", liga)
          .where("status", "==", "aberto")
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();

        if (!qCamp.empty) {
          const campId = qCamp.docs[0].id;
          const partRef = db.doc(`campeonatos_elite4/${campId}/participantes/${liderUid}`);
          const partSnap = await tx.get(partRef);

          // evita duplicar: só aplica se este desafio ainda não foi registrado
          const jaAplicado = partSnap.exists && partSnap.get("from_desafio") === desafioId;

          if (!jaAplicado) {
            if (!partSnap.exists) {
              tx.set(partRef, {
                campeonato_id: campId,
                usuario_uid: liderUid,
                ginasio_id: ginasioId,
                liga,
                pontos: 1,
                from_desafio: desafioId,
                createdAt: Date.now(),
              }, { merge: true });
            } else {
              tx.update(partRef, {
                pontos: FieldValue.increment(1),
                from_desafio: desafioId,
                updatedAt: Date.now(),
              });
            }
          }
        }
      }

      // 3) marca processado (idempotência)
      tx.update(desafioRef, {
        statsApplied: true,
        statsAppliedAt: FieldValue.serverTimestamp(),
      });
    });
  }
);

// ---- CALLABLE: adminDeleteUser ------------------------------------------------
export const adminDeleteUser = onCall(
  { region: "southamerica-east1" },
  async (req) => {
    const callerUid = req.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Faça login.");

    const isSuperSnap = await db.doc(`superusers/${callerUid}`).get();
    if (!isSuperSnap.exists) {
      throw new HttpsError("permission-denied", "Acesso negado.");
    }

    const targetUid = req.data?.targetUid as string | undefined;
    if (!targetUid) {
      throw new HttpsError("invalid-argument", "targetUid obrigatório.");
    }
    if (targetUid === callerUid) {
      throw new HttpsError("failed-precondition", "Não é permitido excluir a si mesmo.");
    }

    await admin.auth().deleteUser(targetUid).catch((e: any) => {
      if (e?.code !== "auth/user-not-found") throw e;
    });

    const batch = db.batch();
    batch.delete(db.doc(`usuarios/${targetUid}`));
    batch.delete(db.doc(`usuarios_private/${targetUid}`));
    await batch.commit().catch(() => {});

    return { ok: true };
  }
);

// ---- TRIGGER: onResultadoWrite ------------------------------------------------
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

    const disputaId = (after?.disputa_id ?? before?.disputa_id) as string | undefined;
    const ginasioId = (after?.ginasio_id ?? before?.ginasio_id) as string | undefined;
    if (!disputaId || !ginasioId) return;

    const disputaSnap = await db.doc(`disputas_ginasio/${disputaId}`).get();
    if (!disputaSnap.exists) {
      await db.doc(`admin_alertas/disputa_${disputaId}_ready`).set(
        { status: "resolvido", updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      return;
    }

    const pendenteSnap = await db
      .collection("disputas_ginasio_resultados")
      .where("disputa_id", "==", disputaId)
      .where("status", "==", "pendente")
      .limit(1)
      .get();

    const alertRef = db.doc(`admin_alertas/disputa_${disputaId}_ready`);

    if (pendenteSnap.empty) {
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
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      await alertRef.set(
        {
          status: "resolvido",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }
);

// ===== HELPERS DOS JOBS =======================================================

function hoursToMs(raw: any): number {
  if (typeof raw === "number") return raw * 3600000;
  if (typeof raw === "string") {
    const n = parseFloat(raw.trim().replace(",", "."));
    return Number.isFinite(n) ? n * 3600000 : 0;
  }
  return 0;
}

async function getTempoInscricoesMs(): Promise<number> {
  try {
    const snap = await db.collection("variables").doc("global").get();
    const v = snap.exists ? (snap.data() as any)?.tempo_inscricoes : 0;
    return hoursToMs(v);
  } catch {
    return 0;
  }
}

async function getTempoBatalhasMs(): Promise<number> {
  try {
    const snap = await db.collection("variables").doc("global").get();
    const v = snap.exists ? (snap.data() as any)?.tempo_batalhas : 0;
    return hoursToMs(v);
  } catch {
    return 0;
  }
}

type ScheduleOpts = { delayMs?: number; origem?: string };

async function scheduleIniciarDisputaJob(
  ginasioId: string,
  disputaId: string,
  opts?: ScheduleOpts
): Promise<number> {
  const delay = typeof opts?.delayMs === "number" ? opts.delayMs : await getTempoInscricoesMs();
  const runAtMs = Date.now() + Math.max(0, delay);
  const origem = opts?.origem ?? "auto_from_criar_disputa";

  const batch = db.batch();
  batch.set(db.collection("jobs_disputas").doc(), {
    acao: "iniciar_disputa",
    status: "pendente",
    ginasio_id: ginasioId,
    disputa_id: disputaId,
    origem,
    runAtMs,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`disputas_ginasio/${disputaId}`), { nextStartAtMs: runAtMs }, { merge: true });
  await batch.commit();

  return runAtMs;
}

async function scheduleEncerrarDisputaJob(
  ginasioId: string,
  disputaId: string,
  opts?: ScheduleOpts
): Promise<number> {
  const delay = typeof opts?.delayMs === "number" ? opts.delayMs : await getTempoBatalhasMs();
  const runAtMs = Date.now() + Math.max(0, delay);
  const origem = opts?.origem ?? "auto_from_iniciar_disputa";

  const batch = db.batch();
  batch.set(db.collection("jobs_disputas").doc(), {
    acao: "encerrar_disputa",
    status: "pendente",
    ginasio_id: ginasioId,
    disputa_id: disputaId,
    origem,
    runAtMs,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`disputas_ginasio/${disputaId}`), { nextEndAtMs: runAtMs }, { merge: true });
  await batch.commit();

  return runAtMs;
}

// ===== PROCESSADORES DE JOB ===================================================

async function processCriarDisputaJob(job: any) {
  console.log("Processando job CRIAR_DISPUTA", job);

  if (!job.ginasio_id) throw new Error("Job sem ginasio_id");

  const gRef = db.collection("ginasios").doc(job.ginasio_id);
  const gSnap = await gRef.get();
  if (!gSnap.exists) {
    console.warn("Ginásio não encontrado, ignorando job", job.ginasio_id);
    return;
  }
  const g = gSnap.data() as any;

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
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log("Disputa criada via job:", novaDisputaRef.id);

  await gRef.update({ em_disputa: true });

  await scheduleIniciarDisputaJob(job.ginasio_id, novaDisputaRef.id);
}

async function processIniciarDisputaJob(job: any) {
  console.log("Processando job INICIAR_DISPUTA", job);

  if (!job.ginasio_id) throw new Error("Job sem ginasio_id");

  let disputaRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData> | null = null;
  let disputaData: any = null;

  if (job.disputa_id) {
    const snap = await db.collection("disputas_ginasio").doc(job.disputa_id).get();
    if (!snap.exists) {
      console.warn("Disputa do job não existe mais, ignorando.", job.disputa_id);
      return;
    }
    disputaRef = snap.ref;
    disputaData = snap.data() as any;
  } else {
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

  const statusNorm = (disputaData.status || "").toString().trim().toLowerCase();
  if (statusNorm !== "inscricoes") {
    console.log("Disputa não está mais em inscrições, ignorando job.");
    return;
  }

  const disputaId = disputaRef.id;

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

  const partSnap = await db
    .collection("disputas_ginasio_participantes")
    .where("disputa_id", "==", disputaId)
    .get();

  type DocSnap = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

  const validos = partSnap.docs
    .map((p: DocSnap) => p.data() as any)
    .filter((d: any) => !d.removido && d.tipo_escolhido && d.tipo_escolhido !== "").length;

  if (validos < 2) {
    console.log(`Menos de 2 participantes válidos em ${disputaId}. Reagendando verificação.`);
    await scheduleIniciarDisputaJob(job.ginasio_id, disputaId, {
      delayMs: 60 * 60 * 1000,
      origem: "retry_participantes",
    });
    return;
  }

  await disputaRef.update({
    status: "batalhando",
    iniciadaEm: FieldValue.serverTimestamp(),
  });

  await disputaRef.set({ nextStartAtMs: FieldValue.delete() }, { merge: true });

  await scheduleEncerrarDisputaJob(job.ginasio_id, disputaId);

  console.log("Disputa iniciada via job:", disputaId);
}

type EncerrarResult = {
  changed: boolean;
  reason: string;
  meta: Record<string, any>;
  finalStatus?: string;
};

async function processEncerrarDisputaJob(job: any): Promise<EncerrarResult> {
  console.log("Processando job ENCERRAR_DISPUTA", job);
  const { ginasio_id, disputa_id } = job;

  const baseFail = (reason: string, meta: Record<string, any> = {}): EncerrarResult => ({
    changed: false,
    reason,
    meta,
  });

  if (!ginasio_id || !disputa_id) throw new Error("Job sem ginasio_id/disputa_id");

  const dRef = db.collection("disputas_ginasio").doc(disputa_id);
  const dSnap = await dRef.get();
  if (!dSnap.exists) return baseFail("disputa_inexistente");

  const disputa = dSnap.data() as any;
  const statusNorm = (disputa.status || "").toString().trim().toLowerCase();
  if (statusNorm !== "batalhando") {
    return baseFail("status_finalizado_nao_batalhando", { currentStatus: disputa.status });
  }

  const gRef = db.collection("ginasios").doc(ginasio_id);
  const gSnap = await gRef.get();
  const g = gSnap.exists ? (gSnap.data() as any) : {};

  const partSnap = await db
    .collection("disputas_ginasio_participantes")
    .where("disputa_id", "==", disputa_id)
    .get();

  const participantes = partSnap.docs
    .map((p: FirebaseFirestore.QueryDocumentSnapshot) => {
      const d = p.data() as any;
      if (d.removido) return null;
      return {
        usuario_uid: d.usuario_uid as string,
        tipo_escolhido: (d.tipo_escolhido as string) || "",
      };
    })
    .filter((p: any): p is { usuario_uid: string; tipo_escolhido: string } => p !== null);

  if (participantes.length === 0) {
    await dRef.update({
      status: "finalizado",
      encerradaEm: FieldValue.serverTimestamp(),
      vencedor_uid: null,
      sem_vencedor: true,
      finalizacao_aplicada: true,
    });
    await gRef.update({ em_disputa: false });
    await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
    await dRef.set({ nextEndAtMs: FieldValue.delete() }, { merge: true });
    return { changed: true, reason: "sem_participantes", meta: { participantes: 0 }, finalStatus: "finalizado" };
  }

  const resAllSnap = await db
    .collection("disputas_ginasio_resultados")
    .where("disputa_id", "==", disputa_id)
    .get();

  type ResultadoDoc = { id: string; data: any };
  const grupos: Record<string, ResultadoDoc[]> = {};

  resAllSnap.docs.forEach((rDoc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const d = rDoc.data() as any;
    const tipoLower = (typeof d.tipo === "string" ? d.tipo : "").toString().trim().toLowerCase();

    if (tipoLower === "empate") return;

    const a = d.vencedor_uid as string | undefined;
    const b = d.perdedor_uid as string | undefined;
    if (!a || !b) return;

    const key = [a, b].sort().join("__");
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push({ id: rDoc.id, data: d });
  });

  const woTargets: string[] = [];
  const woUpdates: Promise<any>[] = [];

  Object.values(grupos).forEach((lista) => {
    const pendentes = lista.filter((r) => (r.data.status || "pendente") === "pendente");
    const confirmados = lista.filter((r) => r.data.status === "confirmado");

    if (confirmados.length > 0) return;

    if (pendentes.length === 1) {
      const r = pendentes[0];
      woTargets.push(r.id);
      woUpdates.push(
        db.collection("disputas_ginasio_resultados").doc(r.id).update({
          status: "confirmado",
          confirmadoPorWoAutomatico: true,
          confirmadoPorWoEm: FieldValue.serverTimestamp(),
        })
      );
    }
  });

  if (woUpdates.length > 0) await Promise.all(woUpdates);

  const resSnap = await db
    .collection("disputas_ginasio_resultados")
    .where("disputa_id", "==", disputa_id)
    .where("status", "==", "confirmado")
    .get();

  if (resSnap.empty) {
    await dRef.update({
      status: "finalizado",
      encerradaEm: FieldValue.serverTimestamp(),
      vencedor_uid: null,
      sem_vencedor: true,
      finalizacao_aplicada: true,
    });
    await gRef.update({ em_disputa: false });
    await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
    await dRef.set({ nextEndAtMs: FieldValue.delete() }, { merge: true });
    return {
      changed: true,
      reason: "sem_resultados_confirmados",
      meta: { participantes: participantes.length, woConfirmados: woTargets },
      finalStatus: "finalizado",
    };
  }

  const pontos: Record<string, number> = {};
  participantes.forEach((p) => (pontos[p.usuario_uid] = 0));

  const confirmadosIds: string[] = [];

  resSnap.docs.forEach((rDoc: FirebaseFirestore.QueryDocumentSnapshot) => {
    confirmadosIds.push(rDoc.id);
    const r = rDoc.data() as any;
    const tipoLower = (typeof r.tipo === "string" ? r.tipo : "").toString().trim().toLowerCase();

    if (tipoLower === "empate") {
      const j1 = r.jogador1_uid as string | undefined;
      const j2 = r.jogador2_uid as string | undefined;
      if (j1) pontos[j1] = (pontos[j1] || 0) + 1;
      if (j2) pontos[j2] = (pontos[j2] || 0) + 1;
    } else {
      const vUid = r.vencedor_uid as string | undefined;
      if (vUid) pontos[vUid] = (pontos[vUid] || 0) + 3;
    }
  });

  let maior = -1;
  Object.keys(pontos).forEach((uid) => {
    if (pontos[uid] > maior) maior = pontos[uid];
  });

  if (maior <= 0) {
    await dRef.update({
      status: "finalizado",
      encerradaEm: FieldValue.serverTimestamp(),
      vencedor_uid: null,
      sem_vencedor: true,
      finalizacao_aplicada: true,
    });
    await gRef.update({ em_disputa: false });
    await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
    await dRef.set({ nextEndAtMs: FieldValue.delete() }, { merge: true });
    return {
      changed: true,
      reason: "todos_zero_ponto",
      meta: { participantes: participantes.length, confirmadosIds },
      finalStatus: "finalizado",
    };
  }

  const empatados = Object.keys(pontos).filter((uid) => pontos[uid] === maior);

  if (g && g.lider_uid) {
    await dRef.update({
      status: "finalizado",
      encerradaEm: FieldValue.serverTimestamp(),
      finalizacao_aplicada: true,
    });
    await gRef.update({ em_disputa: false });
    await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
    await dRef.set({ nextEndAtMs: FieldValue.delete() }, { merge: true });
    return {
      changed: true,
      reason: "ginasio_ja_tem_lider",
      meta: { lider_uid: g.lider_uid, maior, empatados, confirmadosIds },
      finalStatus: "finalizado",
    };
  }

  if (empatados.length > 1) {
    const novaRef = await db.collection("disputas_ginasio").add({
      ginasio_id,
      status: "inscricoes",
      tipo_original: disputa.tipo_original || g.tipo || "",
      lider_anterior_uid: disputa.lider_anterior_uid || g.lider_uid || "",
      reaberta_por_empate: true,
      temporada_id: disputa.temporada_id || "",
      temporada_nome: disputa.temporada_nome || "",
      liga: disputa.liga || disputa.liga_nome || g.liga || g.liga_nome || "",
      origem: "empate",
      createdAt: FieldValue.serverTimestamp(),
    });
    const novaId = novaRef.id;

    const batchPart = db.batch();
    for (const uid of empatados) {
      const partOrig = participantes.find((p) => p.usuario_uid === uid);
      batchPart.set(db.collection("disputas_ginasio_participantes").doc(), {
        disputa_id: novaId,
        ginasio_id,
        usuario_uid: uid,
        tipo_escolhido: partOrig?.tipo_escolhido || disputa.tipo_original || g.tipo || "",
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batchPart.commit();

    await dRef.update({
      status: "finalizado",
      encerradaEm: FieldValue.serverTimestamp(),
      vencedor_uid: null,
      empate_no_topo: true,
      finalizacao_aplicada: true,
    });
    await gRef.update({ em_disputa: true });
    await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
    await dRef.set({ nextEndAtMs: FieldValue.delete() }, { merge: true });

    await scheduleIniciarDisputaJob(ginasio_id, novaId);

    return {
      changed: true,
      reason: "empate_topo_reaberta",
      meta: { novaDisputaId: novaId, empatados, maior, confirmadosIds },
      finalStatus: "finalizado",
    };
  }

  const vencedorUid = empatados[0];
  const participanteVencedor = participantes.find((p) => p.usuario_uid === vencedorUid);
  const tipoDoVencedor = participanteVencedor?.tipo_escolhido || disputa.tipo_original || g.tipo || "";

  const abertas = await db
    .collection("ginasios_liderancas")
    .where("ginasio_id", "==", ginasio_id)
    .where("fim", "==", null)
    .get();

  const nowMs = Date.now();

  const batch = db.batch();
  for (const l of abertas.docs) {
    batch.update(l.ref, { fim: nowMs });
  }
  batch.set(db.collection("ginasios_liderancas").doc(), {
    ginasio_id,
    lider_uid: vencedorUid,
    inicio: nowMs,
    fim: null,
    origem: "disputa",
    disputa_id,
    liga: disputa.liga || disputa.liga_nome || g.liga || g.liga_nome || "",
    temporada_id: disputa.temporada_id || "",
    temporada_nome: disputa.temporada_nome || "",
    tipo_no_periodo: tipoDoVencedor,
  });
  await batch.commit();

  await gRef.update({
    lider_uid: vencedorUid,
    tipo: tipoDoVencedor,
    em_disputa: false,
    derrotas_seguidas: 0,
  });

  await dRef.update({
    status: "finalizado",
    encerradaEm: FieldValue.serverTimestamp(),
    vencedor_uid: vencedorUid,
    finalizacao_aplicada: true,
  });

  await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
  await dRef.set({ nextEndAtMs: FieldValue.delete() }, { merge: true });

  return {
    changed: true,
    reason: "vencedor_definido",
    meta: { vencedorUid, tipoDoVencedor },
    finalStatus: "finalizado",
  };
}

// ---- CRON: processDisputeJobs ------------------------------------------------
export const processDisputeJobs = onSchedule(
  { schedule: "every 5 minutes", timeZone: "America/Sao_Paulo", region: "southamerica-east1", maxInstances: 1 },
  async () => {
    const now = Date.now();

    const jobsSnap = await db
      .collection("jobs_disputas")
      .where("status", "==", "pendente")
      .where("runAtMs", "<=", now)
      .limit(50)
      .get();

    if (jobsSnap.empty) {
      console.log("Nenhum job pendente no horário.");
      return;
    }

    for (const jobDoc of jobsSnap.docs) {
      const job = jobDoc.data() as any;

      await jobDoc.ref.update({
        status: "executando",
        startedAt: FieldValue.serverTimestamp(),
      });

      try {
        if (job.acao === "criar_disputa") {
          await processCriarDisputaJob(job);
          await jobDoc.ref.update({
            status: "executado",
            executedAt: FieldValue.serverTimestamp(),
          });
        } else if (job.acao === "iniciar_disputa") {
          await processIniciarDisputaJob(job);
          await jobDoc.ref.update({
            status: "executado",
            executedAt: FieldValue.serverTimestamp(),
          });
        } else if (job.acao === "encerrar_disputa") {
          const result = await processEncerrarDisputaJob(job);
          await jobDoc.ref.update({
            status: "executado",
            executedAt: FieldValue.serverTimestamp(),
            noOp: !result.changed,
            resultReason: result.reason,
            debug: result.meta,
            finalStatus: result.finalStatus ?? FieldValue.delete(),
          });
        } else {
          await jobDoc.ref.update({
            status: "erro",
            errorMessage: `acao_desconhecida: ${job.acao}`,
            executedAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (e: any) {
        await jobDoc.ref.update({
          status: "erro",
          errorMessage: (e?.message || String(e)).slice(0, 500),
          executedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }
);
