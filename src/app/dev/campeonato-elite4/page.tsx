"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
import { planejarElite4, type ParticipanteElite, type MembroElite } from "../../../../functions/src/elite4Plan";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  runTransaction,
  where,
} from "firebase/firestore";

/** Tipos básicos */
type Liga = { id: string; nome: string };
type Campeonato = { id: string; liga: string; status: "aberto" | "fechado"; createdAt: number };
type Participante = {
  id: string;                // id do doc em /campeonatos_elite4/{campId}/participantes/{id}  -> aqui é o UID do líder
  campeonato_id: string;
  usuario_uid: string;
  ginasio_id: string;
  pontos: number;
  pontos_participacao: number;
  pontos_vitoria: number;
  pontos_admin: number;
  pontos_desafios: number;
  tipo_participante: "lider" | "elite4";
  optou_participar: boolean;
  elite4_pos?: number;
  nome?: string;
  ginasio_nome?: string;
  ginasio_tipo?: string;
};
type Elite4 = { id: string; liga: string; pos: 1 | 2 | 3 | 4; uid: string; nome?: string; tipo: string; ginasio_origem_id?: string; ginasio_origem_nome?: string };
type ResultadoPendente = { campeonato_id: string; top4: Array<{ uid: string; nome?: string; pontos?: number }> };
type PontoAdmin = { id: string; participante_nome: string; quantidade: number; motivo: string; createdAt: number };
type DesafioContestado = { id: string; challenger_uid: string; challenger_nome: string; target_uid: string; target_nome: string; reports?: Record<string, string> };

function ordenarParticipantes(a: Participante, b: Participante) {
  return (b.pontos || 0) - (a.pontos || 0) ||
    (b.pontos_vitoria || 0) - (a.pontos_vitoria || 0) ||
    (b.pontos_participacao || 0) - (a.pontos_participacao || 0) ||
    (a.nome || a.usuario_uid).localeCompare(b.nome || b.usuario_uid, "pt-BR");
}

