"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
import { swissPairings, type GPParticipant } from "@/lib/greatPlateau";
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";

type Msg = { id: string; from: string; nome?: string; text: string; createdAt?: { toDate?: () => Date } };
type Match = { id: string; uid_a: string; uid_b: string; nome_a: string; nome_b: string; report_a?: string | null; report_b?: string | null; status: string; is_bye?: boolean; tipo?: string };

export default function CampeonatoROPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState(auth.currentUser);
  const [tournament, setTournament] = useState<Record<string, any> | null>(null);
  const [participants, setParticipants] = useState<Record<string, any>[]>([]);
  const [rounds, setRounds] = useState<Array<{ id: string; tipo: string; numero: number; status: string }>>([]);
  const [roundId, setRoundId] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [messages, setMessages] = useState<Record<string, Msg[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => auth.onAuthStateChanged(setUser), []);
  useEffect(() => {
    if (!id) return;
    const root = doc(db, "campeonatos_liga_ro", id);
    const a = onSnapshot(root, (s) => setTournament(s.exists() ? { id: s.id, ...s.data() } : null));
    const b = onSnapshot(collection(root, "participantes"), (s) => setParticipants(s.docs.map((d) => ({ uid: d.id, ...d.data() }))));
    const c = onSnapshot(collection(root, "rodadas"), (s) => { const rows = s.docs.map((d) => ({ id: d.id, ...d.data() } as { id: string; tipo: string; numero: number; status: string })); rows.sort((x, y) => (x.tipo === y.tipo ? x.numero - y.numero : x.tipo === "suico" ? -1 : 1)); setRounds(rows); });
    return () => { a(); b(); c(); };
  }, [id]);
  useEffect(() => {
    if (!id || !roundId) { setMatches([]); return; }
    return onSnapshot(collection(db, "campeonatos_liga_ro", id, "rodadas", roundId, "partidas"), (s) => setMatches(s.docs.map((d) => ({ id: d.id, ...d.data() } as Match))));
  }, [id, roundId]);
  useEffect(() => {
    if (!id || !roundId || !matches.length) return;
    const cleanups = matches.filter((m) => !m.is_bye && (user?.uid === m.uid_a || user?.uid === m.uid_b)).map((m) => onSnapshot(query(collection(db, "campeonatos_liga_ro", id, "rodadas", roundId, "partidas", m.id, "mensagens"), orderBy("createdAt")), (s) => setMessages((old) => ({ ...old, [m.id]: s.docs.map((d) => ({ id: d.id, ...d.data() } as Msg)) }))));
    return () => cleanups.forEach((fn) => fn());
  }, [id, roundId, matches, user?.uid]);
  useEffect(() => { if (rounds.length && !roundId) setRoundId(rounds.find((r) => r.status === "aberta")?.id || rounds[rounds.length - 1].id); }, [rounds, roundId]);

  async function report(match: Match, result: string) {
    if (!user || (user.uid !== match.uid_a && user.uid !== match.uid_b)) { setNotice("Entre na sua conta de participante para informar o resultado."); return; }
    try {
      const key = user.uid === match.uid_a ? "report_a" : "report_b";
      await updateDoc(doc(db, "campeonatos_liga_ro", id, "rodadas", roundId, "partidas", match.id), { [key]: result });
      setNotice("Resultado registrado. Ele será confirmado quando o adversário informar o mesmo resultado.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Não foi possível registrar o resultado."); }
  }
  async function send(match: Match) {
    if (!user || (user.uid !== match.uid_a && user.uid !== match.uid_b)) return setNotice("O chat é exclusivo dos dois participantes da partida.");
    const text = (drafts[match.id] || "").trim(); if (!text) return;
    const profile = await getDoc(doc(db, "usuarios", user.uid));
    await addDoc(collection(db, "campeonatos_liga_ro", id, "rodadas", roundId, "partidas", match.id, "mensagens"), { from: user.uid, nome: profile.data()?.nome || user.displayName || "Treinador", text: text.slice(0, 1000), createdAt: serverTimestamp() });
    setDrafts((old) => ({ ...old, [match.id]: "" }));
  }
  async function joinTournament() {
    if (!user) { setNotice("Entre na sua conta para se inscrever no campeonato."); return; }
    setJoining(true); setNotice("");
    try {
      const register = httpsCallable<{ tournamentId: string }, { enrolled: boolean; alreadyEnrolled?: boolean }>(
        getFunctions(auth.app, "southamerica-east1"), "registerGreatPlateauParticipant",
      );
      const result = await register({ tournamentId: id });
      setNotice(result.data.alreadyEnrolled ? "Você já está inscrito." : "Inscrição confirmada! Você já aparece na prévia do chaveamento.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message.replace(/^Firebase: /, "") : "Não foi possível concluir a inscrição.");
    } finally { setJoining(false); }
  }
  if (!tournament) return <main className="mx-auto max-w-4xl p-6">Carregando campeonato ou campeonato não encontrado.</main>;
  const ranked = [...participants].sort((a, b) => (b.pontos || 0) - (a.pontos || 0) || (a.seed || 0) - (b.seed || 0));
  const preview = swissPairings(participants.map((p) => ({
    uid: p.uid, nome: p.nome || "Treinador", pontos: p.pontos || 0,
    seed: p.seed || 0, opponents: p.opponents || [], byes: p.byes || 0,
  })) as GPParticipant[], 1);
  const alreadyEnrolled = Boolean(user && participants.some((p) => p.uid === user.uid));
  return <main className="mx-auto max-w-5xl space-y-6 p-5">
    <header><Link className="text-sm text-blue-700 underline" href="/campeonato-ro">Campeonatos</Link><h1 className="mt-2 text-3xl font-bold">{tournament.nome || "Liga RO — Great Plateau"}</h1><p>{tournament.temporada_nome} · {tournament.liga} · {String(tournament.status).replaceAll("_", " ")}</p></header>
    {notice && <p role="status" className="rounded bg-blue-50 p-3 text-sm">{notice}</p>}
    {tournament.status === "inscricoes" && <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h2 className="text-xl font-semibold">Inscrições abertas</h2>
      <p className="mt-1 text-sm">Podem participar jogadores com pelo menos 8 insígnias válidas e distintas desta temporada ({tournament.temporada_nome}). A elegibilidade é conferida pelo sistema no momento da inscrição.</p>
      <p className="mt-2 text-sm font-medium">{participants.length} inscrito(s)</p>
      {!alreadyEnrolled ? <button onClick={joinTournament} disabled={joining || !user} className="mt-3 rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{joining ? "Conferindo insígnias…" : user ? "Inscrever-me" : "Entre na conta para se inscrever"}</button> : <p className="mt-3 font-medium text-emerald-800">Você já está inscrito.</p>}
      {participants.length > 0 && <div className="mt-4 rounded border bg-white p-3"><h3 className="font-medium">Prévia do chaveamento inicial</h3><p className="text-xs text-gray-600">Atualiza conforme novas inscrições e é confirmada quando as batalhas começarem.</p><ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{preview.pairings.map(({ a, b }) => <li key={`${a.uid}-${b.uid}`} className="rounded bg-slate-50 px-3 py-2">{a.nome} × {b.nome}</li>)}</ol>{preview.bye && <p className="mt-2 text-sm">Folga prevista: {preview.bye.nome}</p>}</div>}
    </section>}
    {tournament.vencedor_nome && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4"><b>🏆 Campeão do Great Plateau: {tournament.vencedor_nome}</b>{tournament.status === "finalizado" && <><p>Recebeu o Troféu Santo Antônio e pode solicitar o Desafio dos Campeões.</p><Link className="mt-2 inline-block rounded bg-amber-700 px-3 py-2 text-sm text-white" href="/desafio-dos-campeoes">Abrir Desafio dos Campeões</Link></>}</div>}
    <section className="rounded border p-4"><h2 className="mb-3 text-xl font-semibold">Classificação</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">#</th><th>Treinador</th><th>Insígnias</th><th>Pontos</th><th>V-E-D</th></tr></thead><tbody>{ranked.map((p,i)=><tr className="border-b" key={p.uid}><td className="p-2">{i+1}</td><td>{p.nome}</td><td>{p.insignias_count}</td><td>{p.pontos||0}</td><td>{p.vitorias||0}-{p.empates||0}-{p.derrotas||0}</td></tr>)}</tbody></table></div></section>
    <section className="rounded border p-4"><h2 className="mb-3 text-xl font-semibold">Rodadas e salas de batalha</h2><div className="mb-4 flex flex-wrap gap-2">{rounds.map((r)=><button key={r.id} onClick={()=>setRoundId(r.id)} className={`rounded border px-3 py-1 text-sm ${roundId===r.id?"bg-slate-900 text-white":""}`}>{r.tipo === "suico" ? `Suíço ${r.numero}` : `Top Cut ${r.numero}`}</button>)}</div>{matches.map((m)=><article key={m.id} className="mb-5 rounded-lg border p-4"><h3 className="font-semibold">{m.nome_a} × {m.nome_b}{m.is_bye?" (folga)":""}</h3><p className="text-xs text-gray-500">{m.status === "confirmada" ? "Resultado confirmado" : "Aguardando resultado"}</p>{!m.is_bye && <><div className="my-3 flex flex-wrap gap-2">{(user?.uid===m.uid_a || user?.uid===m.uid_b) ? <><button onClick={()=>report(m,m.uid_a)} disabled={m.status === "confirmada"} className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Vitória: {m.nome_a}</button><button onClick={()=>report(m,m.uid_b)} disabled={m.status === "confirmada"} className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Vitória: {m.nome_b}</button>{m.tipo === "suico" && <button onClick={()=>report(m,"empate")} disabled={m.status === "confirmada"} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Empate</button>}</> : <span className="text-sm text-gray-500">Somente os participantes podem enviar o resultado.</span>}</div><div className="rounded bg-slate-50 p-3"><h4 className="mb-2 text-sm font-semibold">Chat da batalha</h4><div className="max-h-48 space-y-2 overflow-y-auto">{(messages[m.id]||[]).map((msg)=><p key={msg.id} className="text-sm"><b>{msg.nome||"Treinador"}:</b> {msg.text}</p>)}</div>{(user?.uid===m.uid_a || user?.uid===m.uid_b) && <div className="mt-3 flex gap-2"><input value={drafts[m.id]||""} maxLength={1000} onChange={(e)=>setDrafts(old=>({...old,[m.id]:e.target.value}))} className="min-w-0 flex-1 rounded border px-3 py-2 text-sm" placeholder="Combine horário ou registre detalhes da batalha"/><button onClick={()=>send(m)} className="rounded bg-slate-800 px-3 text-sm text-white">Enviar</button></div>}</div></>}</article>)}</section>
  </main>;
}
