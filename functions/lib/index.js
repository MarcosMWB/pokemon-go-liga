"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDisputeJobs = exports.onResultadoWrite = void 0;
// functions/src/index.ts
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
admin.initializeApp();
const db = admin.firestore();
/**
 * TRIGGER DE FIRESTORE:
 * dispara em qualquer write em disputas_ginasio_resultados/{resultadoId}
 */
exports.onResultadoWrite = (0, firestore_1.onDocumentWritten)({
    document: "disputas_ginasio_resultados/{resultadoId}",
    region: "southamerica-east1",
}, async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    const base = after !== null && after !== void 0 ? after : before;
    if (!base)
        return;
    const disputaId = ((_e = after === null || after === void 0 ? void 0 : after.disputa_id) !== null && _e !== void 0 ? _e : before === null || before === void 0 ? void 0 : before.disputa_id);
    const ginasioId = ((_f = after === null || after === void 0 ? void 0 : after.ginasio_id) !== null && _f !== void 0 ? _f : before === null || before === void 0 ? void 0 : before.ginasio_id);
    if (!disputaId || !ginasioId)
        return;
    // Se a disputa já não está em andamento, resolva/oculte alerta e saia
    const disputaSnap = await db.doc(`disputas_ginasio/${disputaId}`).get();
    if (!disputaSnap.exists)
        return;
    const disputa = disputaSnap.data();
    if (!["batalhando", "inscricoes"].includes((disputa.status || "").toString().trim().toLowerCase())) {
        await db
            .doc(`admin_alertas/disputa_${disputaId}_ready`)
            .set({
            status: "resolvido",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
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
        const g = gSnap.exists ? gSnap.data() : {};
        await alertRef.set({
            type: "disputa_pronta_para_encerrar",
            disputa_id: disputaId,
            ginasio_id: ginasioId,
            ginasio_nome: (g === null || g === void 0 ? void 0 : g.nome) || ginasioId,
            liga: (g === null || g === void 0 ? void 0 : g.liga) || (g === null || g === void 0 ? void 0 : g.liga_nome) || "",
            status: "novo",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    else {
        // Voltou a ter pendências → esconder/fechar alerta
        await alertRef.set({
            status: "resolvido",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
});
/**
 * ===== HELPERS PARA OS JOBS DE DISPUTA (CRON) =====
 */
// lê tempo_inscricoes em horas de variables/global e devolve em ms
async function getTempoInscricoesMs() {
    try {
        const snap = await db.collection("variables").doc("global").get();
        if (!snap.exists)
            return 0;
        const data = snap.data();
        const raw = toHours(data === null || data === void 0 ? void 0 : data.tempo_inscricoes);
        const horas = typeof raw === "number" ? raw : raw != null ? Number(raw) : 0;
        if (!isNaN(horas) && horas > 0) {
            return horas * 60 * 60 * 1000;
        }
        return 0;
    }
    catch (e) {
        console.warn("Falha ao ler variables/global.tempo_inscricoes", e);
        return 0;
    }
}
async function scheduleIniciarDisputaJob(ginasioId, disputaId) {
    const tempoMs = await getTempoInscricoesMs();
    const runAtMs = Date.now() + (tempoMs > 0 ? tempoMs : 0);
    await db.collection("jobs_disputas").add({
        acao: "iniciar_disputa",
        status: "pendente",
        ginasio_id: ginasioId,
        disputa_id: disputaId,
        origem: "auto_from_criar_disputa",
        runAtMs,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Job INICIAR_DISPUTA agendado para ${runAtMs} (em ${tempoMs} ms) para disputa ${disputaId}`);
}
/** ===== tempo de batalhas + agendamento do encerramento ===== */
async function getTempoBatalhasMs() {
    try {
        const snap = await db.collection("variables").doc("global").get();
        if (!snap.exists)
            return 0;
        const data = snap.data();
        const raw = toHours(data === null || data === void 0 ? void 0 : data.tempo_batalhas);
        const horas = typeof raw === "number" ? raw : raw != null ? Number(raw) : 0;
        if (!isNaN(horas) && horas > 0) {
            return horas * 60 * 60 * 1000;
        }
        return 0;
    }
    catch (e) {
        console.warn("Falha ao ler variables/global.tempo_batalhas", e);
        return 0;
    }
}
function toHours(raw) {
    if (typeof raw === "number")
        return raw;
    if (typeof raw === "string") {
        const n = parseFloat(raw.trim().replace(",", "."));
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}
async function scheduleEncerrarDisputaJob(ginasioId, disputaId) {
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
    console.log(`Job ENCERRAR_DISPUTA agendado para ${runAtMs} (em ${tempoMs} ms) para disputa ${disputaId}`);
}
/** ===== FIM DO BLOCO ===== */
async function processCriarDisputaJob(job) {
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
    const g = gSnap.data();
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
    await gRef.update({ em_disputa: true });
    // agenda automaticamente o job para INICIAR a disputa
    await scheduleIniciarDisputaJob(job.ginasio_id, novaDisputaRef.id);
}
async function processIniciarDisputaJob(job) {
    console.log("Processando job INICIAR_DISPUTA", job);
    if (!job.ginasio_id) {
        throw new Error("Job sem ginasio_id");
    }
    let disputaRef = null;
    let disputaData = null;
    if (job.disputa_id) {
        const snap = await db.collection("disputas_ginasio").doc(job.disputa_id).get();
        if (!snap.exists) {
            console.warn("Disputa do job não existe mais, ignorando.", job.disputa_id);
            return;
        }
        disputaRef = snap.ref;
        disputaData = snap.data();
    }
    else {
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
    // Marca como removidos os participantes sem tipo_escolhido
    const partSnap0 = await db
        .collection("disputas_ginasio_participantes")
        .where("disputa_id", "==", disputaId)
        .get();
    const batch1 = db.batch();
    for (const pDoc of partSnap0.docs) {
        const d = pDoc.data();
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
        .map((p) => p.data())
        .filter((d) => !d.removido && d.tipo_escolhido && d.tipo_escolhido !== "").length;
    if (validos < 2) {
        console.log(`Menos de 2 participantes válidos em ${disputaId}. Reagendando verificação.`);
        await db.collection("jobs_disputas").add({
            acao: "iniciar_disputa",
            status: "pendente",
            ginasio_id: job.ginasio_id,
            disputa_id: disputaId,
            origem: "retry_participantes",
            runAtMs: Date.now() + 60 * 60 * 1000, // +1h
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
    }
    await disputaRef.update({
        status: "batalhando",
        iniciadaEm: admin.firestore.FieldValue.serverTimestamp(),
    });
    // agenda encerramento após o período de batalhas
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
    if (!ginasio_id || !disputa_id) {
        throw new Error("Job sem ginasio_id/disputa_id");
    }
    const dRef = db.collection("disputas_ginasio").doc(disputa_id);
    const dSnap = await dRef.get();
    if (!dSnap.exists) {
        return baseFail("disputa_inexistente");
    }
    const disputa = dSnap.data();
    const statusNorm = (disputa.status || "").toString().trim().toLowerCase();
    // Só encerra automaticamente se ainda estiver batalhando
    if (statusNorm !== "batalhando") {
        return baseFail("status_finalizado_nao_batalhando", { currentStatus: disputa.status });
    }
    const gRef = db.collection("ginasios").doc(ginasio_id);
    const gSnap = await gRef.get();
    const g = gSnap.exists ? gSnap.data() : {};
    // 1) Participantes válidos
    const partSnap = await db
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
            encerradaEm: admin.firestore.FieldValue.serverTimestamp(),
            vencedor_uid: null,
            sem_vencedor: true,
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: false });
        await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        return { changed: true, reason: "sem_participantes", meta: { participantes: 0 }, finalStatus: "finalizado" };
    }
    // 2) WO automático por par: só para resultados NÃO "empate"
    const resAllSnap = await db
        .collection("disputas_ginasio_resultados")
        .where("disputa_id", "==", disputa_id)
        .get();
    const grupos = {};
    resAllSnap.docs.forEach((rDoc) => {
        const d = rDoc.data();
        const tipoLower = (typeof d.tipo === "string" ? d.tipo : "").toString().trim().toLowerCase();
        // nunca faz WO em "empate"
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
        // se já há algum confirmado entre o par, não mexe
        if (confirmados.length > 0)
            return;
        // Exatamente 1 pendente no par → confirma ele como WO
        if (pendentes.length === 1) {
            const r = pendentes[0];
            woTargets.push(r.id);
            woUpdates.push(db.collection("disputas_ginasio_resultados").doc(r.id).update({
                status: "confirmado",
                confirmadoPorWoAutomatico: true,
                confirmadoPorWoEm: admin.firestore.FieldValue.serverTimestamp(),
            }));
        }
    });
    if (woUpdates.length > 0) {
        await Promise.all(woUpdates);
    }
    // 3) Agora sim: resultados CONFIRMADOS para pontuar
    const resSnap = await db
        .collection("disputas_ginasio_resultados")
        .where("disputa_id", "==", disputa_id)
        .where("status", "==", "confirmado")
        .get();
    // Nenhum resultado confirmado → sem vencedor
    if (resSnap.empty) {
        await dRef.update({
            status: "finalizado",
            encerradaEm: admin.firestore.FieldValue.serverTimestamp(),
            vencedor_uid: null,
            sem_vencedor: true,
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: false });
        await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        return {
            changed: true,
            reason: "sem_resultados_confirmados",
            meta: { participantes: participantes.length, woConfirmados: woTargets },
            finalStatus: "finalizado",
        };
    }
    // Pontuação: 3 pontos vitória, 1 ponto empate
    const pontos = {};
    participantes.forEach((p) => (pontos[p.usuario_uid] = 0));
    const confirmadosCount = resSnap.size;
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
            if (vUid) {
                pontos[vUid] = (pontos[vUid] || 0) + 3;
            }
        }
    });
    let maior = -1;
    Object.keys(pontos).forEach((uid) => {
        if (pontos[uid] > maior)
            maior = pontos[uid];
    });
    // Se ninguém fez ponto (>0), trata como "sem vencedor"
    if (maior <= 0) {
        await dRef.update({
            status: "finalizado",
            encerradaEm: admin.firestore.FieldValue.serverTimestamp(),
            vencedor_uid: null,
            sem_vencedor: true,
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: false });
        await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        return {
            changed: true,
            reason: "todos_zero_ponto",
            meta: { participantes: participantes.length, confirmadosCount, confirmadosIds, woConfirmados: woTargets },
            finalStatus: "finalizado",
        };
    }
    const empatados = Object.keys(pontos).filter((uid) => pontos[uid] === maior);
    // Proteção: se o ginásio já tiver líder por algum motivo externo, não mexe
    if (g && g.lider_uid) {
        await dRef.update({
            status: "finalizado",
            encerradaEm: admin.firestore.FieldValue.serverTimestamp(),
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: false });
        await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        return {
            changed: true,
            reason: "ginasio_ja_tem_lider",
            meta: { lider_uid: g.lider_uid, maior, empatados, confirmadosCount, confirmadosIds },
            finalStatus: "finalizado",
        };
    }
    // 4) Empate no topo com pontuação > 0 → reabre nova disputa só com os empatados
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
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const novaId = novaRef.id;
        // Replica os empatados como participantes da nova disputa
        const batchPart = db.batch();
        for (const uid of empatados) {
            const partOrig = participantes.find((p) => p.usuario_uid === uid);
            batchPart.set(db.collection("disputas_ginasio_participantes").doc(), {
                disputa_id: novaId,
                ginasio_id,
                usuario_uid: uid,
                tipo_escolhido: (partOrig === null || partOrig === void 0 ? void 0 : partOrig.tipo_escolhido) || disputa.tipo_original || g.tipo || "",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await batchPart.commit();
        // Marca disputa atual como finalizada sem vencedor definido
        await dRef.update({
            status: "finalizado",
            encerradaEm: admin.firestore.FieldValue.serverTimestamp(),
            vencedor_uid: null,
            empate_no_topo: true,
            finalizacao_aplicada: true,
        });
        await gRef.update({ em_disputa: true });
        await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
        // Agenda automaticamente o início da nova disputa (respeitando tempo_inscricoes)
        await scheduleIniciarDisputaJob(ginasio_id, novaId);
        return {
            changed: true,
            reason: "empate_topo_reaberta",
            meta: { novaDisputaId: novaId, empatados, maior, confirmadosCount, confirmadosIds },
            finalStatus: "finalizado",
        };
    }
    // 5) Vencedor único
    const vencedorUid = empatados[0];
    const participanteVencedor = participantes.find((p) => p.usuario_uid === vencedorUid);
    const tipoDoVencedor = (participanteVencedor === null || participanteVencedor === void 0 ? void 0 : participanteVencedor.tipo_escolhido) || disputa.tipo_original || g.tipo || "";
    // Fecha lideranças abertas e cria nova liderança
    const abertas = await db
        .collection("ginasios_liderancas")
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
        origem: "disputa",
        disputa_id,
        liga: disputa.liga || disputa.liga_nome || g.liga || g.liga_nome || "",
        temporada_id: disputa.temporada_id || "",
        temporada_nome: disputa.temporada_nome || "",
        tipo_no_periodo: tipoDoVencedor,
    });
    await batch.commit();
    // Aplica no ginásio
    await gRef.update({
        lider_uid: vencedorUid,
        tipo: tipoDoVencedor,
        em_disputa: false,
        derrotas_seguidas: 0,
    });
    // Finaliza disputa
    await dRef.update({
        status: "finalizado",
        encerradaEm: admin.firestore.FieldValue.serverTimestamp(),
        vencedor_uid: vencedorUid,
        finalizacao_aplicada: true,
    });
    // Resolve alerta
    await db.doc(`admin_alertas/disputa_${disputa_id}_ready`).set({ status: "resolvido" }, { merge: true });
    return {
        changed: true,
        reason: "vencedor_definido",
        meta: { vencedorUid, tipoDoVencedor, confirmadosCount, confirmadosIds, maior },
        finalStatus: "finalizado",
    };
}
/** ===== FIM DO BLOCO ===== */
/**
 * FUNÇÃO AGENDADA – V2
 * Roda a cada 5 minutos e processa jobs em /jobs_disputas
 */
exports.processDisputeJobs = (0, scheduler_1.onSchedule)({
    schedule: "every 5 minutes",
    timeZone: "America/Sao_Paulo",
    region: "southamerica-east1",
}, async () => {
    var _a;
    const now = Date.now();
    const jobsSnap = await db
        .collection("jobs_disputas")
        .where("status", "==", "pendente")
        .limit(50)
        .get();
    const dueJobs = jobsSnap.docs.filter((doc) => {
        const data = doc.data();
        const runAtMs = typeof data.runAtMs === "number" ? data.runAtMs : 0;
        return runAtMs <= now;
    });
    if (dueJobs.length === 0) {
        console.log("Nenhum job pendente no horário.");
        return;
    }
    console.log(`Processando ${dueJobs.length} job(s) vencidos.`);
    for (const jobDoc of dueJobs) {
        const job = jobDoc.data();
        try {
            if (job.acao === "criar_disputa") {
                await processCriarDisputaJob(job);
                await jobDoc.ref.update({
                    status: "executado",
                    executedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            else if (job.acao === "iniciar_disputa") {
                await processIniciarDisputaJob(job);
                await jobDoc.ref.update({
                    status: "executado",
                    executedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            else if (job.acao === "encerrar_disputa") {
                const result = await processEncerrarDisputaJob(job); // objeto
                await jobDoc.ref.update({
                    status: "executado",
                    executedAt: admin.firestore.FieldValue.serverTimestamp(),
                    noOp: !result.changed,
                    resultReason: result.reason,
                    debug: result.meta,
                    finalStatus: (_a = result.finalStatus) !== null && _a !== void 0 ? _a : admin.firestore.FieldValue.delete(),
                });
            }
            else {
                await jobDoc.ref.update({
                    status: "erro",
                    errorMessage: `acao_desconhecida: ${job.acao}`,
                    executedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
        }
        catch (e) {
            await jobDoc.ref.update({
                status: "erro",
                errorMessage: ((e === null || e === void 0 ? void 0 : e.message) || String(e)).slice(0, 500),
                executedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
});
