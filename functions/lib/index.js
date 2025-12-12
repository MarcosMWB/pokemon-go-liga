"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDisputeJobs = exports.onResultadoWrite = exports.adminDeleteUser = exports.onDesafioConcluido = exports.onDesafioCriadoCriarBloqueio = exports.onDesafioResultadosWrite = void 0;
// functions/src/index.ts
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
// se existir um arquivo desafios.ts que exporta a trigger, mantenha:
var desafios_1 = require("./desafios");
Object.defineProperty(exports, "onDesafioResultadosWrite", { enumerable: true, get: function () { return desafios_1.onDesafioResultadosWrite; } });
const adminSdk_1 = require("./adminSdk");
const BLOQUEIOS_COLLECTION = "bloqueios_ginasio";
const COOLDOWN_DIAS = 7;
const COOLDOWN_MS = COOLDOWN_DIAS * 24 * 60 * 60 * 1000;
function asInt(n) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.trunc(v) : 0;
}
function calcElite4Points(w, l) {
    // (vitórias * 2) - derrotas, com clamp: negativo = 0, zero = 1
    const base = 2 * asInt(w) - asInt(l);
    if (base < 0)
        return 0;
    if (base === 0)
        return 1;
    return base;
}
function toMillisAny(v) {
    if (!v)
        return null;
    if (typeof v === "number" && Number.isFinite(v))
        return Math.trunc(v);
    if (typeof v?.toMillis === "function")
        return v.toMillis(); // Timestamp
    return null;
}
exports.onDesafioCriadoCriarBloqueio = (0, firestore_1.onDocumentWritten)({ document: "desafios_ginasio/{desafioId}", region: "southamerica-east1" }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after)
        return;
    // só na criação (antes não existia)
    const isCreate = !event.data?.before?.exists;
    if (!isCreate)
        return;
    // idempotência (porque vamos dar update no próprio desafio)
    if (after.cooldownApplied === true)
        return;
    const desafioId = event.params?.desafioId;
    const ginasioId = after.ginasio_id;
    const desafiante = after.desafiante_uid;
    const liderUid = after.lider_uid;
    const liga = after.liga || "";
    if (!desafioId || !ginasioId || !desafiante)
        return;
    // pega createdAt do próprio doc (number ou Timestamp)
    let createdAtMs = toMillisAny(after.createdAt) ??
        toMillisAny(after.criadoEm) ??
        toMillisAny(after.created_at);
    // fallback: createTime do documento (servidor)
    const createTime = event.data?.after?.createTime;
    if (!createdAtMs && createTime && typeof createTime.toMillis === "function") {
        createdAtMs = createTime.toMillis();
    }
    // último fallback (não ideal, mas não quebra)
    if (!createdAtMs)
        createdAtMs = Date.now();
    const blockedUntilMs = createdAtMs + COOLDOWN_MS;
    const blockedUntil = adminSdk_1.admin.firestore.Timestamp.fromMillis(blockedUntilMs);
    // chave determinística: (ginasio + desafiante) = seu requisito
    const blockId = `${ginasioId}__${desafiante}`;
    const blockRef = adminSdk_1.db.doc(`${BLOQUEIOS_COLLECTION}/${blockId}`);
    const desafioRef = adminSdk_1.db.doc(`desafios_ginasio/${desafioId}`);
    await adminSdk_1.db.runTransaction(async (tx) => {
        const dSnap = await tx.get(desafioRef);
        if (!dSnap.exists)
            return;
        const dNow = dSnap.data();
        if (dNow.cooldownApplied === true)
            return; // idempotência de verdade
        tx.set(blockRef, {
            status: "ativo",
            ginasio_id: ginasioId,
            desafiante_uid: desafiante,
            lider_uid: liderUid || null,
            liga,
            desafio_id: desafioId,
            // importante pro cliente e pra Rules
            createdAtMs,
            blockedUntilMs,
            blockedUntil,
            createdAt: adminSdk_1.FieldValue.serverTimestamp(),
            updatedAt: adminSdk_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.update(desafioRef, {
            cooldownApplied: true,
            cooldownAppliedAt: adminSdk_1.FieldValue.serverTimestamp(),
        });
    });
});
exports.onDesafioConcluido = (0, firestore_1.onDocumentWritten)({
    document: "desafios_ginasio/{desafioId}",
    region: "southamerica-east1",
}, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after)
        return;
    // só quando vira concluído
    const ficouConcluido = (before?.status !== "concluido") && (after.status === "concluido");
    if (!ficouConcluido)
        return;
    // idempotência rápida
    if (after.statsApplied === true)
        return;
    const desafioId = event.params?.desafioId;
    const ginasioId = after.ginasio_id;
    const liga = after.liga || "";
    const liderUid = after.lider_uid;
    const desafiante = after.desafiante_uid;
    const vencedorTag = after.vencedor;
    if (!desafioId || !ginasioId || !liderUid || !desafiante || !vencedorTag)
        return;
    const winnerUid = vencedorTag === "lider" ? liderUid : desafiante;
    const loserUid = vencedorTag === "lider" ? desafiante : liderUid;
    await adminSdk_1.db.runTransaction(async (tx) => {
        const desafioRef = adminSdk_1.db.doc(`desafios_ginasio/${desafioId}`);
        const dSnap = await tx.get(desafioRef);
        const dNow = dSnap.data();
        if (!dNow)
            return;
        if (dNow.status !== "concluido")
            return;
        if (dNow.statsApplied === true)
            return;
        const winRef = adminSdk_1.db.doc(`usuarios/${winnerUid}`);
        const losRef = adminSdk_1.db.doc(`usuarios/${loserUid}`);
        // =========================
        // FASE 1: TODAS AS LEITURAS
        // =========================
        // (A) pré-leitura do líder para calcular ptsElite4
        let ptsElite4 = 0;
        let leaderSnapPre = null;
        if (vencedorTag === "lider") {
            leaderSnapPre = await tx.get(winRef); // winRef == liderUid quando líder vence
            const w0 = leaderSnapPre.exists ? asInt(leaderSnapPre.get("statsVitorias")) : 0;
            const l0 = leaderSnapPre.exists ? asInt(leaderSnapPre.get("statsDerrotas")) : 0;
            ptsElite4 = calcElite4Points(w0 + 1, l0);
        }
        // (B) pré-leitura de campeonato + participante (SE for aplicar Elite4)
        let campId = null;
        let partRef = null;
        let partSnap = null;
        if (vencedorTag === "lider" && liga && ptsElite4 > 0) {
            const campQuery = adminSdk_1.db.collection("campeonatos_elite4")
                .where("liga", "==", liga)
                .where("status", "==", "aberto")
                .orderBy("createdAt", "desc")
                .limit(1);
            // @ts-ignore (depende da versão do admin/firestore)
            const qCamp = await tx.get(campQuery);
            if (!qCamp.empty) {
                campId = qCamp.docs[0].id;
                partRef = adminSdk_1.db.doc(`campeonatos_elite4/${campId}/participantes/${liderUid}`);
                partSnap = await tx.get(partRef);
            }
        }
        // =========================
        // FASE 2: ESCRITAS
        // =========================
        // 1) stats
        tx.set(winRef, { statsVitorias: adminSdk_1.FieldValue.increment(1) }, { merge: true });
        tx.set(losRef, { statsDerrotas: adminSdk_1.FieldValue.increment(1) }, { merge: true });
        // 2) Elite4 (somente se líder venceu e achou campeonato)
        if (vencedorTag === "lider" && liga && ptsElite4 > 0 && campId && partRef && partSnap) {
            const applied = partSnap.exists ? (partSnap.get("wins_applied") || {}) : {};
            const jaAplicado = typeof applied === "object" && applied && applied[desafioId] != null;
            if (!jaAplicado) {
                const patch = { [desafioId]: ptsElite4 };
                if (!partSnap.exists) {
                    tx.set(partRef, {
                        campeonato_id: campId,
                        usuario_uid: liderUid,
                        ginasio_id: ginasioId,
                        liga,
                        pontos: ptsElite4,
                        wins_applied: patch,
                        createdAt: Date.now(),
                    }, { merge: true });
                }
                else {
                    tx.update(partRef, {
                        pontos: adminSdk_1.FieldValue.increment(ptsElite4),
                        wins_applied: { ...applied, ...patch },
                        updatedAt: Date.now(),
                    });
                }
            }
        }
        tx.update(desafioRef, {
            statsApplied: true,
            statsAppliedAt: adminSdk_1.FieldValue.serverTimestamp(),
        });
    });
});
// ---- CALLABLE: adminDeleteUser ------------------------------------------------
exports.adminDeleteUser = (0, https_1.onCall)({ region: "southamerica-east1" }, async (req) => {
    const callerUid = req.auth?.uid;
    if (!callerUid)
        throw new https_1.HttpsError("unauthenticated", "Faça login.");
    const isSuperSnap = await adminSdk_1.db.doc(`superusers/${callerUid}`).get();
    if (!isSuperSnap.exists) {
        throw new https_1.HttpsError("permission-denied", "Acesso negado.");
    }
    const targetUid = req.data?.targetUid;
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "targetUid obrigatório.");
    }
    if (targetUid === callerUid) {
        throw new https_1.HttpsError("failed-precondition", "Não é permitido excluir a si mesmo.");
    }
    await adminSdk_1.admin.auth().deleteUser(targetUid).catch((e) => {
        if (e?.code !== "auth/user-not-found")
            throw e;
    });
    const batch = adminSdk_1.db.batch();
    batch.delete(adminSdk_1.db.doc(`usuarios/${targetUid}`));
    batch.delete(adminSdk_1.db.doc(`usuarios_private/${targetUid}`));
    await batch.commit().catch(() => { });
    return { ok: true };
});
// ---- TRIGGER: onResultadoWrite ------------------------------------------------
exports.onResultadoWrite = (0, firestore_1.onDocumentWritten)({
    document: "disputas_ginasio_resultados/{resultadoId}",
    region: "southamerica-east1",
}, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const base = after ?? before;
    if (!base)
        return;
    const disputaId = (after?.disputa_id ?? before?.disputa_id);
    const ginasioId = (after?.ginasio_id ?? before?.ginasio_id);
    if (!disputaId || !ginasioId)
        return;
    const disputaSnap = await adminSdk_1.db.doc(`disputas_ginasio/${disputaId}`).get();
    if (!disputaSnap.exists) {
        await adminSdk_1.db.doc(`admin_alertas/disputa_${disputaId}_ready`).set({ status: "resolvido", updatedAt: adminSdk_1.FieldValue.serverTimestamp() }, { merge: true });
        return;
    }
    const pendenteSnap = await adminSdk_1.db
        .collection("disputas_ginasio_resultados")
        .where("disputa_id", "==", disputaId)
        .where("status", "==", "pendente")
        .limit(1)
        .get();
    const alertRef = adminSdk_1.db.doc(`admin_alertas/disputa_${disputaId}_ready`);
    if (pendenteSnap.empty) {
        const gSnap = await adminSdk_1.db.doc(`ginasios/${ginasioId}`).get();
        const g = gSnap.exists ? gSnap.data() : {};
        await alertRef.set({
            type: "disputa_pronta_para_encerrar",
            disputa_id: disputaId,
            ginasio_id: ginasioId,
            ginasio_nome: g?.nome || ginasioId,
            liga: g?.liga || g?.liga_nome || "",
            status: "novo",
            createdAt: adminSdk_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    else {
        await alertRef.set({
            status: "resolvido",
            updatedAt: adminSdk_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
});
// ===== HELPERS DOS JOBS =======================================================
function hoursToMs(raw) {
    if (typeof raw === "number")
        return raw * 3600000;
    if (typeof raw === "string") {
        const n = parseFloat(raw.trim().replace(",", "."));
        return Number.isFinite(n) ? n * 3600000 : 0;
    }
    return 0;
}
async function getTempoInscricoesMs() {
    try {
        const snap = await adminSdk_1.db.collection("variables").doc("global").get();
        const v = snap.exists ? snap.data()?.tempo_inscricoes : 0;
        return hoursToMs(v);
    }
    catch {
        return 0;
    }
}
async function getTempoBatalhasMs() {
    try {
        const snap = await adminSdk_1.db.collection("variables").doc("global").get();
        const v = snap.exists ? snap.data()?.tempo_batalhas : 0;
        return hoursToMs(v);
    }
    catch {
        return 0;
    }
}
async function scheduleIniciarDisputaJob(ginasioId, disputaId, opts) {
    const delay = typeof opts?.delayMs === "number" ? opts.delayMs : await getTempoInscricoesMs();
    const runAtMs = Date.now() + Math.max(0, delay);
    const origem = opts?.origem ?? "auto_from_criar_disputa";
    const batch = adminSdk_1.db.batch();
    batch.set(adminSdk_1.db.collection("jobs_disputas").doc(), {
        acao: "iniciar_disputa",
        status: "pendente",
        ginasio_id: ginasioId,
        disputa_id: disputaId,
        origem,
        runAtMs,
        createdAt: adminSdk_1.FieldValue.serverTimestamp(),
    });
    batch.set(adminSdk_1.db.doc(`disputas_ginasio/${disputaId}`), { nextStartAtMs: runAtMs }, { merge: true });
    await batch.commit();
    return runAtMs;
}
async function scheduleEncerrarDisputaJob(ginasioId, disputaId, opts) {
    const delay = typeof opts?.delayMs === "number" ? opts.delayMs : await getTempoBatalhasMs();
    const runAtMs = Date.now() + Math.max(0, delay);
    const origem = opts?.origem ?? "auto_from_iniciar_disputa";
    const batch = adminSdk_1.db.batch();
    batch.set(adminSdk_1.db.collection("jobs_disputas").doc(), {
        acao: "encerrar_disputa",
        status: "pendente",
        ginasio_id: ginasioId,
        disputa_id: disputaId,
        origem,
        runAtMs,
        createdAt: adminSdk_1.FieldValue.serverTimestamp(),
    });
    batch.set(adminSdk_1.db.doc(`disputas_ginasio/${disputaId}`), { nextEndAtMs: runAtMs }, { merge: true });
    await batch.commit();
    return runAtMs;
}
// ===== PROCESSADORES DE JOB ===================================================
async function processCriarDisputaJob(job) {
    console.log("Processando job CRIAR_DISPUTA", job);
    if (!job.ginasio_id)
        throw new Error("Job sem ginasio_id");
    const gRef = adminSdk_1.db.collection("ginasios").doc(job.ginasio_id);
    const gSnap = await gRef.get();
    if (!gSnap.exists) {
        console.warn("Ginásio não encontrado, ignorando job", job.ginasio_id);
        return;
    }
    const g = gSnap.data();
    const dSnap = await adminSdk_1.db
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
    const novaDisputaRef = await adminSdk_1.db.collection("disputas_ginasio").add({
        ginasio_id: job.ginasio_id,
        status: "inscricoes",
        tipo_original: tipoOriginal,
        lider_anterior_uid: liderAnterior,
        temporada_id: temporadaId,
        temporada_nome: temporadaNome,
        liga,
        origem: job.origem || "job_cloud",
        createdAt: adminSdk_1.FieldValue.serverTimestamp(),
    });
    console.log("Disputa criada via job:", novaDisputaRef.id);
    await gRef.update({ em_disputa: true });
    await scheduleIniciarDisputaJob(job.ginasio_id, novaDisputaRef.id);
}
async function processIniciarDisputaJob(job) {
    console.log("Processando job INICIAR_DISPUTA", job);
    if (!job.ginasio_id)
        throw new Error("Job sem ginasio_id");
    let disputaRef = null;
    let disputaData = null;
    if (job.disputa_id) {
        const snap = await adminSdk_1.db.collection("disputas_ginasio").doc(job.disputa_id).get();
        if (!snap.exists) {
            console.warn("Disputa do job não existe mais, ignorando.", job.disputa_id);
            return;
        }
        disputaRef = snap.ref;
        disputaData = snap.data();
    }
    else {
        const ds = await adminSdk_1.db
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
        disputaData = ds.docs[0].data();
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
    const partSnap0 = await adminSdk_1.db
        .collection("disputas_ginasio_participantes")
        .where("disputa_id", "==", disputaId)
        .get();
    const batch1 = adminSdk_1.db.batch();
    for (const pDoc of partSnap0.docs) {
        const d = pDoc.data();
        if (!d.tipo_escolhido || d.tipo_escolhido === "") {
            batch1.update(pDoc.ref, { removido: true });
        }
    }
    await batch1.commit();
    const partSnap = await adminSdk_1.db
        .collection("disputas_ginasio_participantes")
        .where("disputa_id", "==", disputaId)
        .get();
    const validos = partSnap.docs
        .map((p) => p.data())
        .filter((d) => !d.removido && d.tipo_escolhido && d.tipo_escolhido !== "").length;
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
        iniciadaEm: adminSdk_1.FieldValue.serverTimestamp(),
    });
    await disputaRef.set({ nextStartAtMs: adminSdk_1.FieldValue.delete() }, { merge: true });
    await scheduleEncerrarDisputaJob(job.ginasio_id, disputaId);
    console.log("Disputa iniciada via job:", disputaId);
}
async function processEncerrarDisputaJob(job) {
    console.log("Processando job ENCERRAR_DISPUTA", job);
    const { ginasio_id, disputa_id } = job;
    const baseFail = (reason, meta = {}) => ({
        changed: false,
        reason,
        meta,
    });
    if (!ginasio_id || !disputa_id)
        throw new Error("Job sem ginasio_id/disputa_id");
    const dRef = adminSdk_1.db.collection("disputas_ginasio").doc(disputa_id);
    const dSnap = await dRef.get();
    if (!dSnap.exists)
        return baseFail("disputa_inexistente");
    const disputa = dSnap.data();
    const statusNorm = (disputa.status || "").toString().trim().toLowerCase();
    if (statusNorm !== "batalhando") {
        return baseFail("status_finalizado_nao_batalhando", { currentStatus: disputa.status });
    }
    const gRef = adminSdk_1.db.collection("ginasios").doc(ginasio_id);
    const gSnap = await gRef.get();
    const g = gSnap.exists ? gSnap.data() : {};
    const partSnap = await adminSdk_1.db
        .collection("disputas_ginasio_participantes")
        .where("disputa_id", "==", disputa_id)
        .get();
    const participantes = partSnap.docs
        .map((p) => {
        const d = p.data();
        if (d.removido)
            return null;
        return {
            usuario_uid: d.usuario_uid,
            tipo_escolhido: d.tipo_escolhido || "",
        };
    })
        .filter((p) => p !== null);
    if (participantes.length === 0) {
        await dRef.update({
            status: "finalizado",
            encerradaEm: adminSdk_1.FieldValue.serverTimestamp(),
            vencedor_uid: null,
            sem_vencedor: true,
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: false });
        await adminSdk_1.db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        await dRef.set({ nextEndAtMs: adminSdk_1.FieldValue.delete() }, { merge: true });
        return { changed: true, reason: "sem_participantes", meta: { participantes: 0 }, finalStatus: "finalizado" };
    }
    const resAllSnap = await adminSdk_1.db
        .collection("disputas_ginasio_resultados")
        .where("disputa_id", "==", disputa_id)
        .get();
    const grupos = {};
    resAllSnap.docs.forEach((rDoc) => {
        const d = rDoc.data();
        const tipoLower = (typeof d.tipo === "string" ? d.tipo : "").toString().trim().toLowerCase();
        if (tipoLower === "empate")
            return;
        const a = d.vencedor_uid;
        const b = d.perdedor_uid;
        if (!a || !b)
            return;
        const key = [a, b].sort().join("__");
        if (!grupos[key])
            grupos[key] = [];
        grupos[key].push({ id: rDoc.id, data: d });
    });
    const woTargets = [];
    const woUpdates = [];
    Object.values(grupos).forEach((lista) => {
        const pendentes = lista.filter((r) => (r.data.status || "pendente") === "pendente");
        const confirmados = lista.filter((r) => r.data.status === "confirmado");
        if (confirmados.length > 0)
            return;
        if (pendentes.length === 1) {
            const r = pendentes[0];
            woTargets.push(r.id);
            woUpdates.push(adminSdk_1.db.collection("disputas_ginasio_resultados").doc(r.id).update({
                status: "confirmado",
                confirmadoPorWoAutomatico: true,
                confirmadoPorWoEm: adminSdk_1.FieldValue.serverTimestamp(),
            }));
        }
    });
    if (woUpdates.length > 0)
        await Promise.all(woUpdates);
    const resSnap = await adminSdk_1.db
        .collection("disputas_ginasio_resultados")
        .where("disputa_id", "==", disputa_id)
        .where("status", "==", "confirmado")
        .get();
    if (resSnap.empty) {
        await dRef.update({
            status: "finalizado",
            encerradaEm: adminSdk_1.FieldValue.serverTimestamp(),
            vencedor_uid: null,
            sem_vencedor: true,
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: false });
        await adminSdk_1.db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        await dRef.set({ nextEndAtMs: adminSdk_1.FieldValue.delete() }, { merge: true });
        return {
            changed: true,
            reason: "sem_resultados_confirmados",
            meta: { participantes: participantes.length, woConfirmados: woTargets },
            finalStatus: "finalizado",
        };
    }
    const pontos = {};
    participantes.forEach((p) => (pontos[p.usuario_uid] = 0));
    const confirmadosIds = [];
    resSnap.docs.forEach((rDoc) => {
        confirmadosIds.push(rDoc.id);
        const r = rDoc.data();
        const tipoLower = (typeof r.tipo === "string" ? r.tipo : "").toString().trim().toLowerCase();
        if (tipoLower === "empate") {
            const j1 = r.jogador1_uid;
            const j2 = r.jogador2_uid;
            if (j1)
                pontos[j1] = (pontos[j1] || 0) + 1;
            if (j2)
                pontos[j2] = (pontos[j2] || 0) + 1;
        }
        else {
            const vUid = r.vencedor_uid;
            if (vUid)
                pontos[vUid] = (pontos[vUid] || 0) + 3;
        }
    });
    let maior = -1;
    Object.keys(pontos).forEach((uid) => {
        if (pontos[uid] > maior)
            maior = pontos[uid];
    });
    if (maior <= 0) {
        await dRef.update({
            status: "finalizado",
            encerradaEm: adminSdk_1.FieldValue.serverTimestamp(),
            vencedor_uid: null,
            sem_vencedor: true,
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: false });
        await adminSdk_1.db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        await dRef.set({ nextEndAtMs: adminSdk_1.FieldValue.delete() }, { merge: true });
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
            encerradaEm: adminSdk_1.FieldValue.serverTimestamp(),
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: false });
        await adminSdk_1.db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        await dRef.set({ nextEndAtMs: adminSdk_1.FieldValue.delete() }, { merge: true });
        return {
            changed: true,
            reason: "ginasio_ja_tem_lider",
            meta: { lider_uid: g.lider_uid, maior, empatados, confirmadosIds },
            finalStatus: "finalizado",
        };
    }
    if (empatados.length > 1) {
        const novaRef = await adminSdk_1.db.collection("disputas_ginasio").add({
            ginasio_id,
            status: "inscricoes",
            tipo_original: disputa.tipo_original || g.tipo || "",
            lider_anterior_uid: disputa.lider_anterior_uid || g.lider_uid || "",
            reaberta_por_empate: true,
            temporada_id: disputa.temporada_id || "",
            temporada_nome: disputa.temporada_nome || "",
            liga: disputa.liga || disputa.liga_nome || g.liga || g.liga_nome || "",
            origem: "empate",
            createdAt: adminSdk_1.FieldValue.serverTimestamp(),
        });
        const novaId = novaRef.id;
        const batchPart = adminSdk_1.db.batch();
        for (const uid of empatados) {
            const partOrig = participantes.find((p) => p.usuario_uid === uid);
            batchPart.set(adminSdk_1.db.collection("disputas_ginasio_participantes").doc(), {
                disputa_id: novaId,
                ginasio_id,
                usuario_uid: uid,
                tipo_escolhido: partOrig?.tipo_escolhido || disputa.tipo_original || g.tipo || "",
                createdAt: adminSdk_1.FieldValue.serverTimestamp(),
            });
        }
        await batchPart.commit();
        await dRef.update({
            status: "finalizado",
            encerradaEm: adminSdk_1.FieldValue.serverTimestamp(),
            vencedor_uid: null,
            empate_no_topo: true,
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: true });
        await adminSdk_1.db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        await dRef.set({ nextEndAtMs: adminSdk_1.FieldValue.delete() }, { merge: true });
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
    const abertas = await adminSdk_1.db
        .collection("ginasios_liderancas")
        .where("ginasio_id", "==", ginasio_id)
        .where("fim", "==", null)
        .get();
    const nowMs = Date.now();
    const batch = adminSdk_1.db.batch();
    for (const l of abertas.docs) {
        batch.update(l.ref, { fim: nowMs });
    }
    batch.set(adminSdk_1.db.collection("ginasios_liderancas").doc(), {
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
        encerradaEm: adminSdk_1.FieldValue.serverTimestamp(),
        vencedor_uid: vencedorUid,
        finalizacao_aplicada: true,
    });
    await adminSdk_1.db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
    await dRef.set({ nextEndAtMs: adminSdk_1.FieldValue.delete() }, { merge: true });
    return {
        changed: true,
        reason: "vencedor_definido",
        meta: { vencedorUid, tipoDoVencedor },
        finalStatus: "finalizado",
    };
}
// ---- CRON: processDisputeJobs ------------------------------------------------
exports.processDisputeJobs = (0, scheduler_1.onSchedule)({ schedule: "every 5 minutes", timeZone: "America/Sao_Paulo", region: "southamerica-east1", maxInstances: 1 }, async () => {
    const now = Date.now();
    const jobsSnap = await adminSdk_1.db
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
        const job = jobDoc.data();
        await jobDoc.ref.update({
            status: "executando",
            startedAt: adminSdk_1.FieldValue.serverTimestamp(),
        });
        try {
            if (job.acao === "criar_disputa") {
                await processCriarDisputaJob(job);
                await jobDoc.ref.update({
                    status: "executado",
                    executedAt: adminSdk_1.FieldValue.serverTimestamp(),
                });
            }
            else if (job.acao === "iniciar_disputa") {
                await processIniciarDisputaJob(job);
                await jobDoc.ref.update({
                    status: "executado",
                    executedAt: adminSdk_1.FieldValue.serverTimestamp(),
                });
            }
            else if (job.acao === "encerrar_disputa") {
                const result = await processEncerrarDisputaJob(job);
                await jobDoc.ref.update({
                    status: "executado",
                    executedAt: adminSdk_1.FieldValue.serverTimestamp(),
                    noOp: !result.changed,
                    resultReason: result.reason,
                    debug: result.meta,
                    finalStatus: result.finalStatus ?? adminSdk_1.FieldValue.delete(),
                });
            }
            else {
                await jobDoc.ref.update({
                    status: "erro",
                    errorMessage: `acao_desconhecida: ${job.acao}`,
                    executedAt: adminSdk_1.FieldValue.serverTimestamp(),
                });
            }
        }
        catch (e) {
            await jobDoc.ref.update({
                status: "erro",
                errorMessage: (e?.message || String(e)).slice(0, 500),
                executedAt: adminSdk_1.FieldValue.serverTimestamp(),
            });
        }
    }
});
