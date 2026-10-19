import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db, FieldValue } from "./adminSdk";

const REGION = "southamerica-east1";

async function createNotification(
  uid: string,
  eventId: string,
  type: string,
  title: string,
  message: string,
  href: string,
): Promise<void> {
  if (!uid) return;
  const privateSnap = await db.doc(`usuarios_private/${uid}`).get();
  if (privateSnap.get("notifications.enabled") !== true) return;
  const notificationId = `${eventId}_${uid}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 140);
  await db.doc(`notificacoes/${uid}/itens/${notificationId}`).create({
    tipo: type,
    titulo: title,
    mensagem: message,
    href,
    lida: false,
    createdAt: FieldValue.serverTimestamp(),
  }).catch((error: { code?: number }) => {
    // Firestore ALREADY_EXISTS (6): retries must not duplicate an inbox item.
    if (error.code !== 6) throw error;
  });
}

export const onGymChallengeNotification = onDocumentCreated(
  { document: "desafios_ginasio/{challengeId}", region: REGION },
  async (event) => {
    const challenge = event.data?.data();
    if (!challenge || challenge.status !== "pendente" || !challenge.lider_uid) return;
    const gymSnap = challenge.ginasio_id ? await db.doc(`ginasios/${challenge.ginasio_id}`).get() : null;
    const gymName = gymSnap?.data()?.nome || "um ginásio";
    const league = challenge.liga ? `, na liga ${challenge.liga}` : "";
    await createNotification(
      String(challenge.lider_uid), event.id, "desafio_ginasio", "Você recebeu um desafio de ginásio",
      `Você recebeu um novo desafio para ${gymName}${league}. Acesse o site para ver os detalhes e combinar a batalha.`,
      challenge.ginasio_id ? `/ginasios/${encodeURIComponent(challenge.ginasio_id)}` : "/ginasios",
    );
  },
);

export const onGymDisputeBattleNotification = onDocumentUpdated(
  { document: "disputas_ginasio/{disputeId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === "batalhando" || after.status !== "batalhando") return;
    const [participants, gymSnap] = await Promise.all([
      db.collection("disputas_ginasio_participantes").where("disputa_id", "==", event.params.disputeId).get(),
      after.ginasio_id ? db.doc(`ginasios/${after.ginasio_id}`).get() : Promise.resolve(null),
    ]);
    const gymName = gymSnap?.data()?.nome || "o ginásio";
    const uids = [...new Set(participants.docs.map((d) => d.data())
      .filter((p) => !p.removido && p.usuario_uid).map((p) => String(p.usuario_uid)))];
    await Promise.all(uids.map((uid) => createNotification(
      uid, event.id, "disputa_ginasio", "A disputa de ginásio começou",
      `A batalha pela liderança de ${gymName} começou. Acesse o site para consultar os detalhes.`,
      after.ginasio_id ? `/ginasios/${encodeURIComponent(after.ginasio_id)}` : "/ginasios",
    )));
  },
);

export const onTournamentBattleNotification = onDocumentCreated(
  { document: "campeonatos_liga_ro/{tournamentId}/rodadas/{roundId}/partidas/{matchId}", region: REGION },
  async (event) => {
    const match = event.data?.data();
    if (!match || match.is_bye === true || match.uid_a === match.uid_b) return;
    const tournamentSnap = await db.doc(`campeonatos_liga_ro/${event.params.tournamentId}`).get();
    const name = tournamentSnap.data()?.nome || "Campeonato Great Plateau";
    const players = [
      { uid: String(match.uid_a || ""), opponent: match.nome_b || "seu adversário" },
      { uid: String(match.uid_b || ""), opponent: match.nome_a || "seu adversário" },
    ].filter((p) => p.uid);
    await Promise.all(players.map((p) => createNotification(
      p.uid, event.id, "batalha_campeonato", "Sua batalha do campeonato foi definida",
      `Uma nova partida de ${name} foi definida. Seu adversário é ${p.opponent}. Acesse o campeonato para combinar a batalha e registrar o resultado.`,
      `/campeonato-ro/${encodeURIComponent(event.params.tournamentId)}`,
    )));
  },
);

export const onBadgeEarnedNotification = onDocumentCreated(
  { document: "insignias/{badgeId}", region: REGION },
  async (event) => {
    const badge = event.data?.data();
    if (!badge?.usuario_uid) return;
    const name = badge.ginasio_nome || badge.nome || (badge.tipo === "trofeu_great_plateau" ? "Troféu Santo Antônio" : "uma nova insígnia");
    const season = badge.temporada_nome ? ` da temporada ${badge.temporada_nome}` : "";
    const uid = String(badge.usuario_uid);
    await createNotification(
      uid, event.id, "insignia", "Insígnia confirmada no seu perfil",
      `Parabéns! A insígnia ${name}${season} foi registrada no seu perfil.`,
      `/perfil/${encodeURIComponent(uid)}`,
    );
  },
);
