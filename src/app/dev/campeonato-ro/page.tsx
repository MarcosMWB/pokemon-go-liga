"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { rankParticipants, swissPairings, topCutOpeningOrder, topCutSize, type GPParticipant } from "@/lib/greatPlateau";
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";

type Tournament = {
  id: string; temporada_id: string; temporada_nome: string; liga: string; createdAt?: number; participantes_count?: number;
  status: "inscricoes" | "suico" | "cut_pendente" | "top_cut" | "aguardando_trofeu" | "finalizado" | "finalizado_sem_campeao";
  rodadas_suico: number; rodadas_suico_criadas: number; rodada_cut: number;
  cut_size: number; vencedor_uid?: string; vencedor_nome?: string; inicio_batalhas_em?: number;
};
type Participant = GPParticipant & { vitorias: number; empates: number; derrotas: number; insignias_count: number };
type Match = {
  id: string; uid_a: string; uid_b: string; nome_a: string; nome_b: string;
  report_a?: string | null; report_b?: string | null; winner_uid?: string | null; status?: string;
  ordem: number; seed_a?: number; seed_b?: number; tipo?: "suico" | "top_cut"; deadline_at_ms?: number; metodo_resultado?: string; is_bye?: boolean;
};
type Round = { id: string; tipo: "suico" | "top_cut"; numero: number; status: string; bye_uid?: string };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function errorText(e: unknown) { return e instanceof Error ? e.message : "Ocorreu um erro inesperado."; }

