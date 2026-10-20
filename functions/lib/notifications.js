"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onBadgeEarnedNotification = exports.onTournamentBattleNotification = exports.onGymDisputeBattleNotification = exports.onElite4ChallengeNotification = exports.onGymChallengeNotification = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const adminSdk_1 = require("./adminSdk");
const REGION = "southamerica-east1";
async function createNotification(uid, eventId, type, title, message, href) {
    if (!uid)
        return;
    const privateSnap = await adminSdk_1.db.doc(`usuarios_private/${uid}`).get();
    if (privateSnap.get("notifications.enabled") !== true)
        return;
    const notificationId = `${eventId}_${uid}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 140);
    await adminSdk_1.db.doc(`notificacoes/${uid}/itens/${notificationId}`).create({
        tipo: type,
        titulo: title,
        mensagem: message,
        href,
        lida: false,
        createdAt: adminSdk_1.FieldValue.serverTimestamp(),
    }).catch((error) => {
        // Firestore ALREADY_EXISTS (6): retries must not duplicate an inbox item.
        if (error.code !== 6)
            throw error;
    });
}
exports.onGymChallengeNotification = (0, firestore_1.onDocumentCreated)({ document: "desafios_ginasio/{challengeId}", region: REGION }, async (event) => {
    const challenge = event.data?.data();
    if (!challenge || challenge.status !== "pendente" || !challenge.lider_uid)
        return;
    const gymSnap = challenge.ginasio_id ? await adminSdk_1.db.doc(`ginasios/${challenge.ginasio_id}`).get() : null;
    const gymName = gymSnap?.data()?.nome || "um ginásio";
    const league = challenge.liga ? `, na liga ${challenge.liga}` : "";
    await createNotification(String(challenge.lider_uid), event.id, "desafio_ginasio", "Você recebeu um desafio de ginásio", `Você recebeu um novo desafio para ${gymName}${league}. Acesse o site para ver os detalhes e combinar a batalha.`, challenge.ginasio_id ? `/ginasios/${encodeURIComponent(challenge.ginasio_id)}` : "/ginasios");
});
exports.onElite4ChallengeNotification = (0, firestore_1.onDocumentCreated)({ document: "desafios_elite4/{challengeId}", region: REGION }, async (event) => {
    const challenge = event.data?.data();
    if (!challenge || challenge.status !== "pendente")
        return;
    await createNotification(String(challenge.target_uid || ""), event.id, "desafio_elite4", "Você recebeu um desafio da Elite 4", `${challenge.challenger_nome || "Um treinador"} desafiou você na liga ${challenge.liga || "Pokémon GO"}. Você tem uma semana para aceitar e combinar a batalha.`, "/elite4/placar?liga=" + encodeURIComponent(String(challenge.liga || "Great")));
});
exports.onGymDisputeBattleNotification = (0, firestore_1.onDocumentUpdated)({ document: "disputas_ginasio/{disputeId}", region: REGION }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === "batalhando" || after.status !== "batalhando")
        return;
    const [participants, gymSnap] = await Promise.all([
        adminSdk_1.db.collection("disputas_ginasio_participantes").where("disputa_id", "==", event.params.disputeId).get(),
        after.ginasio_id ? adminSdk_1.db.doc(`ginasios/${after.ginasio_id}`).get() : Promise.resolve(null),
    ]);
    const gymName = gymSnap?.data()?.nome || "o ginásio";
    const uids = [...new Set(participants.docs.map((d) => d.data())
            .filter((p) => !p.removido && p.usuario_uid).map((p) => String(p.usuario_uid)))];
    await Promise.all(uids.map((uid) => createNotification(uid, event.id, "disputa_ginasio", "A disputa de ginásio começou", `A batalha pela liderança de ${gymName} começou. Acesse o site para consultar os detalhes.`, after.ginasio_id ? `/ginasios/${encodeURIComponent(after.ginasio_id)}` : "/ginasios")));
});
exports.onTournamentBattleNotification = (0, firestore_1.onDocumentCreated)({ document: "campeonatos_liga_ro/{tournamentId}/rodadas/{roundId}/partidas/{matchId}", region: REGION }, async (event) => {
    const match = event.data?.data();
    if (!match || match.is_bye === true || match.uid_a === match.uid_b)
        return;
    const tournamentSnap = await adminSdk_1.db.doc(`campeonatos_liga_ro/${event.params.tournamentId}`).get();
    const name = tournamentSnap.data()?.nome || "Campeonato Great Plateau";
    const players = [
        { uid: String(match.uid_a || ""), opponent: match.nome_b || "seu adversário" },
        { uid: String(match.uid_b || ""), opponent: match.nome_a || "seu adversário" },
    ].filter((p) => p.uid);
    await Promise.all(players.map((p) => createNotification(p.uid, event.id, "batalha_campeonato", "Sua batalha do campeonato foi definida", `Uma nova partida de ${name} foi definida. Seu adversário é ${p.opponent}. Acesse o campeonato para combinar a batalha e registrar o resultado.`, `/campeonato-ro/${encodeURIComponent(event.params.tournamentId)}`)));
});
exports.onBadgeEarnedNotification = (0, firestore_1.onDocumentCreated)({ document: "insignias/{badgeId}", region: REGION }, async (event) => {
    const badge = event.data?.data();
    if (!badge?.usuario_uid)
        return;
    const name = badge.ginasio_nome || badge.nome || (badge.tipo === "trofeu_great_plateau" ? "Troféu Santo Antônio" : "uma nova insígnia");
    const season = badge.temporada_nome ? ` da temporada ${badge.temporada_nome}` : "";
    const uid = String(badge.usuario_uid);
    await createNotification(uid, event.id, "insignia", "Insígnia confirmada no seu perfil", `Parabéns! A insígnia ${name}${season} foi registrada no seu perfil.`, `/perfil/${encodeURIComponent(uid)}`);
});
