import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./adminSdk";

const REGION = "southamerica-east1";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_MATCHES = ["agendada", "em_andamento", "contestado"];
const asMs = (value: unknown) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;

export const reportGreatPlateauMatch = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Entre na sua conta para informar o resultado.");
  const tournamentId = String(request.data?.tournamentId || "");
  const roundId = String(request.data?.roundId || "");
  const matchId = String(request.data?.matchId || "");
  const winnerUid = String(request.data?.winnerUid || "");
  if ([tournamentId, roundId, matchId].some((id) => !id || id.includes("/"))) throw new HttpsError("invalid-argument", "Partida inválida.");
  const ref = db.doc(`campeonatos_liga_ro/${tournamentId}/rodadas/${roundId}/partidas/${matchId}`);
  return db.runTransaction(async (tx) => {
    const match = await tx.get(ref);
    if (!match.exists || ![match.get("uid_a"), match.get("uid_b")].includes(uid)) throw new HttpsError("permission-denied", "Você não participa desta partida.");
    if (match.get("is_bye") === true || match.get("status") === "confirmada") throw new HttpsError("failed-precondition", "Esta partida já foi encerrada.");
    const createdAt = asMs(match.get("createdAt"));
    const deadline = asMs(match.get("deadline_at_ms")) || createdAt + WEEK_MS;
    if (!createdAt || Date.now() >= deadline) throw new HttpsError("deadline-exceeded", "O prazo de sete dias terminou; o resultado será encerrado automaticamente.");
    const uidA = String(match.get("uid_a") || "");
    const uidB = String(match.get("uid_b") || "");
    if (![uidA, uidB, "empate"].includes(winnerUid)) throw new HttpsError("invalid-argument", "Escolha um resultado válido.");
    if (match.get("tipo") === "top_cut" && winnerUid === "empate") throw new HttpsError("invalid-argument", "O Top Cut não aceita empate.");
    const key = uid === uidA ? "report_a" : "report_b";
    if (match.get(key)) throw new HttpsError("already-exists", "Você já informou o resultado desta partida.");
    const otherKey = key === "report_a" ? "report_b" : "report_a";
    const otherReport = match.get(otherKey) as string | null;
    const status = otherReport ? (otherReport === winnerUid ? "confirmada" : "contestado") : "em_andamento";
    tx.update(ref, {
      [key]: winnerUid, status,
      ...(status === "confirmada" ? { winner_uid: winnerUid === "empate" ? null : winnerUid, resolvedAt: Date.now(), metodo_resultado: "batalha" } : {}),
    });
    return { ok: true, status };
  });
});

/** Fecha partidas do Great Plateau uma semana após a abertura, mesmo sem acesso à página. */
export const processExpiredGreatPlateauMatches = onSchedule(
  { schedule: "0 0 * * *", timeZone: "America/Sao_Paulo", region: REGION, maxInstances: 1 },
  async () => {
    const snapshot = await db.collectionGroup("partidas").where("status", "in", ACTIVE_MATCHES).get();
    const now = Date.now();
    for (const item of snapshot.docs) {
      if (!item.ref.path.startsWith("campeonatos_liga_ro/")) continue;
      await db.runTransaction(async (tx) => {
        const ref = item.ref;
        const match = await tx.get(ref);
        if (!match.exists || !ACTIVE_MATCHES.includes(String(match.get("status")))) return;
        const createdAt = asMs(match.get("createdAt"));
        const deadline = asMs(match.get("deadline_at_ms")) || createdAt + WEEK_MS;
        if (!createdAt || now < deadline) return;
        const reportA = match.get("report_a") as string | null;
        const reportB = match.get("report_b") as string | null;
        if (reportA && reportB && reportA === reportB) {
          tx.update(ref, { status: "confirmada", winner_uid: reportA === "empate" ? null : reportA, resolvedAt: now, metodo_resultado: "batalha" });
          return;
        }
        if (reportA && reportB && reportA !== reportB) {
          tx.update(ref, { status: "encerrada_sem_resultado", winner_uid: null, resolvedAt: now, metodo_resultado: "relatos_divergentes" });
          return;
        }
        const singleReport = reportA || reportB;
        if (singleReport && singleReport !== "empate") {
          const reporterUid = reportA ? String(match.get("uid_a")) : String(match.get("uid_b"));
          tx.update(ref, { status: "confirmada", winner_uid: singleReport, resolvedAt: now,
            metodo_resultado: singleReport === reporterUid ? "wo" : "concessao", confirmadoPorWoAutomatico: singleReport === reporterUid });
          return;
        }
        tx.update(ref, { status: "encerrada_sem_resultado", winner_uid: null, resolvedAt: now, metodo_resultado: "sem_resultado" });
      });
    }
  },
);