/** Página */
export default function DevCampeonatoElite4() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSel, setLigaSel] = useState<string>("");

  const [campeonato, setCampeonato] = useState<Campeonato | null>(null);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [elite4Atual, setElite4Atual] = useState<Record<number, Elite4 | undefined>>({});
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [pontosManuais, setPontosManuais] = useState<Record<string, string>>({});
  const [motivosPontos, setMotivosPontos] = useState<Record<string, string>>({});
  const [historicoPontos, setHistoricoPontos] = useState<PontoAdmin[]>([]);
  const [resultadoPendente, setResultadoPendente] = useState<ResultadoPendente | null>(null);
  const [selecionados, setSelecionados] = useState<string[] | null>(null);
  const [desafiosContestados, setDesafiosContestados] = useState<DesafioContestado[]>([]);

  /** Auth + superusers */
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user: User | null) => {
      if (!user) { router.replace("/login"); return; }
      try {
        const sup = await getDoc(doc(db, "superusers", user.uid));
        if (!sup.exists()) { setIsAdmin(false); router.replace("/"); return; }
        setIsAdmin(true);
      } catch { setIsAdmin(false); setMsg("Não foi possível verificar seu acesso de administrador."); }
    });
    return () => unsub();
  }, [router]);

  /** Ligas */
  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const ls: Liga[] = snap.docs.map((d) => ({ id: d.id, nome: (d.data() as any).nome || d.id }));
      setLigas(ls);
      setLigaSel((prev) => prev || ls[0]?.nome || "");
    })();
  }, [isAdmin]);

  /** Carrega/escuta campeonato aberto da liga selecionada */
  useEffect(() => {
    if (isAdmin !== true || !ligaSel) return;

    setCampeonato(null);
    setParticipantes([]);
    setElite4Atual({});

    // campeonato aberto
    const qCamp = query(
      collection(db, "campeonatos_elite4"),
      where("liga", "==", ligaSel),
      where("status", "==", "aberto"),
      orderBy("createdAt", "desc")
    );
    const unsubCamp = onSnapshot(qCamp, (snap) => {
      if (snap.empty) { setCampeonato(null); setParticipantes([]); return; }
      const cDoc = snap.docs[0]; const d = cDoc.data() as any;
      setCampeonato({ id: cDoc.id, liga: d.liga, status: d.status, createdAt: d.createdAt });
    });

    // elite 4 atual dessa liga
    const qElite = query(collection(db, "elite4"), where("liga", "==", ligaSel));
    const unsubElite = onSnapshot(qElite, (snap) => {
      const map: Record<number, Elite4 | undefined> = {};
      snap.docs.forEach((dd) => {
        const data = dd.data() as any;
        if (data.pos >= 1 && data.pos <= 4) map[data.pos] = { id: dd.id, liga: data.liga, pos: data.pos, uid: data.uid, nome: data.nome, tipo: data.tipo || "", ginasio_origem_id: data.ginasio_origem_id || "", ginasio_origem_nome: data.ginasio_origem_nome || "" };
      });
      setElite4Atual(map);
    });

    return () => { unsubCamp(); unsubElite(); };
  }, [isAdmin, ligaSel]);

  const campeonatoIdAtual = campeonato?.id;
  useEffect(() => {
    if (!isAdmin || !campeonatoIdAtual) { setDesafiosContestados([]); return; }
    return onSnapshot(query(collection(db, "desafios_elite4"), where("campeonato_id", "==", campeonatoIdAtual), where("status", "==", "contestado")), (snap) => {
      setDesafiosContestados(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DesafioContestado)));
    });
  }, [isAdmin, campeonatoIdAtual]);

  async function resolverDesafio(desafio: DesafioContestado, vencedorUid: string) {
    setSalvando(true); setMsg("");
    try {
      await httpsCallable(getFunctions(undefined, "southamerica-east1"), "adminResolveElite4Challenge")({ challengeId: desafio.id, winnerUid: vencedorUid });
      setMsg("Resultado resolvido e pontos transferidos para o vencedor.");
    } catch (error: any) { setMsg(error?.message || "Não foi possível resolver o desafio."); }
    finally { setSalvando(false); }
  }

  useEffect(() => { setSelecionados(null); }, [campeonato?.id, ligaSel]);

  // Resultados antigos podem ter sido arquivados sem executar a promoção.
  useEffect(() => {
    if (isAdmin !== true || !ligaSel) return;
    setResultadoPendente(null);
    return onSnapshot(query(collection(db, "campeonatos_elite4_resultados"), where("liga", "==", ligaSel), orderBy("appliedAt", "desc")), (snap) => {
      const ultimo = snap.docs[0]?.data();
      setResultadoPendente(ultimo && ultimo.promocao_aplicada !== true && Array.isArray(ultimo.top4) && ultimo.top4.length === 4
        ? { campeonato_id: ultimo.campeonato_id, top4: ultimo.top4 } : null);
    }, () => setMsg("Não foi possível carregar o último resultado da disputa."));
  }, [isAdmin, ligaSel]);

  /** Participantes do campeonato aberto (SUBCOLEÇÃO) */
  useEffect(() => {
    if (!campeonato) return;
    const qPart = collection(db, "campeonatos_elite4", campeonato.id, "participantes");
    const unsub = onSnapshot(qPart, async (snap) => {
      const base: Participante[] = [];
      for (const d of snap.docs) {
        const x = d.data() as any;
        const p: Participante = {
          id: d.id, // aqui é normalmente o uid do líder
          campeonato_id: campeonato.id,
          usuario_uid: x.usuario_uid,
          ginasio_id: x.ginasio_id,
          pontos: x.pontos ?? 0,
          pontos_participacao: x.pontos_participacao ?? 0,
          pontos_vitoria: x.pontos_vitoria ?? 0,
          pontos_admin: x.pontos_admin ?? 0,
          pontos_desafios: x.pontos_desafios ?? 0,
          tipo_participante: x.tipo_participante === "elite4" ? "elite4" : "lider",
          optou_participar: x.optou_participar === true,
          ginasio_tipo: x.ginasio_tipo || "",
          ginasio_nome: x.ginasio_nome || "",
          elite4_pos: x.elite4_pos,
        };
        // Nome do usuário
        const u = await getDoc(doc(db, "usuarios", p.usuario_uid));
        if (u.exists()) p.nome = (u.data() as any).nome || (u.data() as any).email || p.usuario_uid;
        // Nome do ginásio
        const g = p.ginasio_id ? await getDoc(doc(db, "ginasios", p.ginasio_id)) : null;
        if (g?.exists()) {
          const gd = g.data() as any;
          p.ginasio_nome = p.ginasio_nome || gd?.nome || p.ginasio_id;
          p.ginasio_tipo = p.ginasio_tipo || gd?.tipo || "";
        } else {
          p.ginasio_nome = p.ginasio_nome || p.ginasio_id;
        }
        base.push(p);
      }
      // compacta por líder (se alguém lidera >1 ginásio por engano, mantém maior pontuação)
      const byUid = new Map<string, Participante>();
      base.forEach((p) => {
        const old = byUid.get(p.usuario_uid);
        if (!old || p.pontos > old.pontos) byUid.set(p.usuario_uid, p);
      });
      setParticipantes(Array.from(byUid.values()));
    });
    return () => unsub();
  }, [campeonato]);

  useEffect(() => {
    if (!campeonato) { setHistoricoPontos([]); return; }
    const qLogs = query(collection(db, "campeonatos_elite4_pontuacoes"), where("campeonato_id", "==", campeonato.id));
    return onSnapshot(qLogs, (snap) => {
      const rows = snap.docs.map((d) => {
        const x = d.data() as any;
        return { id: d.id, participante_nome: x.participante_nome || x.usuario_uid || "Treinador", quantidade: Number(x.quantidade || 0), motivo: String(x.motivo || ""), createdAt: Number(x.createdAt || 0) };
      });
      setHistoricoPontos(rows.sort((a, b) => b.createdAt - a.createdAt));
    });
  }, [campeonato]);

  /** Inclui líderes e Elite 4 no ranking sem zerar pontuações que já existam. */
  const sincronizarParticipantes = async (campId: string) => {
    const [gs, e4] = await Promise.all([
      getDocs(query(collection(db, "ginasios"), where("liga", "==", ligaSel))),
      getDocs(query(collection(db, "elite4"), where("liga", "==", ligaSel))),
    ]);
    const entradas = new Map<string, Record<string, any>>();
    for (const g of gs.docs) {
      const data = g.data() as any;
      const uid = String(data.lider_uid || "");
      if (uid && !entradas.has(uid)) entradas.set(uid, { usuario_uid: uid, tipo_participante: "lider", optou_participar: false });
    }
    for (const e of e4.docs) {
      const data = e.data() as any;
      const uid = String(data.uid || "");
      const pos = Number(data.pos);
      if (uid && [1, 2, 3, 4].includes(pos)) {
        entradas.set(uid, { usuario_uid: uid, tipo_participante: "elite4", elite4_pos: pos, optou_participar: true, ginasio_tipo: data.tipo || "" });
      }
    }
    let adicionados = 0;
    for (const [uid, dados] of entradas) {
      const ref = doc(db, "campeonatos_elite4", campId, "participantes", uid);
      const atual = await getDoc(ref);
      if (atual.exists()) {
        // Sincronizar nunca escolhe outro ginásio nem inscreve um líder por conta própria.
        if (dados.tipo_participante === "elite4") await updateDoc(ref, { tipo_participante: "elite4", elite4_pos: dados.elite4_pos, ginasio_tipo: dados.ginasio_tipo, optou_participar: true });
        else if (atual.data().optou_participar === undefined) await updateDoc(ref, { optou_participar: false });
        continue;
      }
      await setDoc(ref, {
        campeonato_id: campId, usuario_uid: uid, liga: ligaSel,
        ginasio_id: "", ginasio_nome: "", ginasio_tipo: dados.ginasio_tipo || "", tipo_participante: dados.tipo_participante,
        optou_participar: dados.optou_participar === true,
        ...(dados.elite4_pos ? { elite4_pos: dados.elite4_pos } : {}),
        pontos: 0, pontos_participacao: 0, pontos_vitoria: 0, pontos_admin: 0, pontos_desafios: 0,
        createdAt: Date.now(),
      });
      adicionados++;
    }
    return adicionados;
  };

  /** Criar campeonato com os líderes e a Elite 4 atuais da liga */
  const criarCampeonato = async () => {
    if (!ligaSel) { setMsg("Selecione uma liga."); return; }
    setMsg(""); setSalvando(true);
    try {
      // cria doc campeonato
      const campRef = await addDoc(collection(db, "campeonatos_elite4"), {
        liga: ligaSel,
        status: "aberto",
        regra_versao: 2,
        createdAt: Date.now(),
      });

      const quantidade = await sincronizarParticipantes(campRef.id);
      setMsg(`Disputa criada com ${quantidade} registros. Líderes começam sem participar; cada um deve escolher seu ginásio na página de participação. A Elite 4 atual permanece no ranking.`);
    } catch (e: any) {
      setMsg("Erro ao criar: " + e.message);
    } finally {
      setSalvando(false);
    }
  };

  /** Pontos administrativos são somados à pontuação automática e ficam auditáveis. */
  const concederPontos = async (p: Participante) => {
    if (!campeonato) return;
    if (p.tipo_participante !== "elite4" && !p.optou_participar) { setMsg("Este líder escolheu não participar da disputa."); return; }
    const quantidade = Math.trunc(Number(pontosManuais[p.id]));
    const motivo = (motivosPontos[p.id] || "").trim();
    if (!Number.isFinite(quantidade) || quantidade < 1 || quantidade > 1000) { setMsg("Informe de 1 a 1000 pontos."); return; }
    if (motivo.length < 4) { setMsg("Informe o motivo da pontuação (mínimo de 4 caracteres)."); return; }
    setMsg("");
    try {
      const ref = doc(db, "campeonatos_elite4", campeonato.id, "participantes", p.id);
      const historicoRef = doc(collection(db, "campeonatos_elite4_pontuacoes"));
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Participante não encontrado.");
        const atual = snap.data() as any;
        if (atual.tipo_participante !== "elite4" && atual.optou_participar !== true) throw new Error("O líder não está inscrito na disputa.");
        tx.update(ref, { pontos: Number(atual.pontos || 0) + quantidade, pontos_admin: Number(atual.pontos_admin || 0) + quantidade, updatedAt: Date.now() });
        tx.set(historicoRef, {
          campeonato_id: campeonato.id, liga: ligaSel, usuario_uid: p.usuario_uid,
          participante_nome: p.nome || p.usuario_uid, quantidade, motivo,
          admin_uid: auth.currentUser?.uid || "", createdAt: Date.now(),
        });
      });
      setPontosManuais((prev) => ({ ...prev, [p.id]: "" }));
      setMotivosPontos((prev) => ({ ...prev, [p.id]: "" }));
      setMsg(`${quantidade} ponto(s) registrado(s) para ${p.nome || p.usuario_uid}.`);
    } catch (e: any) { setMsg("Não foi possível atribuir os pontos: " + e.message); }
  };

  /** A função valida e aplica a composição e a sucessão dos ginásios em uma transação. */
  const aplicarElite4 = async (campId: string, vencedores: string[] = []) => {
    if (salvando) return;
    const plano = campId === campeonato?.id ? previa.plano : planejarElite4(membrosPlano, [], []);
    if (!plano) { setMsg(previa.erro || "Revise a seleção de vencedores."); return; }
    const descricao = plano.trocas.length ? plano.trocas.map((t) => `${t.promovido.nome} assume a Elite 4 com o tipo ${t.promovido.ginasio_tipo}. ` +
      (t.rebaixado ? `${t.rebaixado.nome} assume ${t.promovido.ginasio_nome}, que passa a ter o tipo ${t.rebaixado.tipo}.` : `${t.promovido.ginasio_nome} abre disputa por liderança.`)).join("\n\n") : "Nenhum líder será promovido. A Elite 4 e todas as lideranças de ginásio serão mantidas.";
    if (!confirm(`Encerrar a disputa da liga ${ligaSel}?\n\n${descricao}\n\nApenas os ginásios inscritos dos vencedores são envolvidos. Desafios pendentes nesses ginásios serão cancelados quando houver troca de líder.`)) return;
    setSalvando(true); setMsg("");
    try {
      const finalizar = httpsCallable<{ campeonatoId: string; vencedores: string[] }, { jaAplicada: boolean; ginasiosLiberados: Array<{ nome: string }>; ginasiosTransferidos: Array<{ nome: string }> }>(getFunctions(auth.app, "southamerica-east1"), "adminFinalizeElite4");
      const { data } = await finalizar({ campeonatoId: campId, vencedores });
      setMsg(data.jaAplicada ? "Esta promoção já foi aplicada. Nenhuma disputa foi duplicada." :
        vencedores.length ? `Disputa encerrada. ${data.ginasiosTransferidos.length} ginásio(s) transferido(s) aos membros rebaixados e ${data.ginasiosLiberados.length} disputa(s) de liderança aberta(s) por vagas sem antecessor.` : "Disputa encerrada. A Elite 4 atual e os líderes dos ginásios foram mantidos.");
    } catch (error: any) { setMsg("Não foi possível aplicar a promoção: " + error.message); }
    finally { setSalvando(false); }
  };

  /** MIGRAÇÃO opcional: copia docs da coleção antiga para a subcoleção nova */
  const migrarParticipantesAntigos = async () => {
    if (!confirm("Migrar TODOS os documentos de 'campeonatos_elite4_participantes' para subcoleções?")) return;
    setSalvando(true); setMsg("");
    try {
      const oldCol = collection(db, "campeonatos_elite4_participantes");
      const snap = await getDocs(oldCol);
      let copiados = 0;

      for (const d of snap.docs) {
        const x = d.data() as any;
        const campId = x.campeonato_id;
        const uid = x.usuario_uid;
        if (!campId || !uid) continue;

        await setDoc(
          doc(db, "campeonatos_elite4", campId, "participantes", uid),
          {
            campeonato_id: campId,
            usuario_uid: uid,
            ginasio_id: x.ginasio_id || "",
            liga: x.liga || "",
            pontos: x.pontos ?? 0,
            createdAt: x.createdAt ?? Date.now(),
            migratedFromFlat: true,
          },
          { merge: true }
        );

        copiados++;
      }

      if (confirm(`Copiados ${copiados}. Deseja APAGAR os documentos antigos agora?`)) {
        for (const d of snap.docs) {
          await deleteDoc(d.ref);
        }
      }

      setMsg(`Migração concluída. Copiados: ${copiados}.`);
    } catch (e: any) {
      setMsg("Erro na migração: " + e.message);
    } finally {
      setSalvando(false);
    }
  };

  const emAberto = Boolean(campeonato && campeonato.status === "aberto");

  const rankingPlano: ParticipanteElite[] = useMemo(() => participantes.map((p) => ({
    uid: p.usuario_uid, nome: p.nome || p.usuario_uid, pontos: p.pontos, pontos_vitoria: p.pontos_vitoria, pontos_participacao: p.pontos_participacao, pontos_admin: p.pontos_admin,
    tipo_participante: p.tipo_participante, optou_participar: p.optou_participar, ginasio_id: p.ginasio_id || "", ginasio_nome: p.ginasio_nome || "", ginasio_tipo: p.ginasio_tipo || "",
  })), [participantes]);
  const membrosPlano: MembroElite[] = useMemo(() => Object.values(elite4Atual).filter((e): e is Elite4 => Boolean(e)).map((e) => ({ uid: e.uid, nome: e.nome || e.uid, pos: e.pos, tipo: e.tipo, ginasio_origem_id: e.ginasio_origem_id || "", ginasio_origem_nome: e.ginasio_origem_nome || "" })), [elite4Atual]);
  const previa = useMemo(() => {
    try { return { plano: planejarElite4(membrosPlano, rankingPlano, selecionados ?? undefined), erro: "" }; }
    catch (error: any) { return { plano: null, erro: error.message as string }; }
  }, [membrosPlano, rankingPlano, selecionados]);
  const escolhasAtuais = selecionados ?? previa.plano?.trocas.map((t) => t.promovido.uid) ?? [];

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
        <h1 className="text-2xl font-bold">Disputa da Elite 4 — {ligaSel || "Liga"}</h1>
          <p className="text-sm text-gray-500">
            Líderes só concorrem depois de optar por participar e escolher um ginásio. Batalhas desse ginásio rendem 1 ponto de participação e mais 2 por vitória. A Elite 4 recebe pontos administrativos. Cada vencedor troca de cargo com o membro atual de menor pontuação, preservando os tipos de ambos.
          </p>
        </div>
        <button onClick={() => router.push("/dev")} className="text-sm text-blue-600 underline">Voltar ao painel</button>
      </div>

      {msg && <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">{msg}</div>}

      {!emAberto && resultadoPendente && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
          <h2 className="font-semibold">A última disputa foi encerrada sem aplicar a promoção</h2>
          <p className="text-sm">Este resultado usa as regras antigas. Para preservar as escolhas dos líderes, você pode concluir o encerramento mantendo a Elite 4 atual e realizar as próximas trocas em uma nova disputa com participação voluntária.</p>
          <ol className="list-decimal pl-5 text-sm">{resultadoPendente.top4.map((p) => <li key={p.uid}>{p.nome || p.uid} · {p.pontos || 0} pontos</li>)}</ol>
          <button onClick={() => aplicarElite4(resultadoPendente.campeonato_id, [])} disabled={salvando} className="rounded bg-purple-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{salvando ? "Concluindo…" : "Concluir mantendo os cargos atuais"}</button>
        </section>
      )}

      {/* Liga + estado */}
      <div className="bg-white p-4 rounded shadow flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Liga</label>
          <select
            value={ligaSel}
            onChange={(e) => setLigaSel(e.target.value)}
            disabled={salvando}
            className="border rounded px-2 py-1 text-sm"
          >
            {ligas.map(l => <option key={l.id} value={l.nome}>{l.nome}</option>)}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!emAberto ? (
            <>
              <button
                onClick={criarCampeonato}
                disabled={!ligaSel || salvando || Boolean(resultadoPendente)}
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
              >
                Iniciar disputa (líderes + Elite 4)
              </button>
              <button
                onClick={migrarParticipantesAntigos}
                disabled={salvando}
                className="px-3 py-2 rounded bg-amber-600 text-white text-sm disabled:opacity-50"
                title="Copia da coleção antiga para a nova subcoleção; pode apagar os antigos ao final."
              >
                Migrar participantes (1 clique)
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded">Disputa aberta</span>
              <button onClick={async () => { if (!campeonato) return; setSalvando(true); try { const n = await sincronizarParticipantes(campeonato.id); setMsg(`${n} participante(s) novo(s) incluído(s). Pontuações anteriores foram preservadas.`); } catch (e: any) { setMsg("Erro ao sincronizar participantes: " + e.message); } finally { setSalvando(false); } }} disabled={salvando} className="px-3 py-2 rounded border text-sm disabled:opacity-50">Sincronizar líderes e Elite 4</button>
              <button
                onClick={() => campeonato && aplicarElite4(campeonato.id, escolhasAtuais)}
                disabled={salvando || !previa.plano}
                className="px-3 py-2 rounded bg-purple-700 text-white text-sm disabled:opacity-50"
              >
                {salvando ? "Aplicando resultado…" : "Encerrar disputa e aplicar resultado"}
              </button>
            </>
          )}
        </div>
      </div>

      {desafiosContestados.length > 0 && (
        <section className="rounded bg-amber-50 p-4 shadow">
          <h2 className="mb-2 text-lg font-semibold text-amber-950">Resultados contestados de desafios</h2>
          <p className="mb-3 text-sm text-amber-900">Escolha o resultado confirmado após revisar o relato dos participantes. A confirmação transfere todos os pontos do perdedor.</p>
          <ul className="space-y-3">{desafiosContestados.map((desafio) => (
            <li key={desafio.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-200 bg-white p-3">
              <span className="text-sm"><b>{desafio.challenger_nome}</b> × <b>{desafio.target_nome}</b><span className="block text-xs text-slate-600">{desafio.challenger_nome} declarou vitória de {desafio.reports?.[desafio.challenger_uid] === desafio.challenger_uid ? desafio.challenger_nome : desafio.target_nome}; {desafio.target_nome} declarou vitória de {desafio.reports?.[desafio.target_uid] === desafio.challenger_uid ? desafio.challenger_nome : desafio.target_nome}.</span></span>
              <span className="flex gap-2"><button disabled={salvando} onClick={() => resolverDesafio(desafio, desafio.challenger_uid)} className="rounded bg-amber-800 px-3 py-2 text-sm text-white disabled:opacity-50">Vitória de {desafio.challenger_nome}</button><button disabled={salvando} onClick={() => resolverDesafio(desafio, desafio.target_uid)} className="rounded bg-amber-800 px-3 py-2 text-sm text-white disabled:opacity-50">Vitória de {desafio.target_nome}</button></span>
            </li>
          ))}</ul>
        </section>
      )}

      {/* Elite 4 atual */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">ELITE 4 atual — {ligaSel || "—"}</h2>
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((pos) => (
            <li key={pos} className="p-3 bg-gray-50 rounded flex justify-between items-center">
              <span className="text-sm">Posição {pos}</span>
              <span className="text-sm font-medium">
                {elite4Atual[pos]?.nome || elite4Atual[pos]?.uid || "—"}{elite4Atual[pos]?.tipo ? ` · ${elite4Atual[pos]?.tipo}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Participantes e pontuação */}
      {emAberto && (
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold mb-3">Classificação da disputa (líderes + Elite 4)</h2>
          {participantes.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum participante encontrado para esta liga.</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">Treinador</th>
                    <th className="py-2 pr-3">Ginásio</th>
                    <th className="py-2 pr-3">Categoria</th>
                    <th className="py-2 pr-3">Escolha de participação</th>
                    <th className="py-2 pr-3">Pontos de batalha</th>
                    <th className="py-2 pr-3">Bônus vitória</th>
                    <th className="py-2 pr-3">Admin</th>
                    <th className="py-2 pr-3">Desafios</th>
                    <th className="py-2 pr-3">Total</th>
                    <th className="py-2 pr-3">Atribuir pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {participantes
                    .slice().sort(ordenarParticipantes)
                    .map((p) => (
                      <tr key={p.id} className="border-b">
                        <td className="py-2 pr-3">{p.nome || p.usuario_uid}</td>
                        <td className="py-2 pr-3">{p.ginasio_nome || "—"}</td>
                        <td className="py-2 pr-3">{p.tipo_participante === "elite4" ? `Elite 4 · posição ${p.elite4_pos || "—"}` : `Líder · ${p.ginasio_tipo || "ginásio"}`}</td>
                        <td className="py-2 pr-3">{p.tipo_participante === "elite4" ? "Defende o cargo" : p.optou_participar ? "Participando pelo ginásio escolhido" : "Não participa (padrão)"}</td>
                        <td className="py-2 pr-3">{p.pontos_participacao}</td>
                        <td className="py-2 pr-3">{p.pontos_vitoria}</td>
                        <td className="py-2 pr-3">{p.pontos_admin}</td>
                        <td className="py-2 pr-3">{p.pontos_desafios}</td>
                        <td className="py-2 pr-3 font-semibold">{p.pontos}</td>
                        <td className="min-w-64 py-2 pr-3">
                          <div className="flex gap-1">
                            <input type="number" min="1" max="1000" value={pontosManuais[p.id] || ""} onChange={(e) => setPontosManuais((prev) => ({ ...prev, [p.id]: e.target.value }))} className="w-16 rounded border px-2 py-1" aria-label={`Pontos para ${p.nome || p.usuario_uid}`} />
                            <input type="text" maxLength={160} value={motivosPontos[p.id] || ""} onChange={(e) => setMotivosPontos((prev) => ({ ...prev, [p.id]: e.target.value }))} placeholder="Motivo" className="min-w-24 flex-1 rounded border px-2 py-1" />
                            <button disabled={salvando || (p.tipo_participante !== "elite4" && !p.optou_participar)} onClick={() => concederPontos(p)} className="rounded bg-blue-700 px-2 py-1 text-white disabled:opacity-40" aria-label={`Atribuir pontos a ${p.nome || p.usuario_uid}`}>+</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {emAberto && historicoPontos.length > 0 && (
        <section className="rounded bg-white p-4 shadow">
          <h2 className="mb-2 text-lg font-semibold">Últimos pontos administrativos</h2>
          <ul className="space-y-2 text-sm">
            {historicoPontos.slice(0, 10).map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
                <span><b>{item.participante_nome}</b> recebeu +{item.quantidade}: {item.motivo}</span>
                <time className="text-xs text-slate-500">{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</time>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pré-visualização do TOP-4 */}
      {emAberto && participantes.length > 0 && (
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold mb-2">Vencedores e prévia das trocas</h2>
          <p className="mb-3 text-sm text-slate-600">A sugestão considera os pontos e preserva a vaga atual em caso de empate. Se você realizou confrontos, marque os líderes vencedores antes de confirmar. O rebaixado é sempre definido pela menor pontuação entre os membros atuais.</p>
          <div className="space-y-2">{participantes.filter((p) => p.tipo_participante === "lider" && p.optou_participar).sort(ordenarParticipantes).map((p) => (
            <label key={p.id} className="flex items-start gap-3 rounded border p-3 text-sm">
              <input type="checkbox" disabled={salvando} checked={escolhasAtuais.includes(p.usuario_uid)} onChange={(event) => setSelecionados(event.target.checked ? [...escolhasAtuais, p.usuario_uid] : escolhasAtuais.filter((uid) => uid !== p.usuario_uid))} />
              <span><b>{p.nome || p.usuario_uid}</b> · {p.ginasio_nome} · {p.ginasio_tipo} · {p.pontos} pontos</span>
            </label>
          ))}</div>
          <div className="my-3 flex flex-wrap gap-2"><button disabled={salvando} onClick={() => setSelecionados(null)} className="rounded border px-3 py-2 text-sm">Usar sugestão por pontos</button><button disabled={salvando} onClick={() => setSelecionados([])} className="rounded border px-3 py-2 text-sm">Manter a Elite 4 atual</button></div>
          {previa.erro ? <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{previa.erro}</p> : !previa.plano?.trocas.length ? <p className="rounded bg-blue-50 p-3 text-sm text-blue-950">Nenhum líder será promovido. A composição atual da Elite 4 e todos os ginásios serão mantidos.</p> : <ul className="space-y-2 rounded bg-blue-50 p-3 text-sm text-blue-950">{previa.plano.trocas.map((t) => <li key={t.promovido.uid}><b>{t.promovido.nome}</b> entra na Elite 4 com o tipo <b>{t.promovido.ginasio_tipo}</b>. {t.rebaixado ? <><b>{t.rebaixado.nome}</b> assume <b>{t.promovido.ginasio_nome}</b>, que passa a ter o tipo <b>{t.rebaixado.tipo}</b>.</> : <><b>{t.promovido.ginasio_nome}</b> abre disputa por liderança porque não há membro anterior para assumir.</>}</li>)}</ul>}
          <p className="text-xs text-gray-500 mt-2">
            Apenas o ginásio inscrito de cada vencedor é transferido. Os demais ginásios do mesmo jogador continuam com ele. Se todos os líderes optarem por não participar, encerrar a disputa mantém os quatro membros atuais da Elite 4.
          </p>
        </div>
      )}
    </div>
  );
}
