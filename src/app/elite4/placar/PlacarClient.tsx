"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";

type Elite = { id: string; liga: string; pos: 1 | 2 | 3 | 4; uid: string; nome?: string; tipo?: string };
type RankingItem = { id: string; uid: string; nome: string; tipo: "lider" | "elite4"; posElite?: number; pontos: number; participacao: number; vitorias: number; admin: number; desafios: number };
type Challenge = { id: string; campeonato_id: string; liga: string; challenger_uid: string; challenger_nome: string; challenger_role: "lider" | "elite4"; target_uid: string; target_nome: string; target_role: "lider" | "elite4"; elite4_uid: string; status: string; reports?: Record<string, string>; deadline_at_ms: number; winner_uid?: string; pontos_transferidos?: number; metodo_resultado?: string; elite4_pp_atribuido?: boolean };

const functions = getFunctions(undefined, "southamerica-east1");
const statusLabel: Record<string, string> = { pendente: "Aguardando aceite", aceito: "Batalha aceita", resultado_parcial: "Aguardando confirmação do resultado", contestado: "Resultado em análise pelo administrador", finalizado: "Finalizado" };
const callable = (name: string) => httpsCallable(functions, name);
const dateLabel = (ms: number) => ms ? new Date(ms).toLocaleString("pt-BR") : "—";

