import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, FieldValue } from "./adminSdk";

const REGION = "southamerica-east1";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE = new Set(["pendente", "aceito", "resultado_parcial", "contestado"]);
const number = (v: unknown) => Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0;

type Participant = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;
type ChallengeDoc = FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;

function rank(a: Participant, b: Participant) {
  const x = a.data(), y = b.data();
  return number(y.pontos) - number(x.pontos) || number(y.pontos_vitoria) - number(x.pontos_vitoria) ||
    number(y.pontos_participacao) - number(x.pontos_participacao) ||
    String(x.nome || a.id).localeCompare(String(y.nome || b.id), "pt-BR") || a.id.localeCompare(b.id);
}

async function verificarSuper(uid: string) {
  if (!(await db.doc(`superusers/${uid}`).get()).exists) throw new HttpsError("permission-denied", "Apenas administradores podem resolver resultados contestados.");
}

export const createElite4Challenge = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para desafiar.");
  const targetUid = String(request.data?.targetUid || "");
  if (!targetUid || targetUid === uid || targetUid.includes("/")) throw new HttpsError("invalid-argument", "Escolha um adversário válido.");

  return db.runTransaction(async (tx) => {
    const camps = await tx.get(db.collection("campeonatos_elite4").where("liga", "==", String(request.data?.liga || "")).where("status", "==", "aberto").orderBy("createdAt", "desc").limit(1));
    if (camps.empty) throw new HttpsError("failed-precondition", "Não há uma classificação aberta nesta liga.");
    const camp = camps.docs[0];
    const league = String(camp.get("liga") || "");
    const [participants, elites, challenges, currentUser, targetUser] = await Promise.all([
      tx.get(camp.ref.collection("participantes")),
      tx.get(db.collection("elite4").where("liga", "==", league)),
      tx.get(db.collection("desafios_elite4").where("campeonato_id", "==", camp.id)),
      tx.get(db.doc(`usuarios/${uid}`)), tx.get(db.doc(`usuarios/${targetUid}`)),
    ]);
    const myPart = participants.docs.find((p) => p.id === uid);
    const targetPart = participants.docs.find((p) => p.id === targetUid);
    if (!myPart || !targetPart) throw new HttpsError("failed-precondition", "Os dois jogadores precisam estar na classificação desta liga.");
    const myData = myPart.data(), targetData = targetPart.data();
    const eliteTarget = elites.docs.find((e) => e.get("uid") === targetUid);
    const eliteChallenger = elites.docs.find((e) => e.get("uid") === uid);
    const leaders = participants.docs.filter((p) => p.data().tipo_participante !== "elite4" && p.data().optou_participar === true).sort(rank);
    const myIsLeader = myData.tipo_participante !== "elite4" && myData.optou_participar === true;
    const targetIsLeader = targetData.tipo_participante !== "elite4" && targetData.optou_participar === true;
    let challengerRole: "lider" | "elite4";
    let targetRole: "lider" | "elite4";

    if (myIsLeader && targetIsLeader) {
      if (!leaders.slice(0, 4).some((p) => p.id === targetUid)) throw new HttpsError("failed-precondition", "Líderes podem desafiar somente um dos quatro líderes mais bem colocados.");
      challengerRole = "lider"; targetRole = "lider";
    } else if (myIsLeader && eliteTarget && targetData.tipo_participante === "elite4") {
      if (leaders[0]?.id !== uid) throw new HttpsError("failed-precondition", "Só o líder com mais pontos pode desafiar a Elite 4.");
      challengerRole = "lider"; targetRole = "elite4";
    } else if (eliteChallenger && targetIsLeader) {
      if (!leaders.slice(0, 4).some((p) => p.id === targetUid)) throw new HttpsError("failed-precondition", "A Elite 4 pode desafiar somente um dos quatro líderes mais bem colocados.");
      challengerRole = "elite4"; targetRole = "lider";
    } else {
      throw new HttpsError("permission-denied", "Esta combinação de desafiante e adversário não é permitida.");
    }

    const inProgress = challenges.docs.filter((d) => ACTIVE.has(String(d.get("status"))));
    if (inProgress.some((d) => [d.get("challenger_uid"), d.get("target_uid")].includes(uid) || [d.get("challenger_uid"), d.get("target_uid")].includes(targetUid))) {
      throw new HttpsError("failed-precondition", "Um dos treinadores já tem um desafio da Elite 4 em andamento.");
    }
    const pair = new Set([uid, targetUid]);
    if (challenges.docs.some((d) => pair.has(String(d.get("challenger_uid"))) && pair.has(String(d.get("target_uid"))))) {
      throw new HttpsError("already-exists", "Esses treinadores já se desafiaram nesta disputa.");
    }

    const challengeRef = db.collection("desafios_elite4").doc();
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

export const acceptElite4Challenge = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login.");
  const id = String(request.data?.challengeId || "");
  if (!id || id.includes("/")) throw new HttpsError("invalid-argument", "Desafio inválido.");
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`desafios_elite4/${id}`);
    const challenge = await tx.get(ref);
    if (!challenge.exists || challenge.get("target_uid") !== uid) throw new HttpsError("permission-denied", "Somente o adversário pode aceitar este desafio.");
    if (challenge.get("status") !== "pendente" || Date.now() > number(challenge.get("deadline_at_ms"))) throw new HttpsError("deadline-exceeded", "O prazo para aceitar este desafio terminou.");
    tx.update(ref, { status: "aceito", aceito_em_ms: Date.now() });
    return { ok: true };
  });
});

