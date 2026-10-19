"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
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
  tipo_participante: "lider" | "elite4";
  elite4_pos?: number;
  nome?: string;
  ginasio_nome?: string;
  ginasio_tipo?: string;
};
type Elite4 = { id: string; liga: string; pos: 1 | 2 | 3 | 4; uid: string; nome?: string };
type ResultadoPendente = { campeonato_id: string; top4: Array<{ uid: string; nome?: string; pontos?: number }> };
type PontoAdmin = { id: string; participante_nome: string; quantidade: number; motivo: string; createdAt: number };

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
        if (data.pos >= 1 && data.pos <= 4) map[data.pos] = { id: dd.id, liga: data.liga, pos: data.pos, uid: data.uid, nome: data.nome };
      });
      setElite4Atual(map);
    });

    return () => { unsubCamp(); unsubElite(); };
  }, [isAdmin, ligaSel]);

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
          tipo_participante: x.tipo_participante === "elite4" ? "elite4" : "lider",
          elite4_pos: x.elite4_pos,
        };
        // Nome do usuário
        const u = await getDoc(doc(db, "usuarios", p.usuario_uid));
        if (u.exists()) p.nome = (u.data() as any).nome || (u.data() as any).email || p.usuario_uid;
        // Nome do ginásio
        const g = p.ginasio_id ? await getDoc(doc(db, "ginasios", p.ginasio_id)) : null;
        if (g?.exists()) {
          const gd = g.data() as any;
          p.ginasio_nome = gd?.nome || p.ginasio_id;
          p.ginasio_tipo = gd?.tipo || "";
        } else {
          p.ginasio_nome = p.ginasio_id;
          p.ginasio_tipo = "";
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
      if (uid && !entradas.has(uid)) entradas.set(uid, { usuario_uid: uid, ginasio_id: g.id, tipo_participante: "lider" });
    }
    for (const e of e4.docs) {
      const data = e.data() as any;
      const uid = String(data.uid || "");
      const pos = Number(data.pos);
      if (uid && [1, 2, 3, 4].includes(pos)) {
        entradas.set(uid, { ...(entradas.get(uid) || {}), usuario_uid: uid, tipo_participante: "elite4", elite4_pos: pos });
      }
    }
    let adicionados = 0;
    for (const [uid, dados] of entradas) {
      const ref = doc(db, "campeonatos_elite4", campId, "participantes", uid);
      const atual = await getDoc(ref);
      if (atual.exists()) {
        await updateDoc(ref, {
          tipo_participante: dados.tipo_participante,
          elite4_pos: dados.elite4_pos ?? null,
          ...(dados.ginasio_id ? { ginasio_id: dados.ginasio_id } : {}),
        });
        continue;
      }
      await setDoc(ref, {
        campeonato_id: campId, usuario_uid: uid, liga: ligaSel,
        ginasio_id: dados.ginasio_id || "", tipo_participante: dados.tipo_participante,
        ...(dados.elite4_pos ? { elite4_pos: dados.elite4_pos } : {}),
        pontos: 0, pontos_participacao: 0, pontos_vitoria: 0, pontos_admin: 0,
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
        createdAt: Date.now(),
      });

      const quantidade = await sincronizarParticipantes(campRef.id);
      setMsg(`Disputa criada com ${quantidade} participantes, incluindo líderes e Elite 4.`);
    } catch (e: any) {
      setMsg("Erro ao criar: " + e.message);
    } finally {
      setSalvando(false);
    }
  };

  /** Pontos administrativos são somados à pontuação automática e ficam auditáveis. */
  const concederPontos = async (p: Participante) => {
    if (!campeonato) return;
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
  const aplicarElite4 = async (campId: string, escolhidos: Array<{ uid: string; nome?: string; pontos?: number }>) => {
    if (salvando) return;
    if (escolhidos.length !== 4 || new Set(escolhidos.map((p) => p.uid)).size !== 4) {
      setMsg("Escolha quatro participantes diferentes para a Elite 4."); return;
    }
    if (!confirm(`Definir a Elite 4 da liga ${ligaSel}?\n\n` +
      escolhidos.map((p, index) => `${index + 1}º: ${p.nome || p.uid} (${p.pontos || 0} pts)`).join("\n") +
      "\n\nOs quatro nomes ocuparão a Elite 4. Seus ginásios ficarão vagos e abrirão inscrições para novos líderes. Desafios pendentes contra esses líderes serão cancelados. A composição anterior ficará no histórico.")) return;
    setSalvando(true); setMsg("");
    try {
      const finalizar = httpsCallable<{ campeonatoId: string; selecionados: string[] }, { jaAplicada: boolean; ginasiosLiberados: Array<{ nome: string }> }>(getFunctions(auth.app, "southamerica-east1"), "adminFinalizeElite4");
      const { data } = await finalizar({ campeonatoId: campId, selecionados: escolhidos.map((p) => p.uid) });
      setMsg(data.jaAplicada ? "Esta promoção já foi aplicada. Nenhuma disputa foi duplicada." :
        `Elite 4 definida com sucesso. ${data.ginasiosLiberados.length} ginásio(s) liberado(s), com disputa de liderança aberta${data.ginasiosLiberados.length ? `: ${data.ginasiosLiberados.map((g) => g.nome).join(", ")}` : ""}.`);
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

  const topPreview = useMemo(() => {
    return participantes.filter((p) => p.tipo_participante === "lider").sort(ordenarParticipantes).slice(0, 4);
  }, [participantes]);
  const escolhasAtuais = selecionados ?? topPreview.map((p) => p.usuario_uid);
  const escolhidosAtuais = escolhasAtuais.map((uid) => participantes.find((p) => p.usuario_uid === uid)).filter((p): p is Participante => Boolean(p));

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
        <h1 className="text-2xl font-bold">Disputa da Elite 4 — {ligaSel || "Liga"}</h1>
          <p className="text-sm text-gray-500">
            Cada desafio concluído rende 1 ponto de participação; uma vitória do líder soma mais 2 (3 no total). A Elite 4 recebe pontos administrativos. Revise os quatro escolhidos antes de encerrar e aplicar a nova composição.
          </p>
        </div>
        <button onClick={() => router.push("/dev")} className="text-sm text-blue-600 underline">Voltar ao painel</button>
      </div>

      {msg && <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">{msg}</div>}

      {!emAberto && resultadoPendente && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
          <h2 className="font-semibold">A última disputa foi encerrada sem aplicar a promoção</h2>
          <p className="text-sm">Você pode concluir a operação usando os quatro classificados que ficaram registrados, sem abrir outra disputa da Elite 4.</p>
          <ol className="list-decimal pl-5 text-sm">{resultadoPendente.top4.map((p) => <li key={p.uid}>{p.nome || p.uid} · {p.pontos || 0} pontos</li>)}</ol>
          <button onClick={() => aplicarElite4(resultadoPendente.campeonato_id, resultadoPendente.top4)} disabled={salvando} className="rounded bg-purple-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{salvando ? "Aplicando promoção…" : "Aplicar promoção e abrir disputas dos ginásios"}</button>
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
                onClick={() => campeonato && aplicarElite4(campeonato.id, escolhidosAtuais.map((p) => ({ uid: p.usuario_uid, nome: p.nome, pontos: p.pontos })))}
                disabled={salvando || escolhidosAtuais.length !== 4 || new Set(escolhasAtuais).size !== 4}
                className="px-3 py-2 rounded bg-purple-700 text-white text-sm disabled:opacity-50"
              >
                {salvando ? "Aplicando promoção…" : "Encerrar e definir Elite 4"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Elite 4 atual */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">ELITE 4 atual — {ligaSel || "—"}</h2>
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((pos) => (
            <li key={pos} className="p-3 bg-gray-50 rounded flex justify-between items-center">
              <span className="text-sm">Posição {pos}</span>
              <span className="text-sm font-medium">
                {elite4Atual[pos]?.nome || elite4Atual[pos]?.uid || "—"}
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
                    <th className="py-2 pr-3">Participação</th>
                    <th className="py-2 pr-3">Bônus vitória</th>
                    <th className="py-2 pr-3">Admin</th>
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
                        <td className="py-2 pr-3">{p.pontos_participacao}</td>
                        <td className="py-2 pr-3">{p.pontos_vitoria}</td>
                        <td className="py-2 pr-3">{p.pontos_admin}</td>
                        <td className="py-2 pr-3 font-semibold">{p.pontos}</td>
                        <td className="min-w-64 py-2 pr-3">
                          <div className="flex gap-1">
                            <input type="number" min="1" max="1000" value={pontosManuais[p.id] || ""} onChange={(e) => setPontosManuais((prev) => ({ ...prev, [p.id]: e.target.value }))} className="w-16 rounded border px-2 py-1" aria-label={`Pontos para ${p.nome || p.usuario_uid}`} />
                            <input type="text" maxLength={160} value={motivosPontos[p.id] || ""} onChange={(e) => setMotivosPontos((prev) => ({ ...prev, [p.id]: e.target.value }))} placeholder="Motivo" className="min-w-24 flex-1 rounded border px-2 py-1" />
                            <button onClick={() => concederPontos(p)} className="rounded bg-blue-700 px-2 py-1 text-white" aria-label={`Atribuir pontos a ${p.nome || p.usuario_uid}`}>+</button>
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
          <h2 className="text-lg font-semibold mb-2">Definir os quatro membros da Elite 4</h2>
          <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((index) => (
            <label key={index} className="text-sm font-medium">Posição {index + 1}
              <select disabled={salvando} value={escolhasAtuais[index] || ""} onChange={(event) => { const lista = Array.from({ length: 4 }, (_, i) => escolhasAtuais[i] || ""); lista[index] = event.target.value; setSelecionados(lista); }} className="mt-1 block w-full rounded border p-2">
                <option value="">Selecione um participante</option>
                {[...participantes].sort(ordenarParticipantes).map((p) => <option key={p.id} value={p.usuario_uid}>{p.nome || p.usuario_uid} · {p.pontos} pts · {p.tipo_participante === "elite4" ? "Elite 4 atual" : p.ginasio_nome || "Líder"}</option>)}
              </select>
            </label>
          ))}</div>
          <p className="text-xs text-gray-500 mt-2">
            A sugestão inicial usa os quatro líderes mais bem pontuados. Você pode ajustar a seleção após os confrontos, inclusive mantendo membros atuais da Elite 4. Ao confirmar o encerramento, os escolhidos assumem os cargos e seus ginásios abrem disputa por novos líderes.
          </p>
        </div>
      )}
    </div>
  );
}
