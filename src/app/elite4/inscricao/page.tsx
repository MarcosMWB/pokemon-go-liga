"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db } from "@/lib/firebase";

type Ginasio = { id: string; nome: string; tipo: string; liga: string; em_disputa: boolean };
type Disputa = { id: string; liga: string; createdAt: number };
type Escolha = { optou_participar: boolean; ginasio_id: string; ginasio_tipo: string; pontos: number };
type Elite = { liga: string; tipo: string };

export default function Elite4InscricaoPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [elites, setElites] = useState<Elite[]>([]);
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [carregando, setCarregando] = useState(true);
  const [preferenciasCarregadas, setPreferenciasCarregadas] = useState<Record<string, boolean>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("");

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) { router.replace("/login"); return; }
    setUid(user.uid);
  }), [router]);

  useEffect(() => {
    if (!uid) return;
    const erro = () => { setMensagem("Não foi possível carregar as informações. Atualize a página e tente novamente."); setCarregando(false); };
    const stopGym = onSnapshot(query(collection(db, "ginasios"), where("lider_uid", "==", uid)), (snap) => {
      setGinasios(snap.docs.map((d) => ({ id: d.id, nome: d.data().nome || d.id, tipo: d.data().tipo || "", liga: d.data().liga || d.data().liga_nome || "", em_disputa: d.data().em_disputa === true })));
      setCarregando(false);
    }, erro);
    const stopElite = onSnapshot(query(collection(db, "elite4"), where("uid", "==", uid)), (snap) => setElites(snap.docs.map((d) => ({ liga: d.data().liga, tipo: d.data().tipo || "" }))), erro);
    const stopCamp = onSnapshot(query(collection(db, "campeonatos_elite4"), where("status", "==", "aberto")), (snap) => {
      setDisputas(snap.docs.map((d) => ({ id: d.id, liga: d.data().liga, createdAt: typeof d.data().createdAt?.toMillis === "function" ? d.data().createdAt.toMillis() : Number(d.data().createdAt) || 0 })));
    }, erro);
    return () => { stopGym(); stopElite(); stopCamp(); };
  }, [uid]);

  const porLiga = useMemo(() => {
    const ligas = [...new Set([...ginasios.map((g) => g.liga), ...elites.map((e) => e.liga)])].filter(Boolean);
    return ligas.map((liga) => ({ liga, gyms: ginasios.filter((g) => g.liga === liga), elite: elites.find((e) => e.liga === liga), disputa: disputas.filter((d) => d.liga === liga).sort((a, b) => b.createdAt - a.createdAt)[0] }));
  }, [ginasios, elites, disputas]);

  useEffect(() => {
    if (!uid) return;
    setPreferenciasCarregadas({});
    const stops = disputas.map((camp) => onSnapshot(doc(db, "campeonatos_elite4", camp.id, "participantes", uid), (snap) => {
      const data = snap.data();
      setEscolhas((atual) => ({ ...atual, [camp.id]: { optou_participar: data?.optou_participar === true, ginasio_id: data?.ginasio_id || "", ginasio_tipo: data?.ginasio_tipo || "", pontos: Number(data?.pontos || 0) } }));
      setPreferenciasCarregadas((atual) => ({ ...atual, [camp.id]: true }));
    }, () => setMensagem("Não foi possível carregar sua escolha de participação.")));
    return () => stops.forEach((stop) => stop());
  }, [uid, disputas]);

  async function salvar(camp: Disputa, ginasioId: string) {
    if (salvando) return;
    const anterior = escolhas[camp.id];
    if (ginasioId && anterior?.ginasio_id && anterior.ginasio_id !== ginasioId && anterior.pontos > 0 && !confirm("Trocar o ginásio representado reinicia os pontos nesta disputa. Confirmar a troca?")) return;
    setSalvando(camp.id); setMensagem("");
    try {
      const mudar = httpsCallable(getFunctions(auth.app, "southamerica-east1"), "setElite4Participation");
      await mudar({ campeonatoId: camp.id, participar: Boolean(ginasioId), ...(ginasioId ? { ginasioId } : {}) });
      setMensagem(ginasioId ? "Participação confirmada. Apenas o ginásio escolhido será envolvido se você conquistar uma vaga na Elite 4." : "Escolha salva: você não participará desta disputa pela Elite 4. Seus ginásios permanecem com você.");
    } catch (error: any) { setMensagem("Não foi possível salvar sua escolha: " + error.message); }
    finally { setSalvando(null); }
  }

  if (!uid || carregando) return <p className="p-6">Carregando sua participação…</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header><h1 className="text-2xl font-bold">Sua participação na disputa da Elite 4</h1><p className="mt-2 text-sm text-slate-600">Por padrão, líderes não participam e mantêm seus ginásios. Para disputar uma vaga, escolha um único ginásio por liga.</p></header>
      {mensagem && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">{mensagem}</p>}
      {!porLiga.length && <p className="rounded border bg-white p-5 text-sm">Você ainda não lidera um ginásio nem ocupa uma vaga da Elite 4.</p>}
      {porLiga.map(({ liga, gyms, elite, disputa }) => {
        const escolha = disputa ? escolhas[disputa.id] : undefined;
        return <section key={liga} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Liga {liga}</h2><Link href={`/elite4/placar?liga=${encodeURIComponent(liga)}`} className="text-sm font-semibold text-blue-800 underline">Ver classificação</Link></div>
          {elite ? <p className="rounded-lg bg-purple-50 p-3 text-sm text-purple-950">Você já integra a Elite 4{elite.tipo ? ` com o tipo ${elite.tipo}` : ""}. Seus pontos administrativos entram na classificação dos membros atuais. Se for substituído, você assumirá o ginásio inscrito do promovido, com o seu tipo.</p> : !disputa ? <p className="text-sm text-slate-600">Não há disputa aberta nesta liga. Seus ginásios permanecem com você.</p> : <>
            <label className="block text-sm font-semibold" htmlFor={`participacao-${disputa.id}`}>O que você quer fazer nesta disputa?</label>
            <select id={`participacao-${disputa.id}`} value={escolha?.optou_participar ? escolha.ginasio_id : ""} disabled={Boolean(salvando) || !preferenciasCarregadas[disputa.id]} onChange={(event) => salvar(disputa, event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base">
              <option value="">Não participar — manter meus ginásios (padrão)</option>
              {gyms.map((g) => <option key={g.id} value={g.id} disabled={g.em_disputa || !g.tipo}>Participar por {g.nome} · {g.tipo || "sem tipo"}{g.em_disputa ? " · ginásio em disputa" : ""}</option>)}
            </select>
            <p className="text-sm text-slate-600">{salvando === disputa.id ? "Salvando sua escolha…" : escolha?.optou_participar ? `Você participa representando um ginásio, com o tipo ${escolha.ginasio_tipo}. Pontos: ${escolha.pontos}.` : "Você não está concorrendo à Elite 4. Essa é a opção inicial de toda nova disputa."}</p>
            <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">Se vencer, você mantém o tipo do ginásio inscrito. O Elite 4 com menos pontos assume esse ginásio e leva seu próprio tipo para ele. Seus outros ginásios continuam com você. Na primeira formação, quando não houver um Elite 4 para assumir, só o ginásio inscrito abrirá disputa de liderança.</div>
          </>}
          {gyms.length > 0 && <p className="text-xs text-slate-500">Ginásios que você lidera: {gyms.map((g) => g.nome).join(", ")}.</p>}
        </section>;
      })}
      <Link href={`/perfil/${uid}`} className="inline-block text-sm font-semibold text-blue-800 underline">Voltar ao meu perfil</Link>
    </div>
  );
}
