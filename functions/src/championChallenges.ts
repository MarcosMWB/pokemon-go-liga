import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, FieldValue } from "./adminSdk";

const REGION = "southamerica-east1";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_CHALLENGE_STATUSES = new Set(["solicitado", "em_andamento"]);
const int = (value: unknown) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;

function monthInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  return `${year}-${month}`;
}

async function requireSuper(uid: string) {
  if (!(await db.doc(`superusers/${uid}`).get()).exists) {
    throw new HttpsError("permission-denied", "Apenas administradores podem iniciar ou avançar o desafio.");
  }
}

export const requestChampionChallenge = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Entre na sua conta para solicitar o desafio.");
  const badgeTournamentId = String(request.data?.badgeTournamentId || "");
  if (!badgeTournamentId || badgeTournamentId.includes("/")) throw new HttpsError("invalid-argument", "Troféu inválido.");

  const badgeRef = db.doc(`insignias/santo_antonio__${badgeTournamentId}__${uid}`);
  const userRef = db.doc(`usuarios/${uid}`);
  const monthKey = monthInSaoPaulo();
  const lockRef = db.doc(`desafios_campeoes_mensais/${uid}_${monthKey}`);
  const challengeRef = db.collection("desafios_campeoes").doc();
  const ownChallengesQuery = db.collection("desafios_campeoes").where("challenger_uid", "==", uid);

  return db.runTransaction(async (tx) => {
    const [badge, user, lock, ownChallenges, currentChampion] = await Promise.all([
      tx.get(badgeRef), tx.get(userRef), tx.get(lockRef), tx.get(ownChallengesQuery),
      tx.get(db.doc("regiao_campeao/great_plateau")),
    ]);
    if (!badge.exists || badge.get("usuario_uid") !== uid || badge.get("tipo") !== "trofeu_great_plateau") {
      throw new HttpsError("permission-denied", "É necessário possuir um Troféu Santo Antônio para desafiar.");
    }
    if (lock.exists) throw new HttpsError("already-exists", "Você já usou seu desafio deste mês.");
    const active = ownChallenges.docs.find((doc) => ACTIVE_CHALLENGE_STATUSES.has(String(doc.get("status"))));
    if (active) throw new HttpsError("failed-precondition", "Você já tem um desafio de campeão em andamento.");
    if (currentChampion.exists && currentChampion.get("campeao_uid") === uid) {
      throw new HttpsError("failed-precondition", "O campeão atual não pode desafiar a si mesmo.");
    }

    const name = String(user.get("nome") || user.get("nick") || request.auth?.token.name || "Treinador");
    const league = String(badge.get("liga") || "Great");
    const createdAt = Date.now();
    tx.create(challengeRef, {
      challenger_uid: uid,
      challenger_name: name,
      badge_tournament_id: badgeTournamentId,
      liga: league,
      month_key: monthKey,
      status: "solicitado",
      stage: 0,
      reports: {},
      createdAt,
      created_at_ms: createdAt,
      deadline_at_ms: createdAt + WEEK_MS,
    });
    tx.create(lockRef, { uid, month_key: monthKey, challenge_id: challengeRef.id, createdAt });
    return { ok: true, challengeId: challengeRef.id, monthKey };
  });
});