async function finalizarResultado(tx: FirebaseFirestore.Transaction, challenge: ChallengeDoc, ref: FirebaseFirestore.DocumentReference, winnerUid: string, method: "batalha" | "wo", callerUid: string) {
  if (!challenge.exists || ![challenge.get("challenger_uid"), challenge.get("target_uid")].includes(winnerUid)) throw new HttpsError("invalid-argument", "O vencedor não faz parte deste desafio.");
  const challengerUid = String(challenge.get("challenger_uid"));
  const targetUid = String(challenge.get("target_uid"));
  const eventId = String(challenge.get("campeonato_id"));
  const loserUid = winnerUid === challengerUid ? targetUid : challengerUid;
  const winnerRef = db.doc(`campeonatos_elite4/${eventId}/participantes/${winnerUid}`);
  const loserRef = db.doc(`campeonatos_elite4/${eventId}/participantes/${loserUid}`);
  const e4Uid = String(challenge.get("elite4_uid"));
  const userRef = db.doc(`usuarios/${e4Uid}`);
  const pointsLogRef = db.doc(`campeonatos_elite4_pontuacoes/desafio_${challenge.id}`);
  const ppLogRef = db.doc(`pp_logs/elite4_desafio_${challenge.id}`);
  const [winner, loser, eliteUser, pointsLog, ppLog] = await Promise.all([
    tx.get(winnerRef), tx.get(loserRef), tx.get(userRef), tx.get(pointsLogRef), tx.get(ppLogRef),
  ]);
  if (!winner.exists || !loser.exists) throw new HttpsError("failed-precondition", "A pontuação de um dos jogadores não está disponível.");
  const status = String(challenge.get("status"));
  if (status === "finalizado") return { ok: true, jaFinalizado: true };
  if (!ACTIVE.has(status)) throw new HttpsError("failed-precondition", "Este desafio não pode mais ser encerrado.");
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
  if (!pointsLog.exists) tx.create(pointsLogRef, {
    campeonato_id: eventId, desafio_id: challenge.id, liga: challenge.get("liga"),
    usuario_uid: winnerUid, adversario_uid: loserUid, quantidade: transfer,
    motivo: method === "wo" ? "vitoria_elite4_wo_transferencia_pontos" : "vitoria_elite4_transferencia_pontos",
    createdAt: Date.now(),
  });
  const awardedPP = method === "batalha" && !ppLog.exists;
  if (awardedPP) {
    if (!eliteUser.exists) throw new HttpsError("not-found", "Perfil do Elite 4 não encontrado.");
    tx.update(userRef, { pontosPresenca: FieldValue.increment(10) });
    tx.create(ppLogRef, { userId: e4Uid, tipo: "desafio_elite4", desafioId: challenge.id, liga: challenge.get("liga"), createdAt: FieldValue.serverTimestamp(), quantidade: 10 });
  }
  tx.update(ref, {
    status: "finalizado", winner_uid: winnerUid, loser_uid: loserUid, metodo_resultado: method,
    pontos_transferidos: transfer, finalized_at_ms: Date.now(), finalized_by: callerUid,
    elite4_pp_atribuido: awardedPP,
  });
  return { ok: true, winnerUid, loserUid, pontosTransferidos: transfer, elite4PP: awardedPP ? 10 : 0 };
}

