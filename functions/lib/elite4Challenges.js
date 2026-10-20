"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processExpiredElite4Challenges = exports.adminResolveElite4Challenge = exports.claimElite4Walkover = exports.reportElite4ChallengeResult = exports.acceptElite4Challenge = exports.createElite4Challenge = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const adminSdk_1 = require("./adminSdk");
const REGION = "southamerica-east1";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE = new Set(["pendente", "aceito", "resultado_parcial"]);
const RESOLVABLE = new Set([...ACTIVE, "contestado", "contestado_expirado"]);
const number = (v) => Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0;
function rank(a, b) {
    const x = a.data(), y = b.data();
    return number(y.pontos) - number(x.pontos) || number(y.pontos_vitoria) - number(x.pontos_vitoria) ||
        number(y.pontos_participacao) - number(x.pontos_participacao) ||
        String(x.nome || a.id).localeCompare(String(y.nome || b.id), "pt-BR") || a.id.localeCompare(b.id);
}
async function verificarSuper(uid) {
    if (!(await adminSdk_1.db.doc(`superusers/${uid}`).get()).exists)
        throw new https_1.HttpsError("permission-denied", "Apenas administradores podem resolver resultados contestados.");
}
exports.createElite4Challenge = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Faça login para desafiar.");
    const targetUid = String(request.data?.targetUid || "");
    if (!targetUid || targetUid === uid || targetUid.includes("/"))
        throw new https_1.HttpsError("invalid-argument", "Escolha um adversário válido.");
    return adminSdk_1.db.runTransaction(async (tx) => {
        const camps = await tx.get(adminSdk_1.db.collection("campeonatos_elite4").where("liga", "==", String(request.data?.liga || "")).where("status", "==", "aberto").orderBy("createdAt", "desc").limit(1));
        if (camps.empty)
            throw new https_1.HttpsError("failed-precondition", "Não há uma classificação aberta nesta liga.");
        const camp = camps.docs[0];
        const league = String(camp.get("liga") || "");
        const [participants, elites, challenges, currentUser, targetUser] = await Promise.all([
            tx.get(camp.ref.collection("participantes")),
            tx.get(adminSdk_1.db.collection("elite4").where("liga", "==", league)),
            tx.get(adminSdk_1.db.collection("desafios_elite4").where("campeonato_id", "==", camp.id)),
            tx.get(adminSdk_1.db.doc(`usuarios/${uid}`)), tx.get(adminSdk_1.db.doc(`usuarios/${targetUid}`)),
        ]);
        const myPart = participants.docs.find((p) => p.id === uid);
        const targetPart = participants.docs.find((p) => p.id === targetUid);
        if (!myPart || !targetPart)
            throw new https_1.HttpsError("failed-precondition", "Os dois jogadores precisam estar na classificação desta liga.");
        const myData = myPart.data(), targetData = targetPart.data();
        const eliteTarget = elites.docs.find((e) => e.get("uid") === targetUid);
        const eliteChallenger = elites.docs.find((e) => e.get("uid") === uid);
        const leaders = participants.docs.filter((p) => p.data().tipo_participante !== "elite4" && p.data().optou_participar === true).sort(rank);
        const myIsLeader = myData.tipo_participante !== "elite4" && myData.optou_participar === true;
        const targetIsLeader = targetData.tipo_participante !== "elite4" && targetData.optou_participar === true;
        let challengerRole;
        let targetRole;
        if (myIsLeader && targetIsLeader) {
            if (!leaders.slice(0, 4).some((p) => p.id === targetUid))
                throw new https_1.HttpsError("failed-precondition", "Líderes podem desafiar somente um dos quatro líderes mais bem colocados.");
            challengerRole = "lider";
            targetRole = "lider";
        }
        else if (myIsLeader && eliteTarget && targetData.tipo_participante === "elite4") {
            if (leaders[0]?.id !== uid)
                throw new https_1.HttpsError("failed-precondition", "Só o líder com mais pontos pode desafiar a Elite 4.");
            challengerRole = "lider";
            targetRole = "elite4";
        }
        else if (eliteChallenger && targetIsLeader) {
            if (!leaders.slice(0, 4).some((p) => p.id === targetUid))
                throw new https_1.HttpsError("failed-precondition", "A Elite 4 pode desafiar somente um dos quatro líderes mais bem colocados.");
            challengerRole = "elite4";
            targetRole = "lider";
        }
        else {
            throw new https_1.HttpsError("permission-denied", "Esta combinação de desafiante e adversário não é permitida.");
        }
        const inProgress = challenges.docs.filter((d) => ACTIVE.has(String(d.get("status"))));
        if (inProgress.some((d) => [d.get("challenger_uid"), d.get("target_uid")].includes(uid) || [d.get("challenger_uid"), d.get("target_uid")].includes(targetUid))) {
            throw new https_1.HttpsError("failed-precondition", "Um dos treinadores já tem um desafio da Elite 4 em andamento.");
        }
        const pair = new Set([uid, targetUid]);
        if (challenges.docs.some((d) => pair.has(String(d.get("challenger_uid"))) && pair.has(String(d.get("target_uid"))))) {
            throw new https_1.HttpsError("already-exists", "Esses treinadores já se desafiaram nesta disputa.");
        }
        const challengeRef = adminSdk_1.db.collection("desafios_elite4").doc();
        const createdAtMs = Date.now();
        const e4Uid = challengerRole === "elite4" ? uid : targetUid;
        tx.create(challengeRef, {
            campeonato_id: camp.id, liga: league,
            challenger_uid: uid, challenger_nome: String(currentUser.get("nome") || currentUser.get("nick") || uid), challenger_role: challengerRole,
            target_uid: targetUid, target_nome: String(targetUser.get("nome") || targetUser.get("nick") || targetUid), target_role: targetRole,
            elite4_uid: e4Uid, status: "pendente", reports: {},
            challenger_pontos_inicio: number(myData.pontos), target_pontos_inicio: number(targetData.pontos),
            created_at_ms: createdAtMs, deadline_at_ms: createdAtMs + WEEK_MS,
        });
        return { ok: true, challengeId: challengeRef.id, deadlineAtMs: createdAtMs + WEEK_MS };
    });
});
exports.acceptElite4Challenge = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Faça login.");
    const id = String(request.data?.challengeId || "");
    if (!id || id.includes("/"))
        throw new https_1.HttpsError("invalid-argument", "Desafio inválido.");
    return adminSdk_1.db.runTransaction(async (tx) => {
        const ref = adminSdk_1.db.doc(`desafios_elite4/${id}`);
        const challenge = await tx.get(ref);
        if (!challenge.exists || challenge.get("target_uid") !== uid)
            throw new https_1.HttpsError("permission-denied", "Somente o adversário pode aceitar este desafio.");
        if (challenge.get("status") !== "pendente" || Date.now() > number(challenge.get("deadline_at_ms")))
            throw new https_1.HttpsError("deadline-exceeded", "O prazo para aceitar este desafio terminou.");
        tx.update(ref, { status: "aceito", aceito_em_ms: Date.now() });
        return { ok: true };
    });
});
async function finalizarResultado(tx, challenge, ref, winnerUid, method, callerUid) {
    if (!challenge.exists || ![challenge.get("challenger_uid"), challenge.get("target_uid")].includes(winnerUid))
        throw new https_1.HttpsError("invalid-argument", "O vencedor não faz parte deste desafio.");
    const challengerUid = String(challenge.get("challenger_uid"));
    const targetUid = String(challenge.get("target_uid"));
    const eventId = String(challenge.get("campeonato_id"));
    const loserUid = winnerUid === challengerUid ? targetUid : challengerUid;
    const winnerRef = adminSdk_1.db.doc(`campeonatos_elite4/${eventId}/participantes/${winnerUid}`);
    const loserRef = adminSdk_1.db.doc(`campeonatos_elite4/${eventId}/participantes/${loserUid}`);
    const e4Uid = String(challenge.get("elite4_uid"));
    const userRef = adminSdk_1.db.doc(`usuarios/${e4Uid}`);
    const pointsLogRef = adminSdk_1.db.doc(`campeonatos_elite4_pontuacoes/desafio_${challenge.id}`);
    const ppLogRef = adminSdk_1.db.doc(`pp_logs/elite4_desafio_${challenge.id}`);
    const [winner, loser, eliteUser, pointsLog, ppLog] = await Promise.all([
        tx.get(winnerRef), tx.get(loserRef), tx.get(userRef), tx.get(pointsLogRef), tx.get(ppLogRef),
    ]);
    if (!winner.exists || !loser.exists)
        throw new https_1.HttpsError("failed-precondition", "A pontuação de um dos jogadores não está disponível.");
    const status = String(challenge.get("status"));
    if (status === "finalizado")
        return { ok: true, jaFinalizado: true };
    if (!RESOLVABLE.has(status))
        throw new https_1.HttpsError("failed-precondition", "Este desafio não pode mais ser encerrado.");
    const transfer = number(loser.get("pontos"));
    const winnerData = winner.data() || {};
    const loserData = loser.data() || {};
    tx.update(winnerRef, {
        pontos: number(winnerData.pontos) + transfer,
        pontos_desafios: number(winnerData.pontos_desafios) + transfer,
        updatedAt: Date.now(),
    });
    tx.update(loserRef, {
        pontos: 0, pontos_participacao: 0, pontos_vitoria: 0, pontos_admin: 0, pontos_desafios: 0,
        updatedAt: Date.now(),
    });
    if (!pointsLog.exists)
        tx.create(pointsLogRef, {
            campeonato_id: eventId, desafio_id: challenge.id, liga: challenge.get("liga"),
            usuario_uid: winnerUid, adversario_uid: loserUid, quantidade: transfer,
            motivo: method === "wo" ? "vitoria_elite4_wo_transferencia_pontos" : method === "concessao" ? "vitoria_elite4_concessao_transferencia_pontos" : "vitoria_elite4_transferencia_pontos",
            createdAt: Date.now(),
        });
    const awardedPP = method === "batalha" && !ppLog.exists;
    if (awardedPP) {
        if (!eliteUser.exists)
            throw new https_1.HttpsError("not-found", "Perfil do Elite 4 não encontrado.");
        tx.update(userRef, { pontosPresenca: adminSdk_1.FieldValue.increment(10) });
        tx.create(ppLogRef, { userId: e4Uid, tipo: "desafio_elite4", desafioId: challenge.id, liga: challenge.get("liga"), createdAt: adminSdk_1.FieldValue.serverTimestamp(), quantidade: 10 });
    }
    tx.update(ref, {
        status: "finalizado", winner_uid: winnerUid, loser_uid: loserUid, metodo_resultado: method,
        pontos_transferidos: transfer, finalized_at_ms: Date.now(), finalized_by: callerUid,
        elite4_pp_atribuido: awardedPP,
    });
    return { ok: true, winnerUid, loserUid, pontosTransferidos: transfer, elite4PP: awardedPP ? 10 : 0 };
}
exports.reportElite4ChallengeResult = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Faça login.");
    const id = String(request.data?.challengeId || "");
    const winnerUid = String(request.data?.winnerUid || "");
    if (!id || id.includes("/") || !winnerUid)
        throw new https_1.HttpsError("invalid-argument", "Informe o desafio e o vencedor.");
    return adminSdk_1.db.runTransaction(async (tx) => {
        const ref = adminSdk_1.db.doc(`desafios_elite4/${id}`);
        const challenge = await tx.get(ref);
        if (!challenge.exists || ![challenge.get("challenger_uid"), challenge.get("target_uid")].includes(uid))
            throw new https_1.HttpsError("permission-denied", "Você não participa deste desafio.");
        if (!["pendente", "aceito", "resultado_parcial"].includes(String(challenge.get("status"))))
            throw new https_1.HttpsError("failed-precondition", "Este desafio não está mais aberto para resultado.");
        if (Date.now() > number(challenge.get("deadline_at_ms")))
            throw new https_1.HttpsError("deadline-exceeded", "O prazo de uma semana expirou. O desafiante pode pedir W.O.");
        if (![challenge.get("challenger_uid"), challenge.get("target_uid")].includes(winnerUid))
            throw new https_1.HttpsError("invalid-argument", "O vencedor deve ser um dos dois participantes.");
        const reports = { ...(challenge.get("reports") || {}), [uid]: winnerUid };
        const challengerReport = reports[String(challenge.get("challenger_uid"))];
        const targetReport = reports[String(challenge.get("target_uid"))];
        if (!challengerReport || !targetReport) {
            tx.update(ref, { reports, status: "resultado_parcial", updated_at_ms: Date.now() });
            return { ok: true, status: "resultado_parcial" };
        }
        if (challengerReport !== targetReport) {
            tx.update(ref, { reports, status: "contestado", updated_at_ms: Date.now() });
            return { ok: true, status: "contestado" };
        }
        return finalizarResultado(tx, challenge, ref, challengerReport, "batalha", uid);
    });
});
exports.claimElite4Walkover = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Faça login.");
    const id = String(request.data?.challengeId || "");
    if (!id || id.includes("/"))
        throw new https_1.HttpsError("invalid-argument", "Desafio inválido.");
    return adminSdk_1.db.runTransaction(async (tx) => {
        const ref = adminSdk_1.db.doc(`desafios_elite4/${id}`);
        const challenge = await tx.get(ref);
        if (!challenge.exists || challenge.get("challenger_uid") !== uid)
            throw new https_1.HttpsError("permission-denied", "Somente quem iniciou o desafio pode pedir W.O.");
        if (!ACTIVE.has(String(challenge.get("status"))))
            throw new https_1.HttpsError("failed-precondition", "Este desafio já foi encerrado.");
        if (Date.now() < number(challenge.get("deadline_at_ms")))
            throw new https_1.HttpsError("failed-precondition", "O prazo de uma semana ainda não terminou.");
        const challengerReport = (challenge.get("reports") || {})[uid];
        if (challengerReport !== uid)
            throw new https_1.HttpsError("failed-precondition", "Para pedir W.O., registre primeiro sua vitória. O encerramento automático também verificará os relatos ao fim do prazo.");
        const targetReport = (challenge.get("reports") || {})[String(challenge.get("target_uid"))];
        if (targetReport)
            throw new https_1.HttpsError("failed-precondition", "O adversário já declarou um resultado. Um administrador precisa resolver o registro.");
        return finalizarResultado(tx, challenge, ref, uid, "wo", uid);
    });
});
exports.adminResolveElite4Challenge = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Faça login.");
    await verificarSuper(uid);
    const id = String(request.data?.challengeId || "");
    const winnerUid = String(request.data?.winnerUid || "");
    if (!id || id.includes("/") || !winnerUid)
        throw new https_1.HttpsError("invalid-argument", "Informe o desafio e o vencedor.");
    return adminSdk_1.db.runTransaction(async (tx) => {
        const ref = adminSdk_1.db.doc(`desafios_elite4/${id}`);
        const challenge = await tx.get(ref);
        if (!challenge.exists || !["contestado", "contestado_expirado"].includes(String(challenge.get("status"))))
            throw new https_1.HttpsError("failed-precondition", "Só é possível resolver resultados contestados.");
        return finalizarResultado(tx, challenge, ref, winnerUid, "batalha", uid);
    });
});
/** Encerra cada desafio da Elite 4 uma semana após sua criação, sem depender de ação manual. */
exports.processExpiredElite4Challenges = (0, scheduler_1.onSchedule)({ schedule: "0 0 * * *", timeZone: "America/Sao_Paulo", region: REGION, maxInstances: 1 }, async () => {
    const now = Date.now();
    const snapshot = await adminSdk_1.db.collection("desafios_elite4")
        .where("status", "in", [...ACTIVE, "contestado"]).get();
    for (const item of snapshot.docs) {
        await adminSdk_1.db.runTransaction(async (tx) => {
            const ref = item.ref;
            const challenge = await tx.get(ref);
            if (!challenge.exists)
                return;
            const status = String(challenge.get("status"));
            if (![...ACTIVE, "contestado"].includes(status))
                return;
            const created = number(challenge.get("created_at_ms")) || number(challenge.get("deadline_at_ms")) - WEEK_MS;
            const deadline = number(challenge.get("deadline_at_ms")) || created + WEEK_MS;
            if (!created || now < deadline)
                return;
            if (status === "contestado") {
                tx.update(ref, { status: "contestado_expirado", metodo_resultado: "divergencia_sem_resolucao_no_prazo", finalized_at_ms: now });
                return;
            }
            const reports = (challenge.get("reports") || {});
            const challengerUid = String(challenge.get("challenger_uid") || "");
            const targetUid = String(challenge.get("target_uid") || "");
            const challengerReport = reports[challengerUid];
            const targetReport = reports[targetUid];
            if (challengerReport && targetReport && challengerReport !== targetReport) {
                tx.update(ref, { status: "contestado_expirado", metodo_resultado: "divergencia_sem_resolucao_no_prazo", finalized_at_ms: now });
                return;
            }
            if (!challengerReport && !targetReport) {
                tx.update(ref, { status: "finalizado", winner_uid: null, loser_uid: null, pontos_transferidos: 0,
                    metodo_resultado: "sem_resultado", finalized_at_ms: now, finalized_by: "expiracao_automatica" });
                return;
            }
            const reporterUid = challengerReport ? challengerUid : targetUid;
            const winnerUid = challengerReport || targetReport;
            const method = challengerReport && targetReport ? "batalha" : winnerUid === reporterUid ? "wo" : "concessao";
            await finalizarResultado(tx, challenge, ref, winnerUid, method, "expiracao_automatica");
        });
    }
});