export const reportChampionChallengeResult = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Entre na sua conta para informar o resultado.");
  const challengeId = String(request.data?.challengeId || "");
  const winnerUid = String(request.data?.winnerUid || "");
  if (!challengeId || challengeId.includes("/") || !winnerUid) throw new HttpsError("invalid-argument", "Informe o desafio e o vencedor.");
  const ref = db.doc(`desafios_campeoes/${challengeId}`);
  return db.runTransaction(async (tx) => {
    const challenge = await tx.get(ref);
    if (!challenge.exists || challenge.get("status") !== "em_andamento") throw new HttpsError("failed-precondition", "Este desafio não está em andamento.");
    const data = challenge.data()!;
    const stage = int(data.stage);
    const challengerUid = String(data.challenger_uid || "");
    const elites = Array.isArray(data.elites) ? data.elites as Array<{ uid: string }> : [];
    const champion = data.champion && typeof data.champion.uid === "string" ? data.champion as { uid: string } : null;
    const defender = stage === 4 ? champion : elites[stage];
    if (!defender || ![challengerUid, defender.uid].includes(uid)) throw new HttpsError("permission-denied", "Você não participa desta batalha.");
    const deadline = int(data.deadline_at_ms) || int(data.stage_started_at_ms || data.startedAt) + WEEK_MS;
    if (!deadline || Date.now() >= deadline) throw new HttpsError("deadline-exceeded", "O prazo terminou; o resultado será encerrado automaticamente.");
    if (![challengerUid, defender.uid].includes(winnerUid)) throw new HttpsError("invalid-argument", "O vencedor deve ser um dos dois participantes.");
    const role = uid === challengerUid ? "challenger" : "defender";
    const reports = data.reports || {};
    if (reports[role]) throw new HttpsError("already-exists", "Você já informou o resultado desta batalha.");
    tx.update(ref, { reports: { ...reports, [role]: winnerUid } });
    return { ok: true };
  });
});