export const reportElite4ChallengeResult = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login.");
  const id = String(request.data?.challengeId || "");
  const winnerUid = String(request.data?.winnerUid || "");
  if (!id || id.includes("/") || !winnerUid) throw new HttpsError("invalid-argument", "Informe o desafio e o vencedor.");
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`desafios_elite4/${id}`);
    const challenge = await tx.get(ref);
    if (!challenge.exists || ![challenge.get("challenger_uid"), challenge.get("target_uid")].includes(uid)) throw new HttpsError("permission-denied", "Você não participa deste desafio.");
    if (!["aceito", "resultado_parcial"].includes(String(challenge.get("status")))) throw new HttpsError("failed-precondition", "O adversário precisa aceitar o desafio antes de declarar o resultado.");
    if (Date.now() > number(challenge.get("deadline_at_ms"))) throw new HttpsError("deadline-exceeded", "O prazo de uma semana expirou. O desafiante pode pedir W.O.");
    if (![challenge.get("challenger_uid"), challenge.get("target_uid")].includes(winnerUid)) throw new HttpsError("invalid-argument", "O vencedor deve ser um dos dois participantes.");
    const reports = { ...(challenge.get("reports") || {}), [uid]: winnerUid } as Record<string, string>;
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

export const claimElite4Walkover = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login.");
  const id = String(request.data?.challengeId || "");
  if (!id || id.includes("/")) throw new HttpsError("invalid-argument", "Desafio inválido.");
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`desafios_elite4/${id}`);
    const challenge = await tx.get(ref);
    if (!challenge.exists || challenge.get("challenger_uid") !== uid) throw new HttpsError("permission-denied", "Somente quem iniciou o desafio pode pedir W.O.");
    if (!ACTIVE.has(String(challenge.get("status")))) throw new HttpsError("failed-precondition", "Este desafio já foi encerrado.");
    if (Date.now() < number(challenge.get("deadline_at_ms"))) throw new HttpsError("failed-precondition", "O prazo de uma semana ainda não terminou.");
    const targetReport = (challenge.get("reports") || {})[String(challenge.get("target_uid"))];
    if (targetReport) throw new HttpsError("failed-precondition", "O adversário já declarou um resultado. Um administrador precisa resolver o registro.");
    return finalizarResultado(tx, challenge, ref, uid, "wo", uid);
  });
});

export const adminResolveElite4Challenge = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login.");
  await verificarSuper(uid);
  const id = String(request.data?.challengeId || "");
  const winnerUid = String(request.data?.winnerUid || "");
  if (!id || id.includes("/") || !winnerUid) throw new HttpsError("invalid-argument", "Informe o desafio e o vencedor.");
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`desafios_elite4/${id}`);
    const challenge = await tx.get(ref);
    if (!challenge.exists || challenge.get("status") !== "contestado") throw new HttpsError("failed-precondition", "Só é possível resolver resultados contestados.");
    return finalizarResultado(tx, challenge, ref, winnerUid, "batalha", uid);
  });
});
