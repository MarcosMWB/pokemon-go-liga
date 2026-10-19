import { defineSecret } from "firebase-functions/params";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db, admin } from "./adminSdk";

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const REGION = "southamerica-east1";
const SITE_URL = process.env.PUBLIC_SITE_URL || "https://pokemon-go-liga.vercel.app";

function escapeHtml(value: unknown): string {
  const escaped: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>\"']/g, (char) => escaped[char]);
}

async function sendOptedInEmail(
  uid: string,
  eventId: string,
  subject: string,
  message: string,
  linkPath: string,
): Promise<void> {
  if (!uid) return;

  const privateSnap = await db.doc(`usuarios_private/${uid}`).get();
  if (privateSnap.get("email_notifications.enabled") !== true) return;

  const authUser = await admin.auth().getUser(uid);
  if (!authUser.email || !authUser.emailVerified) return;

  const from = process.env.MAIL_FROM;
  if (!from) throw new Error("MAIL_FROM não configurado para os avisos por e-mail.");

  const url = `${SITE_URL}${linkPath}`;
  const profileUrl = `${SITE_URL}/perfil/${encodeURIComponent(uid)}`;
  const safeMessage = escapeHtml(message);
  const safeUrl = escapeHtml(url);
  const safeProfileUrl = escapeHtml(profileUrl);
  const html = [
    "<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033\">",
    "<h2 style=\"color:#7c3aed\">Liga Pokémon GO · Região Oceânica</h2>",
    `<p>${safeMessage}</p>`,
    `<p><a href=\"${safeUrl}\" style=\"display:inline-block;background:#6d28d9;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none\">Abrir no site</a></p>`,
    `<p style=\"font-size:12px;color:#64748b\">Você recebe este aviso porque autorizou notificações por e-mail. Altere essa opção a qualquer momento no seu <a href=\"${safeProfileUrl}\">perfil</a>.</p>`,
    "</div>",
  ].join("");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY.value()}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `liga-${eventId}-${uid}`.slice(0, 240),
    },
    body: JSON.stringify({ from, to: [authUser.email], subject, html, text: `${message}\n\n${url}` }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Falha no provedor de e-mail (${response.status}): ${responseText.slice(0, 300)}`);
  }
}

export const onGymChallengeEmail = onDocumentCreated(
  { document: "desafios_ginasio/{challengeId}", region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const challenge = event.data?.data();
    if (!challenge || challenge.status !== "pendente" || !challenge.lider_uid) return;

    const gymSnap = challenge.ginasio_id
      ? await db.doc(`ginasios/${challenge.ginasio_id}`).get()
      : null;
    const gymName = gymSnap?.data()?.nome || "um ginásio";
    const league = challenge.liga ? `, na liga ${challenge.liga}` : "";
    await sendOptedInEmail(
      challenge.lider_uid,
      event.id,
      "Você recebeu um desafio de ginásio",
      `Você recebeu um novo desafio para ${gymName}${league}. Entre no site para ver os detalhes e combinar a batalha.`,
      challenge.ginasio_id ? `/ginasios/${encodeURIComponent(challenge.ginasio_id)}` : "/ginasios",
    );
  },
);

export const onGymDisputeBattleEmail = onDocumentUpdated(
  { document: "disputas_ginasio/{disputeId}", region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === "batalhando" || after.status !== "batalhando") return;

    const participants = await db.collection("disputas_ginasio_participantes")
      .where("disputa_id", "==", event.params.disputeId)
      .get();
    const gymSnap = after.ginasio_id ? await db.doc(`ginasios/${after.ginasio_id}`).get() : null;
    const gymName = gymSnap?.data()?.nome || "o ginásio";
    const recipients = [...new Set(participants.docs
      .map((participant) => participant.data())
      .filter((participant) => !participant.removido && participant.usuario_uid)
      .map((participant) => String(participant.usuario_uid)))];

    await Promise.all(recipients.map((uid) => sendOptedInEmail(
      uid,
      event.id,
      "A disputa de ginásio começou",
      `A batalha pela liderança de ${gymName} começou. Acesse o site para consultar as informações da disputa.`,
      after.ginasio_id ? `/ginasios/${encodeURIComponent(after.ginasio_id)}` : "/ginasios",
    )));
  },
);

export const onTournamentBattleEmail = onDocumentCreated(
  {
    document: "campeonatos_liga_ro/{tournamentId}/rodadas/{roundId}/partidas/{matchId}",
    region: REGION,
    secrets: [RESEND_API_KEY],
  },
  async (event) => {
    const match = event.data?.data();
    if (!match || match.is_bye === true || match.uid_a === match.uid_b) return;

    const tournamentSnap = await db.doc(`campeonatos_liga_ro/${event.params.tournamentId}`).get();
    const tournamentName = tournamentSnap.data()?.nome || "Campeonato Great Plateau";
    const players = [
      { uid: String(match.uid_a || ""), opponent: match.nome_b || "seu adversário" },
      { uid: String(match.uid_b || ""), opponent: match.nome_a || "seu adversário" },
    ].filter((player) => player.uid);

    await Promise.all(players.map((player) => sendOptedInEmail(
      player.uid,
      event.id,
      "Sua batalha do campeonato foi definida",
      `Uma nova partida de ${tournamentName} foi definida. Seu adversário é ${player.opponent}. Acesse o campeonato para combinar a batalha e registrar o resultado.`,
      `/campeonato-ro/${encodeURIComponent(event.params.tournamentId)}`,
    )));
  },
);

export const onBadgeEarnedEmail = onDocumentCreated(
  { document: "insignias/{badgeId}", region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const badge = event.data?.data();
    if (!badge?.usuario_uid) return;

    const badgeName = badge.ginasio_nome || badge.nome || "uma nova insígnia";
    const season = badge.temporada_nome ? ` da temporada ${badge.temporada_nome}` : "";
    await sendOptedInEmail(
      String(badge.usuario_uid),
      event.id,
      "Insígnia confirmada no seu perfil",
      `Parabéns! A insígnia ${badgeName}${season} foi registrada no seu perfil.`,
      `/perfil/${encodeURIComponent(String(badge.usuario_uid))}`,
    );
  },
);