export const advanceChampionChallenge = onCall({ region: REGION }, async (request) => {
  const adminUid = request.auth?.uid;
  if (!adminUid) throw new HttpsError("unauthenticated", "Faça login como administrador.");
  await requireSuper(adminUid);
  const challengeId = String(request.data?.challengeId || "");
  if (!challengeId || challengeId.includes("/")) throw new HttpsError("invalid-argument", "Desafio inválido.");
  const challengeRef = db.doc(`desafios_campeoes/${challengeId}`);
  const currentChampionRef = db.doc("regiao_campeao/great_plateau");
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const challenge = await tx.get(challengeRef);
    if (!challenge.exists || challenge.get("status") !== "em_andamento") {
      throw new HttpsError("failed-precondition", "Este desafio não está em andamento.");
    }
    const data = challenge.data()!;
    const stage = int(data.stage);
    const stageDeadline = int(data.deadline_at_ms) || int(data.stage_started_at_ms || data.startedAt) + WEEK_MS;
    if (!stageDeadline || Date.now() >= stageDeadline) throw new HttpsError("deadline-exceeded", "O prazo terminou; o sistema encerrará esta batalha automaticamente.");
    const challengerUid = String(data.challenger_uid || "");
    const reports = data.reports || {};
    const challengerReport = String(reports.challenger || "");
    const defenderReport = String(reports.defender || "");
    if (!challengerReport || challengerReport !== defenderReport) {
      throw new HttpsError("failed-precondition", "Os dois jogadores precisam concordar sobre o resultado.");
    }

    const elites = Array.isArray(data.elites) ? data.elites as Array<{ uid: string; nome: string; pos?: number }> : [];
    const champion = data.champion && typeof data.champion.uid === "string" ? data.champion as { uid: string; nome: string } : null;
    const defender = stage === 4 ? champion : elites[stage];
    if (!defender || ![challengerUid, defender.uid].includes(challengerReport)) {
      throw new HttpsError("failed-precondition", "O defensor ou o vencedor não corresponde à etapa atual.");
    }
    const challengerWon = challengerReport === challengerUid;

    if (!challengerWon) {
      if (stage < 4) {
        const league = String(data.liga || "");
        const scoreEventQuery = db.collection("campeonatos_elite4")
          .where("liga", "==", league).where("status", "==", "aberto");
        const scoreLogRef = db.doc(`campeonatos_elite4_pontuacoes/campeao_${challengeId}`);
        const pendingRef = db.doc(`elite4_pontos_pendentes/${challengeId}`);
        const [scoreEvents, scoreLog] = await Promise.all([tx.get(scoreEventQuery), tx.get(scoreLogRef)]);
        const activeScoreEvent = scoreEvents.docs.sort((a, b) => int(b.get("createdAt")) - int(a.get("createdAt")))[0];
        let participantRef: FirebaseFirestore.DocumentReference | null = null;
        let participant: FirebaseFirestore.DocumentSnapshot | null = null;
        if (activeScoreEvent) {
          participantRef = activeScoreEvent.ref.collection("participantes").doc(defender.uid);
          participant = await tx.get(participantRef);
        }
        if (!scoreLog.exists && participantRef && participant?.exists) {
          const current = participant.data() || {};
          tx.update(participantRef, {
            pontos: int(current.pontos) + 100,
            pontos_desafios: int(current.pontos_desafios) + 100,
            updatedAt: now,
          });
          tx.create(scoreLogRef, {
            campeonato_id: activeScoreEvent!.id, liga: league, usuario_uid: defender.uid,
            participante_nome: defender.nome || defender.uid, quantidade: 100,
            motivo: `vitória na defesa da Elite 4 contra ${data.challenger_name || challengerUid}`,
            desafio_campeoes_id: challengeId, createdAt: now,
          });
        } else if (!scoreLog.exists) {
          const pending = await tx.get(pendingRef);
          if (!pending.exists) tx.create(pendingRef, {
            liga: league, usuario_uid: defender.uid, participante_nome: defender.nome || defender.uid,
            quantidade: 100, desafio_campeoes_id: challengeId, status: "pendente", createdAt: now,
          });
        }
        tx.update(challengeRef, {
          status: "encerrado", resultado: "elite4_manteve_vaga", vencedor_uid: defender.uid,
          elite4_pontos: 100, elite4_pontos_status: participant?.exists ? "atribuido" : "pendente",
          closedAt: now, reports: { ...reports, resolvedBy: adminUid },
        });
        return { ok: true, status: "encerrado", resultado: "elite4_manteve_vaga", pontosElite4: 100 };
      }

      const ppLogRef = db.doc(`pp_logs/defesa_titulo_${challengeId}`);
      const currentChampion = await tx.get(currentChampionRef);
      const ppLog = await tx.get(ppLogRef);
      if (!currentChampion.exists || currentChampion.get("campeao_uid") !== defender.uid) {
        throw new HttpsError("failed-precondition", "O campeão mudou durante o desafio. Peça ao administrador para conferir a etapa.");
      }
      if (!ppLog.exists) {
        tx.update(db.doc(`usuarios/${defender.uid}`), { pontosPresenca: FieldValue.increment(10) });
        tx.create(ppLogRef, {
          userId: defender.uid, tipo: "defesa_titulo_regional", desafioId: challengeId,
          quantidade: 10, createdAt: FieldValue.serverTimestamp(),
        });
      }
      tx.update(challengeRef, {
        status: "encerrado", resultado: "campeao_manteve_titulo", vencedor_uid: defender.uid,
        campeao_pp_atribuido: !ppLog.exists, closedAt: now,
        reports: { ...reports, resolvedBy: adminUid },
      });
      return { ok: true, status: "encerrado", resultado: "campeao_manteve_titulo", campeaoPP: ppLog.exists ? 0 : 10 };
    }

    const lastStage = champion ? 4 : 3;
    if (stage < lastStage) {
      tx.update(challengeRef, { stage: stage + 1, reports: {}, stage_started_at_ms: now, deadline_at_ms: now + WEEK_MS, updatedAt: now });
      return { ok: true, status: "em_andamento", stage: stage + 1 };
    }

    const currentChampion = await tx.get(currentChampionRef);
    const snapshottedChampionUid = champion?.uid || "";
    const currentChampionUid = currentChampion.exists ? String(currentChampion.get("campeao_uid") || "") : "";
    if (snapshottedChampionUid !== currentChampionUid) {
      throw new HttpsError("failed-precondition", "O campeão mudou durante a sequência. O administrador precisa revisar o desafio antes de registrar o título.");
    }
    const newHallRef = db.doc(`hall_da_fama/campeao_${challengeId}`);
    const oldHallId = currentChampion.exists ? String(currentChampion.get("hall_entry_id") || "") : "";
    let oldHallRef: FirebaseFirestore.DocumentReference | null = oldHallId ? db.doc(`hall_da_fama/${oldHallId}`) : null;
    let oldHall: FirebaseFirestore.DocumentSnapshot | null = oldHallRef ? await tx.get(oldHallRef) : null;
    if (currentChampion.exists && (!oldHallRef || !oldHall?.exists)) {
      const legacy = await tx.get(db.collection("hall_da_fama")
        .where("usuario_uid", "==", String(currentChampion.get("campeao_uid") || "")));
      const activeEntry = legacy.docs.filter((entry) => entry.get("tipo") === "campeao_regional" && !entry.get("data_fim"))
        .sort((a, b) => int(b.get("data_inicio") || b.get("createdAt")) - int(a.get("data_inicio") || a.get("createdAt")))[0];
      if (activeEntry) { oldHallRef = activeEntry.ref; oldHall = activeEntry; }
    }
    const [newHall, newUser] = await Promise.all([tx.get(newHallRef), tx.get(db.doc(`usuarios/${challengerUid}`))]);
    if (newHall.exists) throw new HttpsError("already-exists", "Este título já foi registrado no Hall da Fama.");
    if (oldHallRef && oldHall?.exists) tx.update(oldHallRef, { data_fim: now, data_fim_temporada_id: data.team_snapshot?.temporada_id || "" });
    const challengerName = String(data.challenger_name || newUser.get("nome") || newUser.get("nick") || challengerUid);
    tx.create(newHallRef, {
      usuario_uid: challengerUid, nome: challengerName, liga: data.liga || "",
      temporada_id: data.team_snapshot?.temporada_id || "",
      temporada_nome: data.team_snapshot?.temporada_nome || "Temporada não informada",
      equipe_snapshot: data.team_snapshot || null, tipo: "campeao_regional",
      desafio_id: challengeId, data_inicio: now, data_fim: null, createdAt: now,
    });
    tx.set(currentChampionRef, {
      campeao_uid: challengerUid, campeao_nome: challengerName, liga: data.liga || "",
      temporada_id: data.team_snapshot?.temporada_id || "",
      temporada_nome: data.team_snapshot?.temporada_nome || "",
      updatedAt: now, inicioAt: now, origem_desafio: challengeId, hall_entry_id: newHallRef.id,
    });
    tx.update(challengeRef, {
      status: "concluido", resultado: "novo_campeao_regional", vencedor_uid: challengerUid,
      closedAt: now, campeao_anterior_uid: currentChampion.exists ? currentChampion.get("campeao_uid") || null : null,
      reports: { ...reports, resolvedBy: adminUid },
    });
    return { ok: true, status: "concluido", resultado: "novo_campeao_regional", campeao: challengerName };
  });
});

