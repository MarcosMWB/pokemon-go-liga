"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where,
} from "firebase/firestore";

type EliteDefender = { uid: string; nome: string; pos: number };
type Defender = { uid: string; nome: string };
type Challenge = {
  id: string;
  challenger_uid: string;
  challenger_name: string;
  badge_tournament_id: string;
  liga: string;
  status: string;
  resultado?: string;
  stage: number;
  month_key?: string;
  elites?: EliteDefender[];
  champion?: Defender | null;
  reports?: Record<string, string>;
  team_snapshot?: { temporada_id: string; temporada_nome: string; liga: string; pokemon: string[] };
  elite4_pontos?: number;
  campeao_pp_atribuido?: boolean;
  createdAt?: number;
  deadline_at_ms?: number;
};
type BattleMessage = { id: string; nome: string; text: string };

const functions = () => getFunctions(auth.app, "southamerica-east1");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const call = <T, R>(name: string) => httpsCallable<T, R>(functions(), name);
const statusNames: Record<string, string> = {
  solicitado: "Aguardando início pelo administrador",
  em_andamento: "Desafio em andamento",
  concluido: "Novo Campeão da Região",
  encerrado: "Encerrado automaticamente após sete dias",
};

function defenderFor(challenge: Challenge) {
  if (challenge.stage === 4) return challenge.champion || null;
  return challenge.elites?.[challenge.stage] || null;
}

function stageName(challenge: Challenge) {
  if (challenge.stage === 4) return "Campeão da Região";
  const defender = challenge.elites?.[challenge.stage];
  return defender ? `Elite 4 · posição ${defender.pos}` : `Elite 4 · etapa ${challenge.stage + 1}`;
}

function errorMessage(error: unknown) {
  const candidate = error as { message?: string; details?: { message?: string } };
  return candidate?.details?.message || candidate?.message || "Não foi possível concluir a ação.";
}