export default function PlacarClient({ liga }: { liga: string }) {
  const [elite, setElite] = useState<Elite[]>([]);
  const [campeonatoAbertoId, setCampeonatoAbertoId] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RankingItem[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid || null)), []);
  useEffect(() => {
    const qE = query(collection(db, "elite4"), where("liga", "==", liga), orderBy("pos", "asc"));
    const unsubE = onSnapshot(qE, (snap) => setElite(snap.docs.map((d) => {
      const x = d.data() as any;
      return { id: d.id, liga: x.liga, pos: x.pos, uid: x.uid, nome: x.nome, tipo: x.tipo } as Elite;
    }).filter((e) => [1, 2, 3, 4].includes(e.pos))));
    const qAtivo = query(collection(db, "campeonatos_elite4"), where("liga", "==", liga), where("status", "==", "aberto"), orderBy("createdAt", "desc"));
    const unsubAtivo = onSnapshot(qAtivo, (snap) => setCampeonatoAbertoId(snap.docs[0]?.id || null));
    return () => { unsubE(); unsubAtivo(); };
  }, [liga]);

  useEffect(() => {
    if (!campeonatoAbertoId) { setRanking([]); setChallenges([]); return; }
    const unsubRanking = onSnapshot(collection(db, "campeonatos_elite4", campeonatoAbertoId, "participantes"), async (snap) => {
      const rows = await Promise.all(snap.docs.filter((d) => d.data().tipo_participante === "elite4" || d.data().optou_participar === true).map(async (d) => {
        const x = d.data() as any; const userId = String(x.usuario_uid || d.id); const user = await getDoc(doc(db, "usuarios", userId));
        return { id: d.id, uid: userId, nome: String(x.nome || user.data()?.nome || user.data()?.nick || userId), tipo: x.tipo_participante === "elite4" ? "elite4" as const : "lider" as const, posElite: Number(x.elite4_pos) || undefined, pontos: Number(x.pontos || 0), participacao: Number(x.pontos_participacao || 0), vitorias: Number(x.pontos_vitoria || 0), admin: Number(x.pontos_admin || 0), desafios: Number(x.pontos_desafios || 0) };
      }));
      setRanking(rows.sort((a, b) => b.pontos - a.pontos || b.vitorias - a.vitorias || b.participacao - a.participacao || a.nome.localeCompare(b.nome, "pt-BR")));
    });
    const unsubChallenges = onSnapshot(query(collection(db, "desafios_elite4"), where("campeonato_id", "==", campeonatoAbertoId)), (snap) => setChallenges(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Challenge)).sort((a, b) => b.deadline_at_ms - a.deadline_at_ms)));
    return () => { unsubRanking(); unsubChallenges(); };
  }, [campeonatoAbertoId]);

  const leaders = useMemo(() => ranking.filter((p) => p.tipo === "lider"), [ranking]);
  const myElite = elite.some((e) => e.uid === uid);
  const myPendingDefense = challenges.find((c) => c.target_uid === uid && c.status === "pendente");
  const act = async (label: string, name: string, data: Record<string, unknown>) => {
    setBusy(true); setNotice("");
    try { await callable(name)(data); setNotice(label); }
    catch (e: any) { setNotice(e?.message || "Não foi possível concluir a ação."); }
    finally { setBusy(false); }
  };
  const startChallenge = (targetUid: string) => act("Desafio criado. O adversário foi avisado e tem uma semana para aceitar.", "createElite4Challenge", { liga, targetUid });
  const report = (c: Challenge, winnerUid: string) => act("Resultado registrado. Quando os dois confirmarem, os pontos serão transferidos.", "reportElite4ChallengeResult", { challengeId: c.id, winnerUid });

  const challengeButtons = (p: RankingItem) => {
    if (!uid || !campeonatoAbertoId) return null;
    if (p.tipo === "elite4" && leaders[0]?.uid === uid && uid !== p.uid)
      return <button disabled={busy} onClick={() => startChallenge(p.uid)} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Desafiar</button>;
    if (p.tipo === "lider" && myElite && leaders.slice(0, 4).some((x) => x.uid === p.uid))
      return <button disabled={busy} onClick={() => startChallenge(p.uid)} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Desafiar</button>;
    return null;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header><h1 className="text-2xl font-bold">Elite 4 — Liga {liga}</h1><p className="mt-1 text-sm text-slate-600">A classificação define quem pode desafiar. O vencedor recebe todos os pontos do adversário.</p></header>
      {notice && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Elite 4 atual</h2>
        <ol className="grid gap-2 sm:grid-cols-2">{[1, 2, 3, 4].map((pos) => { const e = elite.find((x) => x.pos === pos); return <li key={pos} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-3"><span className="text-sm text-slate-500">Posição {pos}</span><span className="text-right"><strong className="block">{e?.nome || e?.uid || "Vaga disponível"}</strong>{e?.tipo && <span className="text-xs capitalize text-slate-500">Tipo {e.tipo}</span>}</span></li>; })}</ol>
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">Pontuação da disputa</h2>
        <p className="mb-3 text-sm text-slate-600">Líderes pontuam por vitórias e participações. A Elite 4 recebe pontos definidos pela administração e pode desafiar os quatro primeiros líderes.</p>
        {!campeonatoAbertoId ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Não há disputa aberta nesta liga. Quando a administração iniciar uma temporada, a classificação e os desafios aparecerão aqui.</p> : ranking.length === 0 ? <p className="text-sm text-slate-500">Carregando classificação…</p> : <div className="overflow-x-auto"><table className="min-w-[720px] w-full text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-2">#</th><th>Treinador</th><th>Categoria</th><th>Participação</th><th>Vitórias</th><th>Admin</th><th>Desafios</th><th>Total</th><th>Ação</th></tr></thead><tbody>{ranking.map((p, i) => <tr key={p.id} className="border-b last:border-0"><td className="p-2">{i + 1}</td><td className="font-medium">{p.nome}</td><td>{p.tipo === "elite4" ? `Elite 4 · posição ${p.posElite || "—"}` : "Líder de ginásio"}</td><td>{p.participacao}</td><td>{p.vitorias}</td><td>{p.admin}</td><td>{p.desafios}</td><td className="font-semibold">{p.pontos}</td><td>{challengeButtons(p)}</td></tr>)}</tbody></table></div>}
        {campeonatoAbertoId && uid && leaders[0]?.uid !== uid && !myElite && <p className="mt-3 text-xs text-slate-500">O desafio contra a Elite 4 é liberado para o líder com maior pontuação.</p>}
        {campeonatoAbertoId && uid && myElite && <p className="mt-3 text-xs text-slate-500">Você pode desafiar um dos quatro líderes mais bem colocados.</p>}
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">Desafios</h2>
        <p className="mb-3 text-sm text-slate-600">O adversário tem uma semana para aceitar. Depois da batalha, os dois confirmam o vencedor. Se o prazo terminar sem resposta do adversário, quem iniciou pode solicitar W.O.</p>
        {!campeonatoAbertoId || challenges.length === 0 ? <p className="text-sm text-slate-500">Ainda não há desafios nesta disputa.</p> : <ul className="space-y-3">{challenges.map((c) => {
          const participant = c.challenger_uid === uid || c.target_uid === uid;
          const isTarget = c.target_uid === uid;
          const deadlinePassed = Date.now() >= c.deadline_at_ms;
          const canReport = participant && ["aceito", "resultado_parcial"].includes(c.status) && !deadlinePassed;
          const claimed = !!(c.reports || {})[uid || ""];
          return <li key={c.id} className="rounded-lg border bg-slate-50 p-3">
            <div className="flex flex-col justify-between gap-2 sm:flex-row"><div><p className="font-semibold">{c.challenger_nome} <span className="font-normal text-slate-500">({c.challenger_role === "elite4" ? "Elite 4" : "Líder"}) desafia</span> {c.target_nome} <span className="font-normal text-slate-500">({c.target_role === "elite4" ? "Elite 4" : "Líder"})</span></p><p className="mt-1 text-xs text-slate-600">{statusLabel[c.status] || c.status} · prazo: {dateLabel(c.deadline_at_ms)}</p></div>
              {isTarget && c.status === "pendente" && <button disabled={busy || deadlinePassed} onClick={() => act("Desafio aceito. Combine a batalha com o adversário.", "acceptElite4Challenge", { challengeId: c.id })} className="h-fit rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Aceitar desafio</button>}
            </div>
            {canReport && <div className="mt-3"><p className="mb-2 text-sm">Quem venceu a batalha?</p><div className="flex flex-wrap gap-2"><button disabled={busy || claimed} onClick={() => report(c, c.challenger_uid)} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50">Vitória de {c.challenger_nome}</button><button disabled={busy || claimed} onClick={() => report(c, c.target_uid)} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50">Vitória de {c.target_nome}</button></div>{claimed && <p className="mt-2 text-xs text-slate-600">Sua confirmação foi registrada; aguardando o adversário.</p>}</div>}
            {participant && c.challenger_uid === uid && deadlinePassed && c.status !== "finalizado" && !((c.reports || {})[c.target_uid]) && <button disabled={busy} onClick={() => act("W.O. registrado. Os pontos do adversário foram transferidos.", "claimElite4Walkover", { challengeId: c.id })} className="mt-3 rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Solicitar vitória por W.O.</button>}
            {c.status === "finalizado" && <p className="mt-3 rounded-lg bg-white p-2 text-sm">Vencedor: <strong>{c.winner_uid === c.challenger_uid ? c.challenger_nome : c.target_nome}</strong>. {c.pontos_transferidos || 0} pontos transferidos{c.metodo_resultado === "wo" ? " por W.O." : ""}.{c.elite4_pp_atribuido ? " Elite 4 recebeu 10 PP." : ""}</p>}
            {c.status === "contestado" && participant && <p className="mt-3 text-sm text-amber-800">Os resultados informados não coincidem ({c.challenger_nome}: {c.reports?.[c.challenger_uid] === c.challenger_uid ? c.challenger_nome : c.target_nome}; {c.target_nome}: {c.reports?.[c.target_uid] === c.challenger_uid ? c.challenger_nome : c.target_nome}). Um administrador precisa revisar o resultado.</p>}
          </li>;
        })}</ul>}
      </section>
      {myPendingDefense && <p className="sr-only">Você tem um desafio pendente de aceite.</p>}
    </main>
  );
}