/** Fecha pedidos e etapas vencidas automaticamente, processando W.O. e liberando o fluxo. */
export const processExpiredChampionChallenges = onSchedule(
  { schedule: "0 0 * * *", timeZone: "America/Sao_Paulo", region: REGION, maxInstances: 1 },
  async () => {
    const now = Date.now();
    const rows = await db.collection("desafios_campeoes").where("status", "in", ["solicitado", "em_andamento"]).get();
    for (const row of rows.docs) {
      await db.runTransaction(async (tx) => {
        const ref = row.ref;
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const data = snap.data()!;
        const status = String(data.status || "");
        const createdAt = int(data.created_at_ms || data.createdAt);
        const stageCreated = int(data.stage_started_at_ms || data.startedAt || createdAt);
        const deadline = int(data.deadline_at_ms) || stageCreated + WEEK_MS;
        if (now < deadline) return;

        if (status === "solicitado") {
          const lockRef = db.doc(`desafios_campeoes_mensais/${data.challenger_uid}_${data.month_key}`);
          const lock = await tx.get(lockRef);
          if (lock.exists && lock.get("challenge_id") === snap.id) tx.delete(lockRef);
          tx.update(ref, { status: "encerrado", resultado: "pedido_expirado_sem_inicio", closedAt: now });
          return;
        }
        if (status !== "em_andamento") return;

        const challengerUid = String(data.challenger_uid || "");
        const elites = Array.isArray(data.elites) ? data.elites as Array<{ uid: string; nome: string; pos?: number }> : [];
        const champion = data.champion && typeof data.champion.uid === "string" ? data.champion as { uid: string; nome: string } : null;
        const stage = int(data.stage);
        const defender = stage === 4 ? champion : elites[stage];
        if (!defender) {
          tx.update(ref, { status: "encerrado", resultado: "etapa_sem_defensor", closedAt: now });
          return;
        }
        const reports = data.reports || {};
        const challengerReport = String(reports.challenger || "");
        const defenderReport = String(reports.defender || "");
        if (challengerReport && defenderReport && challengerReport !== defenderReport) {
          tx.update(ref, { status: "encerrado", resultado: "relatos_divergentes", closedAt: now, encerramento_motivo: "divergencia_apos_prazo" });
          return;
        }
        if (!challengerReport && !defenderReport) {
          tx.update(ref, { status: "encerrado", resultado: "sem_resultado", closedAt: now, encerramento_motivo: "nenhum_relato_apos_prazo" });
          return;
        }
        const winnerUid = challengerReport || defenderReport;
        if (![challengerUid, defender.uid].includes(winnerUid)) {
          tx.update(ref, { status: "encerrado", resultado: "relato_invalido", closedAt: now });
          return;
        }
        const reporterUid = challengerReport ? challengerUid : defender.uid;
        const method = challengerReport && defenderReport ? "batalha" : winnerUid === reporterUid ? "wo" : "concessao";
        const lastStage = champion ? 4 : 3;

        if (winnerUid === challengerUid && stage < lastStage) {
          tx.update(ref, {
            stage: stage + 1, reports: {}, stage_started_at_ms: now, deadline_at_ms: now + WEEK_MS,
            updatedAt: now, etapa_anterior_metodo: method,
          });
          return;
        }

        if (winnerUid === challengerUid) {
          const currentChampionRef = db.doc("regiao_campeao/great_plateau");
          const current = await tx.get(currentChampionRef);
          const snapshotUid = champion?.uid || "";
          const currentUid = current.exists ? String(current.get("campeao_uid") || "") : "";
          if (snapshotUid !== currentUid || currentUid === challengerUid) {
            tx.update(ref, { status: "encerrado", resultado: "campeao_alterado_durante_desafio", closedAt: now });
            return;
          }
          const newHallRef = db.doc(`hall_da_fama/campeao_${snap.id}`);
          const previousHallId = current.exists ? String(current.get("hall_entry_id") || "") : "";
          let previousHallRef: FirebaseFirestore.DocumentReference | null = previousHallId ? db.doc(`hall_da_fama/${previousHallId}`) : null;
          let previousHall = previousHallRef ? await tx.get(previousHallRef) : null;
          if (current.exists && (!previousHallRef || !previousHall?.exists)) {
            const legacy = await tx.get(db.collection("hall_da_fama").where("usuario_uid", "==", currentUid));
            const active = legacy.docs.filter((entry) => entry.get("tipo") === "campeao_regional" && !entry.get("data_fim"))
              .sort((a, b) => int(b.get("data_inicio") || b.get("createdAt")) - int(a.get("data_inicio") || a.get("createdAt")))[0];
            if (active) { previousHallRef = active.ref; previousHall = active; }
          }
          const userRef = db.doc(`usuarios/${challengerUid}`);
          const [newHall, user] = await Promise.all([tx.get(newHallRef), tx.get(userRef)]);
          if (newHall.exists) throw new HttpsError("already-exists", "Este título já foi registrado no Hall da Fama.");
          const name = String(data.challenger_name || user.get("nome") || user.get("nick") || challengerUid);
          if (previousHallRef && previousHall?.exists) tx.update(previousHallRef, { data_fim: now });
          tx.create(newHallRef, {
            usuario_uid: challengerUid, nome: name, liga: data.liga || "",
            temporada_id: data.team_snapshot?.temporada_id || "", temporada_nome: data.team_snapshot?.temporada_nome || "Temporada não informada",
            equipe_snapshot: data.team_snapshot || null, tipo: "campeao_regional", desafio_id: snap.id,
            data_inicio: now, data_fim: null, createdAt: now, metodo_conquista: method,
          });
          tx.set(currentChampionRef, {
            campeao_uid: challengerUid, campeao_nome: name, liga: data.liga || "",
            temporada_id: data.team_snapshot?.temporada_id || "", temporada_nome: data.team_snapshot?.temporada_nome || "",
            updatedAt: now, inicioAt: now, origem_desafio: snap.id, hall_entry_id: newHallRef.id,
          });
          tx.update(ref, { status: "concluido", resultado: "novo_campeao_regional", vencedor_uid: challengerUid,
            closedAt: now, campeao_anterior_uid: currentUid || null, metodo_resultado: method });
          return;
        }

        if (stage < 4) {
          const league = String(data.liga || "");
          const eventQuery = db.collection("campeonatos_elite4").where("liga", "==", league).where("status", "==", "aberto");
          const logRef = db.doc(`campeonatos_elite4_pontuacoes/campeao_${snap.id}`);
          const pendingRef = db.doc(`elite4_pontos_pendentes/${snap.id}`);
          const [events, log, pending] = await Promise.all([tx.get(eventQuery), tx.get(logRef), tx.get(pendingRef)]);
          const activeEvent = events.docs.sort((a, b) => int(b.get("createdAt")) - int(a.get("createdAt")))[0];
          const participantRef = activeEvent?.ref.collection("participantes").doc(defender.uid);
          const participant = participantRef ? await tx.get(participantRef) : null;
          if (!log.exists && participantRef && participant?.exists) {
            const current = participant.data() || {};
            tx.update(participantRef, { pontos: int(current.pontos) + 100, pontos_desafios: int(current.pontos_desafios) + 100, updatedAt: now });
            tx.create(logRef, { campeonato_id: activeEvent!.id, liga: league, usuario_uid: defender.uid, participante_nome: defender.nome || defender.uid,
              quantidade: 100, motivo: `vitória por ${method} na defesa da Elite 4 contra ${data.challenger_name || challengerUid}`,
              desafio_campeoes_id: snap.id, createdAt: now });
          } else if (!log.exists && !pending.exists) {
            tx.create(pendingRef, { liga: league, usuario_uid: defender.uid, participante_nome: defender.nome || defender.uid,
              quantidade: 100, desafio_campeoes_id: snap.id, status: "pendente", createdAt: now });
          }
          tx.update(ref, { status: "encerrado", resultado: "elite4_manteve_vaga", vencedor_uid: defender.uid,
            elite4_pontos: 100, elite4_pontos_status: participant?.exists ? "atribuido" : "pendente", closedAt: now, metodo_resultado: method });
          return;
        }

        const currentChampionRef = db.doc("regiao_campeao/great_plateau");
        const userRef = db.doc(`usuarios/${defender.uid}`);
        const ppLogRef = db.doc(`pp_logs/defesa_titulo_${snap.id}`);
        const [current, user, ppLog] = await Promise.all([tx.get(currentChampionRef), tx.get(userRef), tx.get(ppLogRef)]);
        if (!current.exists || current.get("campeao_uid") !== defender.uid) {
          tx.update(ref, { status: "encerrado", resultado: "campeao_alterado_durante_desafio", closedAt: now });
          return;
        }
        if (!user.exists) throw new HttpsError("not-found", "Perfil do Campeão não encontrado.");
        if (!ppLog.exists) {
          tx.update(userRef, { pontosPresenca: FieldValue.increment(10) });
          tx.create(ppLogRef, { userId: defender.uid, tipo: "defesa_titulo_regional", desafioId: snap.id, quantidade: 10, createdAt: FieldValue.serverTimestamp() });
        }
        tx.update(ref, { status: "encerrado", resultado: "campeao_manteve_titulo", vencedor_uid: defender.uid,
          campeao_pp_atribuido: !ppLog.exists, closedAt: now, metodo_resultado: method });
      });
    }
  },
);
