"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGreatPlateauParticipant = exports.openGreatPlateauRegistrationsOnSeasonStart = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const adminSdk_1 = require("./adminSdk");
const REGION = "southamerica-east1";
const MIN_BADGES = 8;
function tournamentId(seasonId, league) {
    return `${seasonId}__${encodeURIComponent(league).replace(/%/g, "_")}`;
}
function isValidSeasonBadge(badge) {
    return Boolean(badge.usuario_uid && badge.ginasio_id)
        && badge.ginasio_id !== "santo-antonio"
        && badge.tipo !== "trofeu_great_plateau"
        && badge.invalidado !== true
        && badge.revogada !== true
        && badge.status !== "revogada";
}
exports.openGreatPlateauRegistrationsOnSeasonStart = (0, firestore_1.onDocumentWritten)({ document: "temporadas/{seasonId}", region: REGION }, async (event) => {
    const season = event.data?.after;
    if (!season?.exists || season.data()?.ativa !== true)
        return;
    const seasonId = event.params.seasonId;
    const seasonData = season.data();
    const id = tournamentId(seasonId, "Great");
    const tournamentRef = adminSdk_1.db.doc(`campeonatos_liga_ro/${id}`);
    if ((await tournamentRef.get()).exists)
        return;
    await tournamentRef.create({
        nome: `Liga RO — ${seasonData.nome || seasonId}`,
        temporada_id: seasonId,
        temporada_nome: seasonData.nome || seasonId,
        liga: "Great",
        status: "inscricoes",
        formato: "suico_top8_md3",
        rodadas_suico: 4,
        rodadas_suico_criadas: 0,
        rodada_cut: 0,
        cut_size: 0,
        participantes_count: 0,
        regra_insignias: `minimo_${MIN_BADGES}`,
        createdAt: Date.now(),
        createdBy: "system",
        inscricoes_abertas_em: Date.now(),
    }).catch(async (error) => {
        // A criação pode ter sido feita pelo painel de administração ao mesmo tempo.
        if (error?.code !== 6 && error?.code !== "already-exists")
            throw error;
    });
});
exports.registerGreatPlateauParticipant = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Entre na sua conta para se inscrever.");
    const id = typeof request.data?.tournamentId === "string" ? request.data.tournamentId : "";
    if (!id)
        throw new https_1.HttpsError("invalid-argument", "Campeonato inválido.");
    const tournamentRef = adminSdk_1.db.doc(`campeonatos_liga_ro/${id}`);
    const participantRef = tournamentRef.collection("participantes").doc(uid);
    const [tournamentSnap, participantSnap] = await Promise.all([tournamentRef.get(), participantRef.get()]);
    if (!tournamentSnap.exists)
        throw new https_1.HttpsError("not-found", "Campeonato não encontrado.");
    const tournament = tournamentSnap.data();
    if (tournament.status !== "inscricoes")
        throw new https_1.HttpsError("failed-precondition", "As inscrições deste campeonato não estão abertas.");
    if (participantSnap.exists)
        return { enrolled: true, alreadyEnrolled: true };
    const badges = await adminSdk_1.db.collection("insignias")
        .where("usuario_uid", "==", uid)
        .get();
    const gymIds = new Set();
    for (const badgeDoc of badges.docs) {
        const badge = badgeDoc.data();
        if (badge.temporada_id === tournament.temporada_id && isValidSeasonBadge(badge)) {
            gymIds.add(String(badge.ginasio_id));
        }
    }
    if (gymIds.size < MIN_BADGES) {
        throw new https_1.HttpsError("failed-precondition", `Você precisa de pelo menos ${MIN_BADGES} insígnias válidas desta temporada. Encontramos ${gymIds.size}.`);
    }
    const userSnap = await adminSdk_1.db.doc(`usuarios/${uid}`).get();
    const user = userSnap.data() || {};
    const name = String(user.nome || user.nick || request.auth?.token.name || "Treinador").slice(0, 80);
    await adminSdk_1.db.runTransaction(async (transaction) => {
        const [latestTournament, latestParticipant] = await Promise.all([
            transaction.get(tournamentRef), transaction.get(participantRef),
        ]);
        if (!latestTournament.exists || latestTournament.data()?.status !== "inscricoes") {
            throw new https_1.HttpsError("failed-precondition", "As inscrições acabaram de ser encerradas.");
        }
        if (latestParticipant.exists)
            return;
        const seed = Number(latestTournament.data()?.participantes_count || 0) + 1;
        transaction.create(participantRef, {
            usuario_uid: uid,
            nome: name,
            insignias_count: gymIds.size,
            pontos: 0,
            vitorias: 0,
            empates: 0,
            derrotas: 0,
            seed,
            opponents: [],
            byes: 0,
            createdAt: Date.now(),
        });
        transaction.update(tournamentRef, {
            participantes_count: adminSdk_1.FieldValue.increment(1),
            updatedAt: Date.now(),
        });
    });
    return { enrolled: true, alreadyEnrolled: false, badges: gymIds.size };
});