export default function DesafioCampeoesPage() {
  const [uid, setUid] = useState("");
  const [admin, setAdmin] = useState(false);
  const [badgeTournament, setBadgeTournament] = useState("");
  const [rows, setRows] = useState<Challenge[]>([]);
  const [champion, setChampion] = useState<Record<string, any> | null>(null);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [messages, setMessages] = useState<Record<string, BattleMessage[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => auth.onAuthStateChanged(async (user: User | null) => {
    setUid(user?.uid || "");
    setAdmin(false);
    setBadgeTournament("");
    if (!user) return;
    try {
      const [adminSnap, badges] = await Promise.all([
        getDoc(doc(db, "superusers", user.uid)),
        getDocs(query(collection(db, "insignias"), where("usuario_uid", "==", user.uid))),
      ]);
      setAdmin(adminSnap.exists());
      const trophies = badges.docs
        .filter((badge) => badge.data().tipo === "trofeu_great_plateau")
        .sort((a, b) => {
          const aTime = Number(a.data().createdAt?.toMillis?.() || a.data().createdAt || 0);
          const bTime = Number(b.data().createdAt?.toMillis?.() || b.data().createdAt || 0);
          return bTime - aTime;
        });
      const trophy = trophies[0]?.data();
      if (trophy?.torneio_id) {
        setBadgeTournament(String(trophy.torneio_id));
      }
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }), []);

  useEffect(() => {
    const unsubscribeChallenges = onSnapshot(collection(db, "desafios_campeoes"), (snapshot) => {
      const challenges = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Challenge));
      challenges.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setRows(challenges);
    }, (error) => setNotice(error.message));
    const unsubscribeChampion = onSnapshot(doc(db, "regiao_campeao", "great_plateau"), (snapshot) => {
      setChampion(snapshot.exists() ? snapshot.data() : null);
    }, (error) => setNotice(error.message));
    return () => { unsubscribeChallenges(); unsubscribeChampion(); };
  }, []);

  useEffect(() => {
    const stops = rows.filter((challenge) => {
      const defender = defenderFor(challenge);
      return challenge.status === "em_andamento" &&
        (uid === challenge.challenger_uid || uid === defender?.uid || admin);
    }).map((challenge) => onSnapshot(
      query(collection(db, "desafios_campeoes", challenge.id, "mensagens"), orderBy("createdAt")),
      (snapshot) => setMessages((old) => ({
        ...old,
        [challenge.id]: snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BattleMessage)),
      })),
    ));
    return () => stops.forEach((stop) => stop());
  }, [rows, uid, admin]);

  async function request() {
    if (!uid || !badgeTournament) return;
    setBusyId("request"); setNotice("");
    try {
      await call<{ badgeTournamentId: string }, { ok: boolean; monthKey: string }>("requestChampionChallenge")({ badgeTournamentId: badgeTournament });
      setNotice("Pedido enviado. Com o Troféu Santo Antônio, você pode desafiar uma vez por mês, independentemente da temporada.");
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusyId(""); }
  }

  async function start(challenge: Challenge) {
    if (!admin || challenge.status !== "solicitado") return;
    setBusyId(challenge.id); setNotice("");
    try {
      const [elitesSnapshot, championSnapshot, trophyTournament, activeSeasonSnapshot] = await Promise.all([
        getDocs(query(collection(db, "elite4"), where("liga", "==", challenge.liga))),
        getDoc(doc(db, "regiao_campeao", "great_plateau")),
        getDoc(doc(db, "campeonatos_liga_ro", challenge.badge_tournament_id)),
        getDocs(query(collection(db, "temporadas"), where("ativa", "==", true))),
      ]);
      const eliteRows = elitesSnapshot.docs.map((item) => ({
        uid: String(item.data().uid || item.id),
        pos: Number(item.data().pos || 0),
      })).sort((a, b) => a.pos - b.pos);
      if (eliteRows.length !== 4 || eliteRows.some((elite, index) => elite.pos !== index + 1 || !elite.uid)) {
        throw new Error(`A liga ${challenge.liga} precisa ter as posições 1, 2, 3 e 4 da Elite 4 configuradas.`);
      }

      const trophySeason = trophyTournament.exists() ? trophyTournament.data() : {};
      const activeSeason = activeSeasonSnapshot.docs[0];
      const seasons = [
        ...(activeSeason ? [{ id: activeSeason.id, nome: String(activeSeason.data().nome || activeSeason.id) }] : []),
        ...(trophySeason.temporada_id && trophySeason.temporada_id !== activeSeason?.id
          ? [{ id: String(trophySeason.temporada_id), nome: String(trophySeason.temporada_nome || "Temporada") }] : []),
      ];
      const leagueSnapshot = await getDocs(query(collection(db, "ligas"), where("nome", "==", challenge.liga)));
      if (leagueSnapshot.empty) throw new Error("Não foi possível localizar a liga da equipe registrada.");

      let team: { seasonId: string; seasonName: string; pokemon: string[] } | null = null;
      for (const season of seasons) {
        const teams = await getDocs(query(
          collection(db, "participacoes"),
          where("usuario_id", "==", challenge.challenger_uid),
          where("liga_id", "==", leagueSnapshot.docs[0].id),
          where("temporada_id", "==", season.id),
        ));
        if (teams.empty) continue;
        const pokemonSnapshot = await getDocs(query(collection(db, "pokemon"), where("participacao_id", "==", teams.docs[0].id)));
        const pokemon = pokemonSnapshot.docs.map((item) => String(item.data().nome || "")).filter(Boolean).slice(0, 6);
        if (pokemon.length) { team = { seasonId: season.id, seasonName: season.nome, pokemon }; break; }
      }
      if (!team) throw new Error("O desafiante precisa ter uma equipe registrada com Pokémon para guardar no Hall da Fama.");

      const elites = await Promise.all([...eliteRows].reverse().map(async (elite) => {
        const user = await getDoc(doc(db, "usuarios", elite.uid));
        return { uid: elite.uid, pos: elite.pos, nome: user.exists() ? String(user.data().nome || user.data().nick || elite.uid) : elite.uid };
      }));
      const currentChampion = championSnapshot.exists() && championSnapshot.data().campeao_uid
        ? { uid: String(championSnapshot.data().campeao_uid), nome: String(championSnapshot.data().campeao_nome || "Campeão da Região") }
        : null;
      await updateDoc(doc(db, "desafios_campeoes", challenge.id), {
        status: "em_andamento", stage: 0, elites, champion: currentChampion,
        team_snapshot: { temporada_id: team.seasonId, temporada_nome: team.seasonName, liga: challenge.liga, pokemon: team.pokemon },
        reports: {}, startedAt: Date.now(), stage_started_at_ms: Date.now(), deadline_at_ms: Date.now() + WEEK_MS,
      });
      setNotice(`Desafio iniciado: Elite 4 posição 4, depois 3, 2 e 1${currentChampion ? ", e então o Campeão da Região" : ". Como ainda não há campeão, vencer a Elite 4 dará o título."}.`);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusyId(""); }
  }

  async function report(challenge: Challenge, result: string) {
    const defender = defenderFor(challenge);
    if (uid !== challenge.challenger_uid && uid !== defender?.uid) { setNotice("Somente os dois treinadores desta batalha podem declarar o resultado."); return; }
    setBusyId(challenge.id); setNotice("");
    try {
      await call<{ challengeId: string; winnerUid: string }, { ok: boolean }>("reportChampionChallengeResult")({ challengeId: challenge.id, winnerUid: result });
      setNotice("Resultado registrado. O administrador avançará a etapa quando os dois relatos coincidirem.");
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusyId(""); }
  }

  async function advance(challenge: Challenge) {
    setBusyId(challenge.id); setNotice("");
    try {
      const result = await call<{ challengeId: string }, { status: string; stage?: number; pontosElite4?: number; campeaoPP?: number; campeao?: string }>("advanceChampionChallenge")({ challengeId: challenge.id });
      const outcome = result.data;
      if (outcome.status === "em_andamento") {
        const next = challenge.elites?.[outcome.stage || 0];
        setNotice(next ? `Resultado confirmado. Próxima etapa: Elite 4 posição ${next.pos}.` : "Resultado confirmado. Próxima etapa aberta.");
      } else if (outcome.campeao) {
        setNotice(`${outcome.campeao} é o novo Campeão da Região. O reinado começou e foi registrado no Hall da Fama.`);
      } else if (outcome.campeaoPP) {
        setNotice(`O Campeão manteve o título e recebeu ${outcome.campeaoPP} PP.`);
      } else {
        setNotice(`Desafio encerrado. O membro da Elite 4 que venceu recebeu ${outcome.pontosElite4 || 100} pontos.`);
      }
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusyId(""); }
  }

  async function sendMessage(challenge: Challenge) {
    const text = (drafts[challenge.id] || "").trim();
    const defender = defenderFor(challenge);
    if (!text || !uid || (uid !== challenge.challenger_uid && uid !== defender?.uid)) {
      setNotice("O chat é exclusivo dos dois treinadores desta batalha."); return;
    }
    try {
      const profile = await getDoc(doc(db, "usuarios", uid));
      await addDoc(collection(db, "desafios_campeoes", challenge.id, "mensagens"), {
        from: uid, nome: profile.data()?.nome || auth.currentUser?.displayName || "Treinador",
        text: text.slice(0, 1000), createdAt: serverTimestamp(),
      });
      setDrafts((old) => ({ ...old, [challenge.id]: "" }));
    } catch (error) { setNotice(errorMessage(error)); }
  }

  return <main className="mx-auto max-w-4xl space-y-5 p-6">
    <header>
      <h1 className="text-3xl font-bold">Desafio dos Campeões</h1>
      <p className="mt-2 text-sm text-slate-600">Com um Troféu Santo Antônio, você pode desafiar uma vez por mês, mesmo em temporadas diferentes. Vença a Elite 4 em sequência, da posição 4 até a 1. Depois terá uma única batalha contra o Campeão atual.</p>
    </header>

    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <b>Campeão da Região:</b> {champion?.campeao_nome || "Ainda não definido"}
      {champion?.liga && <span> · {champion.liga}</span>}
      {champion?.inicioAt && <p className="mt-1 text-sm">Reinado iniciado em {new Date(Number(champion.inicioAt)).toLocaleDateString("pt-BR")}.</p>}
    </div>

    {badgeTournament && <section className="rounded border p-4">
      <h2 className="font-semibold">Você possui um Troféu Santo Antônio</h2>
      <p className="my-2 text-sm">Sua elegibilidade não expira com a temporada. Você pode solicitar uma tentativa por mês.</p>
      <button disabled={busyId === "request"} onClick={request} className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">
        {busyId === "request" ? "Enviando pedido…" : "Solicitar desafio deste mês"}
      </button>
    </section>}

    {notice && <p role="status" className="rounded bg-blue-50 p-3 text-sm">{notice}</p>}

    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Desafios</h2>
      {!rows.length && <p className="text-sm text-slate-500">Ainda não há desafios registrados.</p>}
      {rows.map((challenge) => {
        const defender = defenderFor(challenge);
        const isPlayer = uid === challenge.challenger_uid || uid === defender?.uid;
        const reportRole = uid === challenge.challenger_uid ? "challenger" : uid === defender?.uid ? "defender" : "";
        const ownReport = reportRole ? challenge.reports?.[reportRole] : undefined;
        const reportsAgree = Boolean(challenge.reports?.challenger && challenge.reports.challenger === challenge.reports.defender);
        return <article key={challenge.id} className="space-y-3 rounded border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <b>{challenge.challenger_name} · Liga {challenge.liga}</b>
              <p className="text-sm">{statusNames[challenge.status] || challenge.status}{challenge.month_key ? ` · tentativa de ${challenge.month_key}` : ""}</p>
            </div>
            {admin && challenge.status === "solicitado" && <button disabled={busyId === challenge.id} onClick={() => start(challenge)} className="rounded bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50">Iniciar desafio</button>}
          </div>

          {challenge.status === "em_andamento" && defender && <div className="space-y-3 rounded bg-slate-50 p-3">
            <p className="font-medium">Etapa {challenge.stage + 1}: {challenge.challenger_name} × {defender.nome} ({stageName(challenge)})</p>
            <p className="text-xs text-slate-600">Prazo desta batalha: {challenge.deadline_at_ms ? new Date(challenge.deadline_at_ms).toLocaleString("pt-BR") : "sete dias após o início"}. Se só um lado declarar vencedor, a vitória será registrada por W.O. ao fim do prazo.</p>
            {isPlayer && !ownReport && <div className="flex flex-wrap gap-2">
              <button disabled={busyId === challenge.id} onClick={() => report(challenge, challenge.challenger_uid)} className="rounded bg-blue-700 px-3 py-2 text-sm text-white">Vitória de {challenge.challenger_name}</button>
              <button disabled={busyId === challenge.id} onClick={() => report(challenge, defender.uid)} className="rounded border bg-white px-3 py-2 text-sm">Vitória de {defender.nome}</button>
            </div>}
            {isPlayer && ownReport && <p className="text-sm">Seu resultado foi registrado: {ownReport === challenge.challenger_uid ? challenge.challenger_name : defender.nome}. Aguardando confirmação do outro treinador.</p>}
            <p className="text-xs text-slate-600">Relatos: desafiante {challenge.reports?.challenger ? "✓" : "—"} · defensor {challenge.reports?.defender ? "✓" : "—"}</p>
            {admin && <button disabled={busyId === challenge.id || !reportsAgree} onClick={() => advance(challenge)} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Confirmar resultado e avançar</button>}
            <div className="rounded border bg-white p-3">
              <b className="text-sm">Chat da batalha</b>
              <div className="my-2 max-h-40 space-y-1 overflow-auto">{(messages[challenge.id] || []).map((message) => <p key={message.id} className="text-sm"><b>{message.nome}:</b> {message.text}</p>)}</div>
              {isPlayer && <div className="flex gap-2">
                <input value={drafts[challenge.id] || ""} onChange={(event) => setDrafts((old) => ({ ...old, [challenge.id]: event.target.value }))} maxLength={1000} className="min-w-0 flex-1 rounded border px-2 py-2 text-sm" placeholder="Combine a batalha" />
                <button onClick={() => sendMessage(challenge)} className="rounded bg-slate-800 px-3 text-sm text-white">Enviar</button>
              </div>}
            </div>
          </div>}

          {challenge.status === "encerrado" && <p className="rounded bg-slate-50 p-3 text-sm">
            {challenge.resultado === "campeao_manteve_titulo" ? `O Campeão ${challenge.champion?.nome || "atual"} manteve o título e recebeu ${challenge.campeao_pp_atribuido ? 10 : 0} PP.` : challenge.resultado === "elite4_manteve_vaga" ? `A Elite 4 venceu esta etapa e recebeu ${challenge.elite4_pontos || 100} pontos na disputa.` : challenge.resultado === "relatos_divergentes" ? "O desafio foi encerrado sem vencedor porque os relatos divergiram." : "O desafio foi encerrado após sete dias sem resultado válido. Nenhum prêmio foi aplicado."}
          </p>}
          {challenge.status === "concluido" && <p className="rounded bg-amber-50 p-3 font-semibold text-amber-900">🏆 {challenge.challenger_name} é o novo Campeão Regional. O período do título foi iniciado no Hall da Fama.</p>}
        </article>;
      })}
    </section>
  </main>;
}