export default function DevCampeonatoROPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [temporada, setTemporada] = useState<{ id: string; nome: string } | null>(null);
  const [ligas, setLigas] = useState<string[]>([]);
  const [liga, setLiga] = useState("Great");
  const [torneios, setTorneios] = useState<Tournament[]>([]);
  const [torneioId, setTorneioId] = useState("");
  const [participantes, setParticipantes] = useState<Participant[]>([]);
  const [rodadas, setRodadas] = useState<Round[]>([]);
  const [partidas, setPartidas] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [agora, setAgora] = useState(() => Date.now());

  const torneio = torneios.find((t) => t.id === torneioId) || null;
  const rodadaAtualId = torneio?.status === "suico"
    ? `suico_${torneio.rodadas_suico_criadas}`
    : torneio?.status === "top_cut" ? `topcut_${torneio.rodada_cut}` : "";
  const rodadaAtual = rodadas.find((r) => r.id === rodadaAtualId) || null;
  const ranking = useMemo(() => rankParticipants(participantes), [participantes]);
  const chaveamentoPrevio = useMemo(() => swissPairings(participantes, 1), [participantes]);

  useEffect(() => {
    if (!torneio?.inicio_batalhas_em) { setDataInicio(""); return; }
    const local = new Date(torneio.inicio_batalhas_em - new Date().getTimezoneOffset() * 60000);
    setDataInicio(local.toISOString().slice(0, 16));
  }, [torneio?.id, torneio?.inicio_batalhas_em]);

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => auth.onAuthStateChanged(async (user: User | null) => {
    if (!user) { setIsAdmin(false); router.replace("/login"); return; }
    const snap = await getDoc(doc(db, "superusers", user.uid));
    if (!snap.exists()) { setIsAdmin(false); router.replace("/"); return; }
    setIsAdmin(true);
  }), [router]);

  useEffect(() => {
    if (isAdmin !== true) return;
    const unsubSeason = onSnapshot(query(collection(db, "temporadas"), where("ativa", "==", true)), (snap) => {
      const active = snap.docs[0];
      setTemporada(active ? { id: active.id, nome: active.data().nome || active.id } : null);
    });
    const unsubLigas = onSnapshot(collection(db, "ligas"), (snap) => {
      const values = snap.docs.map((d) => String(d.data().nome || d.id));
      setLigas(values);
      if (values.length && !values.includes(liga)) setLiga(values.includes("Great") ? "Great" : values[0]);
    });
    const unsubTours = onSnapshot(collection(db, "campeonatos_liga_ro"), (snap) => {
      const values = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Tournament[];
      values.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setTorneios(values);
      setTorneioId((old) => old && values.some((t) => t.id === old) ? old : values[0]?.id || "");
    });
    return () => { unsubSeason(); unsubLigas(); unsubTours(); };
  }, [isAdmin, liga]);

  useEffect(() => {
    if (isAdmin !== true || !torneioId) { setParticipantes([]); setRodadas([]); return; }
    const unsubParts = onSnapshot(collection(db, "campeonatos_liga_ro", torneioId, "participantes"), (snap) => {
      setParticipantes(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) })) as Participant[]);
    });
    const unsubRounds = onSnapshot(collection(db, "campeonatos_liga_ro", torneioId, "rodadas"), (snap) => {
      setRodadas(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Round[]);
    });
    return () => { unsubParts(); unsubRounds(); };
  }, [isAdmin, torneioId]);

  useEffect(() => {
    if (!isAdmin || !torneioId || !rodadaAtualId) { setPartidas([]); return; }
    const unsub = onSnapshot(collection(db, "campeonatos_liga_ro", torneioId, "rodadas", rodadaAtualId, "partidas"), (snap) => {
      setPartidas(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Match[]);
    });
    return () => unsub();
  }, [isAdmin, torneioId, rodadaAtualId]);

  function idDoTorneio(seasonId: string, league: string) {
    return `${seasonId}__${encodeURIComponent(league).replaceAll("%", "_")}`;
  }

  async function abrirInscricoes() {
    if (!temporada) { setMessage("Marque uma temporada como ativa antes de abrir as inscrições."); return; }
    setBusy(true); setMessage("");
    try {
      const id = idDoTorneio(temporada.id, liga);
      const ref = doc(db, "campeonatos_liga_ro", id);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        setTorneioId(id);
        setMessage("As inscrições para esta temporada já estão abertas.");
        return;
      }
      await runTransaction(db, async (transaction) => {
        const current = await transaction.get(ref);
        if (current.exists()) return;
        transaction.set(ref, {
          nome: `Liga RO — ${temporada.nome}`,
          temporada_id: temporada.id,
          temporada_nome: temporada.nome,
          liga,
          status: "inscricoes",
          formato: "suico_top8_md3",
          rodadas_suico: 4,
          rodadas_suico_criadas: 0,
          rodada_cut: 0,
          cut_size: 0,
          participantes_count: 0,
          regra_insignias: "minimo_8",
          createdAt: Date.now(),
          createdBy: auth.currentUser?.uid || "",
          inscricoes_abertas_em: Date.now(),
        });
      });
      setTorneioId(id);
      setMessage("Inscrições abertas. Jogadores com pelo menos 8 insígnias válidas da temporada podem se cadastrar.");
    } catch (e) { setMessage(`Não foi possível iniciar: ${errorText(e)}`); }
    finally { setBusy(false); }
  }

  async function salvarDataInicio() {
    if (!torneio || !dataInicio) { setMessage("Escolha a data e o horário das batalhas."); return; }
    const timestamp = new Date(dataInicio).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) { setMessage("A data de início precisa estar no futuro."); return; }
    setBusy(true); setMessage("");
    try {
      await updateDoc(doc(db, "campeonatos_liga_ro", torneio.id), { inicio_batalhas_em: timestamp });
      setMessage("Data de início das batalhas salva.");
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }

  async function iniciarBatalhas() {
    if (!torneio || torneio.status !== "inscricoes") return;
    if (participantes.length < 2) { setMessage("São necessários pelo menos 2 inscritos para iniciar."); return; }
    const startAt = torneio.inicio_batalhas_em || 0;
    if (!startAt || Date.now() < startAt || Date.now() > startAt + 7 * 86400000) {
      setMessage("As batalhas só podem começar na semana definida para o torneio."); return;
    }
    setBusy(true); setMessage("");
    try {
      const rounds = participantes.length >= 16 ? 5 : 4;
      const result = swissPairings(participantes, 1);
      await createRound("suico_1", "suico", 1, result.pairings, result.bye, participantes);
      await updateDoc(doc(db, "campeonatos_liga_ro", torneio.id), {
        status: "suico", rodadas_suico: rounds, inscricoes_encerradas_em: Date.now(),
      });
      setMessage(`Inscrições encerradas. Rodada 1 iniciada com ${result.pairings.length} partida(s).`);
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }

  async function createRound(id: string, type: "suico" | "top_cut", number: number,
    pairings: Array<{ a: GPParticipant; b: GPParticipant; seedA?: number; seedB?: number }>, bye?: GPParticipant | null,
    standings: Participant[] = participantes) {
    if (!torneio) throw new Error("Selecione um campeonato.");
    const batch = writeBatch(db);
    const roundRef = doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", id);
    batch.set(roundRef, { tipo: type, numero: number, status: "aberta", bye_uid: bye?.uid || "", createdAt: Date.now() });
    pairings.forEach(({ a, b, seedA, seedB }, index) => batch.set(
      doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", id, "partidas", `partida_${String(index + 1).padStart(2, "0")}`),
      { uid_a: a.uid, uid_b: b.uid, nome_a: a.nome, nome_b: b.nome,
        report_a: null, report_b: null, winner_uid: null, status: "agendada",
        ordem: index + 1, seed_a: seedA || a.seed, seed_b: seedB || b.seed, tipo: type, createdAt: Date.now(), deadline_at_ms: Date.now() + WEEK_MS }
    ));
    if (bye) {
      const p = standings.find((item) => item.uid === bye.uid)!;
      batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "participantes", bye.uid), {
        pontos: p.pontos + 3, vitorias: p.vitorias + 1, byes: p.byes + 1,
      });
      batch.set(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", id, "partidas", "bye"), {
        uid_a: bye.uid, uid_b: "", nome_a: bye.nome, nome_b: "Folga",
        report_a: bye.uid, report_b: bye.uid, winner_uid: bye.uid, status: "confirmada",
        ordem: pairings.length + 1, tipo: type, is_bye: true, createdAt: Date.now(),
      });
    }
    batch.update(doc(db, "campeonatos_liga_ro", torneio.id), type === "suico"
      ? { rodadas_suico_criadas: number, status: "suico" }
      : { rodada_cut: number, cut_size: torneio.cut_size || pairings.length * 2, status: "top_cut" });
    await batch.commit();
  }

  async function settleRoundAndApplyScores(round: Round, standings: Participant[]) {
    if (!torneio) throw new Error("Selecione um campeonato.");
    const matchSnap = await getDocs(collection(db, "campeonatos_liga_ro", torneio.id, "rodadas", round.id, "partidas"));
    const matches = matchSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Match[];
    const scored = new Map(standings.map((p) => [p.uid, { ...p }]));
    for (const m of matches) {
      if (m.id === "bye") continue;
      if (m.status === "encerrada_sem_resultado") continue;
      if (m.status !== "confirmada" && (!m.report_a || !m.report_b || m.report_a !== m.report_b)) {
        throw new Error(`A partida ${m.nome_a} × ${m.nome_b} ainda não tem resultado confirmado pelos dois jogadores.`);
      }
      const result = m.status === "confirmada" ? (m.winner_uid || (m.report_a === "empate" ? "empate" : "")) : m.report_a;
      if (round.tipo === "top_cut" && result === "empate") throw new Error("O Top Cut não aceita empate; resolva a partida antes de avançar.");
      const a = scored.get(m.uid_a); const b = scored.get(m.uid_b);
      if (!a || !b) throw new Error("Participante da partida não encontrado.");
      if (round.tipo === "suico") {
        if (result === "empate") { a.pontos += 1; b.pontos += 1; a.empates += 1; b.empates += 1; }
        else if (result === m.uid_a) { a.pontos += 3; a.vitorias += 1; b.derrotas += 1; }
        else if (result === m.uid_b) { b.pontos += 3; b.vitorias += 1; a.derrotas += 1; }
        a.opponents = [...a.opponents, b.uid]; b.opponents = [...b.opponents, a.uid];
      }
    }
    return { matches, scored };
  }

  async function iniciarProximaSuica() {
    if (!torneio) return;
    setBusy(true); setMessage("");
    try {
      let current = [...participantes];
      const currentRound = rodadas.find((r) => r.id === `suico_${torneio.rodadas_suico_criadas}`);
      if (currentRound) {
        const settled = await settleRoundAndApplyScores(currentRound, current);
        current = [...settled.scored.values()];
        const batch = writeBatch(db);
        for (const p of current) batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "participantes", p.uid), {
          pontos: p.pontos, vitorias: p.vitorias, empates: p.empates, derrotas: p.derrotas, opponents: p.opponents,
        });
        settled.matches.forEach((m) => batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", currentRound.id, "partidas", m.id),
          m.status === "encerrada_sem_resultado" ? { resolvedAt: Date.now() } : { status: "confirmada", winner_uid: m.winner_uid || (m.report_a === m.report_b ? m.report_a : null), resolvedAt: Date.now() }));
        batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", currentRound.id), { status: "finalizada", closedAt: Date.now() });
        await batch.commit();
      }
      const next = torneio.rodadas_suico_criadas + 1;
      if (next > torneio.rodadas_suico) { setMessage("Todas as rodadas suíças terminaram. Gere o Top Cut."); return; }
      const result = swissPairings(current, next);
      await createRound(`suico_${next}`, "suico", next, result.pairings, result.bye, current);
      setMessage(`Rodada suíça ${next} gerada: ${result.pairings.length} partida(s)${result.bye ? ` e folga para ${result.bye.nome}` : ""}.`);
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }

  async function iniciarTopCut() {
    if (!torneio || torneio.status !== "suico" || torneio.rodadas_suico_criadas !== torneio.rodadas_suico) return;
    setBusy(true); setMessage("");
    try {
      let current = [...participantes];
      const finalSwiss = rodadas.find((r) => r.id === "suico_" + torneio.rodadas_suico);
      if (!finalSwiss) throw new Error("A última rodada suíça ainda não foi criada.");
      const settled = await settleRoundAndApplyScores(finalSwiss, current);
      current = rankParticipants([...settled.scored.values()]);
      const cutSize = topCutSize(current.length);
      if (cutSize < 2) throw new Error("São necessários pelo menos dois participantes para o Top Cut.");
      const selected = current.slice(0, cutSize);
      const order = topCutOpeningOrder(cutSize);
      const bySeed = new Map(selected.map((p, i) => [i + 1, p]));
      const pairings = [];
      for (let i = 0; i < order.length; i += 2) pairings.push({ a: bySeed.get(order[i])!, b: bySeed.get(order[i + 1])!, seedA: order[i], seedB: order[i + 1] });
      const batch = writeBatch(db);
      for (const p of current) batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "participantes", p.uid), {
        pontos: p.pontos, vitorias: p.vitorias, empates: p.empates, derrotas: p.derrotas, opponents: p.opponents,
        colocacao_suico: current.findIndex((x) => x.uid === p.uid) + 1,
      });
      settled.matches.forEach((m) => batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", finalSwiss.id, "partidas", m.id),
          m.status === "encerrada_sem_resultado" ? { resolvedAt: Date.now() } : { status: "confirmada", winner_uid: m.winner_uid || (m.report_a === m.report_b ? m.report_a : null), resolvedAt: Date.now() }));
      batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", finalSwiss.id), { status: "finalizada", closedAt: Date.now() });
      batch.update(doc(db, "campeonatos_liga_ro", torneio.id), { cut_size: cutSize, status: "top_cut", rodada_cut: 1 });
      for (let i = 0; i < pairings.length; i++) {
        const pairing = pairings[i];
        const partidaId = "partida_" + (i + 1 < 10 ? "0" : "") + String(i + 1);
        batch.set(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", "topcut_1", "partidas", partidaId), {
          uid_a: pairing.a.uid, uid_b: pairing.b.uid, nome_a: pairing.a.nome, nome_b: pairing.b.nome,
          report_a: null, report_b: null, winner_uid: null, status: "agendada", ordem: i + 1,
          seed_a: pairing.seedA, seed_b: pairing.seedB, tipo: "top_cut", createdAt: Date.now(), deadline_at_ms: Date.now() + WEEK_MS,
        });
      }
      batch.set(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", "topcut_1"), {
        tipo: "top_cut", numero: 1, status: "aberta", createdAt: Date.now(),
      });
      await batch.commit();
      setMessage("Top Cut iniciado com " + cutSize + " jogadores, em partidas melhor de 3.");
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }

  async function avançarTopCut() {
    if (!torneio || torneio.status !== "top_cut") return;
    setBusy(true); setMessage("");
    try {
      const round = rodadas.find((r) => r.id === "topcut_" + torneio.rodada_cut);
      if (!round) throw new Error("Rodada do Top Cut não encontrada.");
      const snap = await getDocs(collection(db, "campeonatos_liga_ro", torneio.id, "rodadas", round.id, "partidas"));
      const matches = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Match[];
      if (matches.some((m) => m.status !== "encerrada_sem_resultado" && (m.status !== "confirmada" || !m.winner_uid || m.winner_uid === "empate"))) {
        throw new Error("Todas as partidas precisam de resultados iguais informados pelos dois jogadores.");
      }
      const winners = matches.filter((m) => m.status !== "encerrada_sem_resultado").sort((a, b) => a.ordem - b.ordem).map((m) => ({
        uid: m.winner_uid!, name: m.winner_uid === m.uid_a ? m.nome_a : m.nome_b,
        seed: m.winner_uid === m.uid_a ? (m.seed_a || 0) : (m.seed_b || 0),
      }));
      const batch = writeBatch(db);
      matches.forEach((m) => batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", round.id, "partidas", m.id), {
        ...(m.status === "encerrada_sem_resultado" ? {} : { status: "confirmada", winner_uid: m.winner_uid || (m.report_a === m.report_b ? m.report_a : null), resolvedAt: Date.now() }),
      }));
      batch.update(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", round.id), { status: "finalizada", closedAt: Date.now() });
      if (winners.length === 0) {
        batch.update(doc(db, "campeonatos_liga_ro", torneio.id), { status: "finalizado_sem_campeao", finalizadoAt: Date.now(), motivo_finalizacao: "todas_as_partidas_sem_resultado" });
        await batch.commit();
        setMessage("Todas as partidas terminaram sem resultado válido. O torneio foi encerrado sem campeão.");
        return;
      }
      if (winners.length === 1) {
        batch.update(doc(db, "campeonatos_liga_ro", torneio.id), {
          status: "aguardando_trofeu", vencedor_uid: winners[0].uid, vencedor_nome: winners[0].name,
          finalizadoAt: Date.now(),
        });
        await batch.commit();
        setMessage(`${winners[0].name} venceu o Top Cut. Conceda o Troféu Santo Antônio para concluir o torneio.`);
        return;
      }
      const nextNumber = torneio.rodada_cut + 1;
      batch.update(doc(db, "campeonatos_liga_ro", torneio.id), { rodada_cut: nextNumber });
      const nextBye = winners.length % 2 === 1 ? [...winners].sort((a, b) => a.seed - b.seed)[0] : null;
      const pairableWinners = nextBye ? winners.filter((winner) => winner.uid !== nextBye.uid) : winners;
      const nextPairs = [];
      for (let i = 0; i < pairableWinners.length; i += 2) nextPairs.push({ a: pairableWinners[i], b: pairableWinners[i + 1] });
      if (nextBye) batch.set(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", `topcut_${nextNumber}`, "partidas", "bye"), {
        uid_a: nextBye.uid, uid_b: "", nome_a: nextBye.name, nome_b: "Folga", report_a: nextBye.uid, report_b: nextBye.uid,
        winner_uid: nextBye.uid, status: "confirmada", is_bye: true, ordem: 0, seed_a: nextBye.seed, tipo: "top_cut", createdAt: Date.now(), deadline_at_ms: Date.now() + WEEK_MS,
      });
      nextPairs.forEach(({ a, b }, i) => batch.set(
        doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", `topcut_${nextNumber}`, "partidas", `partida_${String(i + 1).padStart(2, "0")}`),
        { uid_a: a.uid, uid_b: b.uid, nome_a: a.name, nome_b: b.name, report_a: null, report_b: null,
          winner_uid: null, status: "agendada", ordem: i + 1, seed_a: a.seed, seed_b: b.seed, tipo: "top_cut", createdAt: Date.now(), deadline_at_ms: Date.now() + WEEK_MS }
      ));
      batch.set(doc(db, "campeonatos_liga_ro", torneio.id, "rodadas", `topcut_${nextNumber}`), {
        tipo: "top_cut", numero: nextNumber, status: "aberta", createdAt: Date.now(),
      });
      await batch.commit();
      setMessage(`Próxima fase do Top Cut gerada: ${nextPairs.length} partida(s).`);
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }

  async function concederTrofeu() {
    if (!torneio || !torneio.vencedor_uid) return;
    setBusy(true); setMessage("");
    try {
      const uid = torneio.vencedor_uid;
      const badgeId = `santo_antonio__${torneio.id}__${uid}`;
      const badgeRef = doc(db, "insignias", badgeId);
      const badgeSnap = await getDoc(badgeRef);
      const participant = participantes.find((p) => p.uid === uid);
      const user = await getDoc(doc(db, "usuarios", uid));
      const name = participant?.nome || (user.exists() ? user.data().nome : "") || uid;
      if (!badgeSnap.exists()) await setDoc(badgeRef, {
        usuario_uid: uid, ginasio_id: "santo-antonio", ginasio_nome: "Santo Antônio — Great Plateau",
        ginasio_tipo: "Troféu regional", insignia_icon: "/Insignia/santoantonio.png",
        temporada_id: torneio.temporada_id, temporada_nome: torneio.temporada_nome,
        liga: torneio.liga, tipo: "trofeu_great_plateau", torneio_id: torneio.id,
        createdAt: Date.now(), validacao_digital: true,
      });
      await updateDoc(doc(db, "campeonatos_liga_ro", torneio.id), {
        status: "finalizado", trofeu_concedido_at: Date.now(), vencedor_nome: name,
      });
      setMessage(`Troféu/insígnia Santo Antônio concedido a ${name}. Ele já pode solicitar o Desafio dos Campeões.`);
    } catch (e) { setMessage(`Falha ao conceder o troféu: ${errorText(e)}`); }
    finally { setBusy(false); }
  }

  if (isAdmin === null) return <p className="p-6">Carregando...</p>;
  if (!isAdmin) return null;
  const active = torneio && !["finalizado"].includes(torneio.status);
  const canNextSwiss = torneio?.status === "suico" && torneio.rodadas_suico_criadas < torneio.rodadas_suico;
  const canStartCut = torneio?.status === "suico" && torneio.rodadas_suico_criadas === torneio.rodadas_suico;
  const canAdvanceCut = torneio?.status === "top_cut";

  return <main className="max-w-6xl mx-auto p-6 space-y-6">
    <header className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-bold">Campeonato Great Plateau — Liga RO</h1>
        <p className="text-sm text-gray-600">Inscrições para quem tem pelo menos 8 insígnias válidas da temporada, com chaveamento atualizado durante as inscrições.</p></div>
      <button onClick={() => router.push("/dev")} className="text-sm text-blue-700 underline">Painel admin</button>
    </header>
    {message && <p role="status" className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">{message}</p>}

    <section className="rounded border bg-white p-4 space-y-3">
      <h2 className="font-semibold">Inscrições da temporada</h2>
      <p className="text-sm text-gray-600">O campeonato abre para inscrições quando a temporada começa. Cada jogador elegível precisa se cadastrar na página pública; a classificação exige pelo menos 8 insígnias válidas e distintas da temporada.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Liga de batalha
          <select value={liga} onChange={(e) => setLiga(e.target.value)} className="ml-2 rounded border px-2 py-1">
            {(ligas.length ? ligas : ["Great"]).map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
        <span className="text-sm text-gray-600">Temporada ativa: {temporada?.nome || "nenhuma"}</span>
        <button onClick={abrirInscricoes} disabled={busy || !temporada || Boolean(torneios.find((t) => t.temporada_id === temporada.id && t.liga === liga && t.status !== "finalizado"))}
          className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Processando..." : "Abrir inscrições"}</button>
      </div>
      {torneios.find((t) => temporada && t.temporada_id === temporada.id && t.liga === liga && t.status !== "finalizado") &&
        <p className="text-xs text-amber-700">Já existe um campeonato ativo nesta temporada. Selecione-o abaixo para administrar.</p>}
    </section>

    <section className="rounded border bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Campeonatos e etapas</h2>
        <select value={torneioId} onChange={(e) => setTorneioId(e.target.value)} className="rounded border px-2 py-1 text-sm">
          {torneios.map((t) => <option key={t.id} value={t.id}>{t.temporada_nome} — {t.liga} — {t.status}</option>)}
        </select>
      </div>
      {torneio ? <>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded bg-slate-100 px-2 py-1">{torneio.status.replaceAll("_", " ").toUpperCase()}</span>
          <span>{torneio.temporada_nome}</span><span>•</span><span>{participantes.length} inscritos</span>
          <span>•</span><span>{torneio.liga}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {torneio.status === "inscricoes" && <div className="w-full rounded border bg-slate-50 p-3 space-y-3">
            <p className="text-sm">As inscrições seguem abertas. Defina a data da semana do torneio; as batalhas só poderão começar nesse período.</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">Início das batalhas
                <input type="datetime-local" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="ml-2 rounded border px-2 py-1" />
              </label>
              <button disabled={busy || !dataInicio} onClick={salvarDataInicio} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Salvar data</button>
              <button disabled={busy || participantes.length < 2 || !torneio.inicio_batalhas_em || agora < torneio.inicio_batalhas_em || agora > torneio.inicio_batalhas_em + 7 * 86400000} onClick={iniciarBatalhas} className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Encerrar inscrições e iniciar batalhas</button>
            </div>
            {torneio.inicio_batalhas_em && <p className="text-xs text-gray-600">Data programada: {new Date(torneio.inicio_batalhas_em).toLocaleString("pt-BR")}</p>}
            {participantes.length < 2 && <p className="text-xs text-amber-700">São necessários pelo menos 2 inscritos para iniciar as batalhas.</p>}
          </div>}
          {torneio.status === "suico" && torneio.rodadas_suico_criadas === 0 && <button disabled={busy || !participantes.length} onClick={iniciarProximaSuica} className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Sortear rodada 1</button>}
          {canNextSwiss && torneio.rodadas_suico_criadas > 0 && <button disabled={busy} onClick={iniciarProximaSuica} className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Confirmar resultados e sortear próxima suíça</button>}
          {canStartCut && <button disabled={busy} onClick={iniciarTopCut} className="rounded bg-purple-700 px-3 py-2 text-sm text-white disabled:opacity-50">Fechar suíço e gerar Top Cut</button>}
          {canAdvanceCut && <button disabled={busy} onClick={avançarTopCut} className="rounded bg-purple-700 px-3 py-2 text-sm text-white disabled:opacity-50">Confirmar fase e avançar Top Cut</button>}
          {torneio.status === "aguardando_trofeu" && <button disabled={busy} onClick={concederTrofeu} className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50">Conceder Troféu Santo Antônio</button>}
          {torneio.status === "finalizado" && <a href={`/desafio-dos-campeoes`} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white">Desafio dos Campeões</a>}
        </div>
        {rodadaAtual && <div className="rounded border p-3"><h3 className="font-medium">{rodadaAtual.tipo === "suico" ? `Rodada suíça ${rodadaAtual.numero}` : `Top Cut — fase ${rodadaAtual.numero}`}</h3>
          <ul className="mt-2 divide-y text-sm">{partidas.map((m) => <li key={m.id} className="py-2 flex flex-wrap justify-between gap-2">
            <span>{m.nome_a} × {m.nome_b}</span><span>{m.id === "bye" ? "Folga (+3 pontos)" : m.report_a === m.report_b && m.report_a ? `Resultado confirmado: ${m.report_a === "empate" ? "empate" : m.report_a === m.uid_a ? m.nome_a : m.nome_b}` : m.report_a && m.report_b ? "Divergência: admin precisa revisar" : "Aguardando os dois jogadores"}</span>
          </li>)}</ul></div>}
        {torneio.status === "inscricoes" && participantes.length > 0 && <div className="rounded border border-blue-200 bg-blue-50 p-4">
          <h3 className="font-medium">Prévia do chaveamento inicial</h3>
          <p className="mt-1 text-xs text-gray-600">Atualizada automaticamente a cada inscrição. Será confirmada quando as batalhas começarem.</p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{chaveamentoPrevio.pairings.map(({ a, b }) => <li key={`${a.uid}-${b.uid}`} className="rounded bg-white px-3 py-2">{a.nome} × {b.nome}</li>)}</ol>
          {chaveamentoPrevio.bye && <p className="mt-2 text-sm">Folga prevista: {chaveamentoPrevio.bye.nome}</p>}
        </div>}
        {active && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">#</th><th>Jogador</th><th>Insígnias</th><th>Pontos</th><th>V-E-D</th></tr></thead><tbody>
          {ranking.map((p, i) => <tr key={p.uid} className="border-b"><td className="py-2">{i + 1}</td><td>{p.nome}</td><td>{p.insignias_count}</td><td>{p.pontos}</td><td>{p.vitorias}-{p.empates}-{p.derrotas}</td></tr>)}
        </tbody></table></div>}
        {torneio.vencedor_nome && <p className="font-semibold text-amber-800">Campeão: {torneio.vencedor_nome}</p>}
        <a href={`/campeonato-ro/${torneio.id}`} className="text-sm text-blue-700 underline">Abrir página pública do campeonato</a>
      </> : <p className="text-sm text-gray-500">Nenhum campeonato iniciado ainda.</p>}
    </section>
  </main>;
}