/** Aplica W.O. às declarações isoladas em disputa de ginásio após sete dias. */
export const processExpiredVacancyGymResults = onSchedule(
  { schedule: "0 0 * * *", timeZone: "America/Sao_Paulo", region: REGION, maxInstances: 1 },
  async () => {
    const now = Date.now();
    const pending = await db.collection("disputas_ginasio_resultados").where("status", "in", ["pendente", "contestado"]).get();
    for (const item of pending.docs) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(item.ref);
        if (!current.exists || !["pendente", "contestado"].includes(String(current.get("status")))) return;
        const currentData = current.data() || {};
        const createdAt = asMs(currentData.server_created_at_ms) || asMs(currentData.createdAt);
        if (!createdAt || now < createdAt + WEEK_MS) return;
        const disputeId = String(currentData.disputa_id || "");
        if (!disputeId) {
          tx.update(item.ref, { status: "encerrada_sem_resultado", encerradaPorExpiracao: true, closedAt: now });
          return;
        }
        const all = await tx.get(db.collection("disputas_ginasio_resultados").where("disputa_id", "==", disputeId));
        const players = currentData.tipo === "empate"
          ? [String(currentData.jogador1_uid || ""), String(currentData.jogador2_uid || "")].sort()
          : [String(currentData.vencedor_uid || ""), String(currentData.perdedor_uid || "")].sort();
        const pair = players.join("__");
        const related = all.docs.filter((result) => {
          const data = result.data();
          const ids = data.tipo === "empate"
            ? [String(data.jogador1_uid || ""), String(data.jogador2_uid || "")].sort()
            : [String(data.vencedor_uid || ""), String(data.perdedor_uid || "")].sort();
          return ids.join("__") === pair;
        });
        if (related.some((result) => result.get("status") === "contestado")) {
          for (const result of related) if (["pendente", "contestado"].includes(String(result.get("status")))) {
            tx.update(result.ref, { status: "encerrada_sem_resultado", contestadoPorExpiracao: true, closedAt: now,
              metodo_resultado: "divergencia_sem_resolucao_apos_prazo" });
          }
          return;
        }
        const active = related.filter((result) => ["pendente", "confirmado"].includes(String(result.get("status") || "pendente")));
        const outcome = (result: FirebaseFirestore.QueryDocumentSnapshot) => {
          const data = result.data();
          return data.tipo === "empate" ? "empate" : String(data.vencedor_uid || "");
        };
        const outcomes = new Set(active.map(outcome));
        if (outcomes.size > 1) {
          for (const result of active) if (result.get("status") === "pendente") tx.update(result.ref, { status: "contestado", contestadoPorExpiracao: true, closedAt: now });
          return;
        }
        const confirmed = active.find((result) => result.get("status") === "confirmado");
        if (confirmed) {
          const confirmedData = confirmed.data();
          for (const result of active) if (result.get("status") === "pendente") tx.update(result.ref, {
            status: "confirmado", metodo_resultado: confirmedData.metodo_resultado || "resultado_concordante",
            confirmadoEm: confirmedData.confirmadoEm || now,
          });
          return;
        }
        const outcomeValue = active.length ? outcome(active[0]) : "";
        if (outcomeValue === "empate") {
          if (active.length < 2) tx.update(item.ref, { status: "encerrada_sem_resultado", encerradaPorExpiracao: true, closedAt: now });
          else for (const result of active) tx.update(result.ref, { status: "confirmado", metodo_resultado: "empate_confirmado", confirmadoEm: now });
          return;
        }
        if (outcomeValue) {
          const reporter = String(active[0].get("declarado_por") || "");
          for (const result of active) tx.update(result.ref, {
            status: "confirmado", confirmadoPorWoAutomatico: active.length === 1 && reporter === outcomeValue,
            metodo_resultado: active.length > 1 ? "resultado_concordante" : reporter === outcomeValue ? "wo" : "concessao",
            confirmadoPorWoEm: now, confirmadoEm: now,
          });
          return;
        }
        tx.update(item.ref, { status: "encerrada_sem_resultado", encerradaPorExpiracao: true, closedAt: now });
      });
    }
  },
);
