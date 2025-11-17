"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  getDoc,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc, // <-- IMPORTADO
  doc,
} from "firebase/firestore";

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  em_disputa: boolean;
  liga?: string;
  liga_nome?: string;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: "inscricoes" | "batalhando" | "finalizado";
  tipo_original?: string;
};

type Liga = { id: string; nome: string };
type Temporada = { id: string; nome?: string } | null;

type Renuncia = {
  id: string;
  ginasio_id: string;
  liga?: string;
  lider_uid: string;
  status: "pendente" | "confirmado" | "cancelado";
  motivo?: string;
  createdAtMs?: number | null;
};

function toMillis(v: any): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && "seconds" in v) {
    const sec = (v as any).seconds ?? 0;
    const ns = (v as any).nanoseconds ?? 0;
    return sec * 1000 + Math.floor(ns / 1e6);
  }
  return null;
}
function tempoRelativo(ms?: number | null) {
  if (!ms) return "indeterminado";
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Fecha qualquer liderança ativa do ginásio (para registrar o término no histórico). */
async function endActiveLeadership(ginasioId: string) {
  const snap = await getDocs(
    query(
      collection(db, "ginasios_liderancas"),
      where("ginasio_id", "==", ginasioId),
      where("fim", "==", null)
    )
  );
  for (const d of snap.docs) {
    await updateDoc(d.ref, {
      fim: Date.now(),
      endedByAdminUid: auth.currentUser?.uid || null,
    });
  }
}

/** Inicia um novo período de liderança (para o perfil calcular “há quanto tempo”). */
async function startLeadership(
  ginasioId: string,
  leaderUid: string,
  meta?: { origem?: "disputa" | "renuncia" | "3_derrotas" | "manual"; tipo?: string; temporada?: Temporada }
) {
  let liga = "";
  let tipo = meta?.tipo || "";

  try {
    const gSnap = await getDoc(doc(db, "ginasios", ginasioId));
    if (gSnap.exists()) {
      const g = gSnap.data() as any;
      liga = g.liga || g.liga_nome || "";
      if (!tipo) tipo = g.tipo || "";
    }
  } catch {}

  await addDoc(collection(db, "ginasios_liderancas"), {
    ginasio_id: ginasioId,
    lider_uid: leaderUid,
    inicio: Date.now(),
    fim: null,
    origem: meta?.origem || "disputa",
    liga,
    tipo_no_periodo: tipo,
    temporada_id: meta?.temporada?.id || "",
    temporada_nome: meta?.temporada?.nome || "",
    createdByAdminUid: auth.currentUser?.uid || null,
    endedByAdminUid: null,
  });
}

/** Apaga todos os participantes de uma disputa (limpa inscrição antiga). */
async function deleteParticipantsOfDispute(disputaId: string) {
  const ps = await getDocs(
    query(collection(db, "disputas_ginasio_participantes"), where("disputa_id", "==", disputaId))
  );
  await Promise.all(ps.docs.map((d) => deleteDoc(d.ref)));
}

export default function DevGinasiosPage() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [temporada, setTemporada] = useState<Temporada>(null);
  const [renunciasMap, setRenunciasMap] = useState<Record<string, Renuncia>>({});

  // 1) auth + superusers
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const q = query(collection(db, "superusers"), where("uid", "==", user.uid));
      const snap = await getDocs(q);
      if (snap.empty) {
        setIsAdmin(false);
        router.replace("/");
        return;
      }
      setIsAdmin(true);
    });
    return () => unsub();
  }, [router]);

  // 2) carregar ligas
  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const list: Liga[] = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as any).nome || d.id,
      }));
      setLigas(list);
      if (list.length > 0) setLigaSelecionada(list[0].nome);
    })();
  }, [isAdmin]);

  // 2.1) temporada ativa
  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const qTemp = query(collection(db, "temporadas"), where("ativa", "==", true));
      const snap = await getDocs(qTemp);
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data() as any;
        setTemporada({ id: d.id, nome: data.nome });
      } else {
        setTemporada(null);
      }
    })();
  }, [isAdmin]);

  // 3) carregar ginasios + disputas + renúncias pendentes
  useEffect(() => {
    if (isAdmin !== true) return;

    async function loadAll() {
      const gSnap = await getDocs(collection(db, "ginasios"));
      const gList: Ginasio[] = gSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || "",
          lider_uid: data.lider_uid || "",
          em_disputa: data.em_disputa || false,
          liga: data.liga || data.liga_nome || "",
          liga_nome: data.liga_nome || data.liga || "",
        };
      });

      const dSnap = await getDocs(
        query(
          collection(db, "disputas_ginasio"),
          where("status", "in", ["inscricoes", "batalhando"])
        )
      );
      const dList: Disputa[] = dSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          status: data.status,
          tipo_original: data.tipo_original || "",
        };
      });

      const rSnap = await getDocs(
        query(collection(db, "renuncias_ginasio"), where("status", "==", "pendente"))
      );
      const map: Record<string, Renuncia> = {};
      rSnap.docs.forEach((dd) => {
        const x = dd.data() as any;
        const r: Renuncia = {
          id: dd.id,
          ginasio_id: x.ginasio_id,
          liga: x.liga || "",
          lider_uid: x.lider_uid,
          status: x.status || "pendente",
          motivo: x.motivo || "",
          createdAtMs: toMillis(x.createdAt),
        };
        const cur = map[r.ginasio_id];
        if (!cur || (r.createdAtMs || 0) > (cur.createdAtMs || 0)) map[r.ginasio_id] = r;
      });

      setGinasios(gList);
      setDisputas(dList);
      setRenunciasMap(map);
      setLoading(false);
    }

    loadAll();
  }, [isAdmin]);

  const getDisputaDoGinasio = (gId: string) =>
    disputas.find((d) => d.ginasio_id === gId);

  // criar disputa manual
  const handleCriarDisputa = async (g: Ginasio) => {
    const ja = getDisputaDoGinasio(g.id);
    if (ja) return;

    const nova = await addDoc(collection(db, "disputas_ginasio"), {
      ginasio_id: g.id,
      status: "inscricoes",
      tipo_original: g.tipo || "",
      lider_anterior_uid: g.lider_uid || "",
      temporada_id: temporada?.id || "",
      temporada_nome: temporada?.nome || "",
      liga: g.liga || g.liga_nome || "",
      origem: "manual",
      createdAt: Date.now(),
    });

    await updateDoc(doc(db, "ginasios", g.id), { em_disputa: true });

    setDisputas((prev) => [
      ...prev,
      { id: nova.id, ginasio_id: g.id, status: "inscricoes", tipo_original: g.tipo || "" },
    ]);
    setGinasios((prev) =>
      prev.map((gg) => (gg.id === g.id ? { ...gg, em_disputa: true } : gg))
    );
  };

  // iniciar disputa
  const handleIniciarDisputa = async (g: Ginasio) => {
    const disputa = getDisputaDoGinasio(g.id);
    if (!disputa || disputa.status !== "inscricoes") return;

    const partSnap = await getDocs(
      query(collection(db, "disputas_ginasio_participantes"), where("disputa_id", "==", disputa.id))
    );
    for (const pDoc of partSnap.docs) {
      const d = pDoc.data() as any;
      if (!d.tipo_escolhido || d.tipo_escolhido === "") {
        await updateDoc(pDoc.ref, { removido: true });
      }
    }

    await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
      status: "batalhando",
      iniciadaEm: Date.now(),
    });

    setDisputas((prev) =>
      prev.map((d) => (d.id === disputa.id ? { ...d, status: "batalhando" } : d))
    );
  };

  // encerrar disputa → registra período de liderança E APAGA PARTICIPANTES DA DISPUTA ENCERRADA
  const handleEncerrarDisputa = async (g: Ginasio) => {
    const disputa = getDisputaDoGinasio(g.id);
    if (!disputa) return;

    const partSnap = await getDocs(
      query(collection(db, "disputas_ginasio_participantes"), where("disputa_id", "==", disputa.id))
    );
    const participantes = partSnap.docs
      .map((p) => {
        const d = p.data() as any;
        if (d.removido) return null;
        return { usuario_uid: d.usuario_uid as string, tipo_escolhido: d.tipo_escolhido as string };
      })
      .filter(Boolean) as { usuario_uid: string; tipo_escolhido: string }[];

    const resSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_resultados"),
        where("disputa_id", "==", disputa.id),
        where("status", "==", "confirmado")
      )
    );
    const resultados = resSnap.docs.map((r) => {
      const d = r.data() as any;
      return {
        vencedor_uid: d.vencedor_uid as string | undefined,
        perdedor_uid: d.perdedor_uid as string | undefined,
        tipo: d.tipo as string | undefined,
        jogador1_uid: d.jogador1_uid as string | undefined,
        jogador2_uid: d.jogador2_uid as string | undefined,
      };
    });

    const pontos: Record<string, number> = {};
    participantes.forEach((p) => (pontos[p.usuario_uid] = 0));

    resultados.forEach((r) => {
      if (r.tipo === "empate") {
        if (r.jogador1_uid) pontos[r.jogador1_uid] = (pontos[r.jogador1_uid] || 0) + 1;
        if (r.jogador2_uid) pontos[r.jogador2_uid] = (pontos[r.jogador2_uid] || 0) + 1;
      } else if (r.vencedor_uid) {
        pontos[r.vencedor_uid] = (pontos[r.vencedor_uid] || 0) + 3;
      }
    });

    let maior = -1;
    for (const uid in pontos) if (pontos[uid] > maior) maior = pontos[uid];
    const empatados = Object.keys(pontos).filter((uid) => pontos[uid] === maior);

    // --- caso EMPATE: fecha antiga, cria nova disputa E apaga participantes da disputa antiga
    if (empatados.length > 1) {
      const nova = await addDoc(collection(db, "disputas_ginasio"), {
        ginasio_id: g.id,
        status: "inscricoes",
        tipo_original: disputa.tipo_original || g.tipo || "",
        lider_anterior_uid: g.lider_uid || "",
        reaberta_por_empate: true,
        temporada_id: temporada?.id || "",
        temporada_nome: temporada?.nome || "",
        liga: g.liga || g.liga_nome || "",
        origem: "empate",
        createdAt: Date.now(),
      });

      for (const uid of empatados) {
        const partOrig = participantes.find((p) => p.usuario_uid === uid);
        await addDoc(collection(db, "disputas_ginasio_participantes"), {
          disputa_id: nova.id,
          ginasio_id: g.id,
          usuario_uid: uid,
          tipo_escolhido: partOrig?.tipo_escolhido || disputa.tipo_original || g.tipo || "",
          createdAt: Date.now(),
        });
      }

      await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
        status: "finalizado",
        encerradaEm: Date.now(),
      });

      // LIMPA PARTICIPANTES DA DISPUTA ANTIGA
      await deleteParticipantsOfDispute(disputa.id);

      setDisputas((prev) => {
        const semAntiga = prev.filter((d) => d.id !== disputa.id);
        return [...semAntiga, { id: nova.id, ginasio_id: g.id, status: "inscricoes", tipo_original: disputa.tipo_original || g.tipo || "" }];
      });

      await updateDoc(doc(db, "ginasios", g.id), { em_disputa: true });
      return;
    }

    // --- caso VENCEDOR DEFINIDO
    const vencedorUid = empatados[0];
    const participanteVencedor = participantes.find((p) => p.usuario_uid === vencedorUid);
    const tipoDoVencedor =
      participanteVencedor?.tipo_escolhido ||
      (participanteVencedor as any)?.tipo ||
      disputa.tipo_original ||
      g.tipo ||
      "";

    await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
      status: "finalizado",
      encerradaEm: Date.now(),
      vencedor_uid: vencedorUid,
    });

    // encerra liderança atual (se houver) e inicia novo período
    await endActiveLeadership(g.id);
    await startLeadership(g.id, vencedorUid, { origem: "disputa", tipo: tipoDoVencedor, temporada });

    // atualiza ginásio
    await updateDoc(doc(db, "ginasios", g.id), {
      lider_uid: vencedorUid,
      tipo: tipoDoVencedor,
      em_disputa: false,
    });

    // LIMPA PARTICIPANTES DA DISPUTA ENCERRADA
    await deleteParticipantsOfDispute(disputa.id);

    // estado local
    setDisputas((prev) => prev.filter((d) => d.id !== disputa.id));
    setGinasios((prev) =>
      prev.map((gg) =>
        gg.id === g.id ? { ...gg, em_disputa: false, lider_uid: vencedorUid, tipo: tipoDoVencedor } : gg
      )
    );
  };

  // ===== RENÚNCIA
  const handleConfirmarRenuncia = async (g: Ginasio, r: Renuncia) => {
    const renRef = doc(db, "renuncias_ginasio", r.id);
    const disputaExistente = getDisputaDoGinasio(g.id);

    // encerra liderança vigente
    await endActiveLeadership(g.id);

    if (!disputaExistente) {
      const nova = await addDoc(collection(db, "disputas_ginasio"), {
        ginasio_id: g.id,
        status: "inscricoes",
        tipo_original: g.tipo || "",
        lider_anterior_uid: g.lider_uid || r.lider_uid || "",
        temporada_id: temporada?.id || "",
        temporada_nome: temporada?.nome || "",
        liga: g.liga || g.liga_nome || r.liga || "",
        origem: "renuncia",
        createdAt: Date.now(),
      });

      setDisputas((prev) => [
        ...prev,
        { id: nova.id, ginasio_id: g.id, status: "inscricoes", tipo_original: g.tipo || "" },
      ]);
    }

    await updateDoc(doc(db, "ginasios", g.id), { lider_uid: "", em_disputa: true, derrotas_seguidas: 0 });

    setGinasios((prev) => prev.map((gg) => (gg.id === g.id ? { ...gg, lider_uid: "", em_disputa: true } : gg)));

    await updateDoc(renRef, {
      status: "confirmado",
      confirmadoPorAdminUid: auth.currentUser?.uid || null,
      confirmadoPorAdminEm: Date.now(),
    });

    setRenunciasMap((prev) => {
      const { [g.id]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleCancelarRenuncia = async (g: Ginasio, r: Renuncia) => {
    await updateDoc(doc(db, "renuncias_ginasio", r.id), {
      status: "cancelado",
      canceladoPorAdminUid: auth.currentUser?.uid || null,
      canceladoPorAdminEm: Date.now(),
    });
    setRenunciasMap((prev) => {
      const { [g.id]: _, ...rest } = prev;
      return rest;
    });
  };

  if (isAdmin === null || loading) return <p className="p-8">Carregando...</p>;
  if (isAdmin === false) return null;

  const ginasiosFiltrados = ginasios.filter((g) => {
    if (!ligaSelecionada) return true;
    const nomeLigaDoGinasio = g.liga_nome || g.liga || "";
    return nomeLigaDoGinasio === ligaSelecionada;
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">DEV / Ginásios</h1>
          <p className="text-sm text-gray-500">Abrir / iniciar / encerrar disputas manualmente. Tratar renúncias pendentes.</p>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Filtrar por liga</label>
          <select
            value={ligaSelecionada}
            onChange={(e) => setLigaSelecionada(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">Todas</option>
            {ligas.map((l) => (
              <option key={l.id} value={l.nome}>{l.nome}</option>
            ))}
          </select>
        </div>
      </div>

      {ginasiosFiltrados.map((g) => {
        const disputa = getDisputaDoGinasio(g.id);
        const ren = renunciasMap[g.id];

        return (
          <div key={g.id} className="border rounded p-4 flex justify-between items-start bg-white gap-4">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                {g.nome}
                {g.em_disputa && <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">em disputa</span>}
                {ren && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">renúncia pendente</span>}
              </h2>
              <p className="text-sm text-gray-600">Líder: {g.lider_uid ? g.lider_uid : "vago"}</p>
              <p className="text-xs text-gray-500">Liga: {g.liga_nome || g.liga || "Sem liga"}</p>
              <p className="text-xs text-gray-500">Disputa: {disputa ? disputa.status : "nenhuma"}</p>
              <a href={`/ginasios/${g.id}/disputa`} className="text-xs text-blue-600 underline">Ver página da disputa</a>

              {ren && (
                <div className="mt-2 text-xs text-gray-700">
                  <p>Renúncia por {ren.lider_uid} · há {tempoRelativo(ren.createdAtMs)} {ren.motivo ? `· Motivo: ${ren.motivo}` : ""}</p>
                  <p className="text-[10px] text-gray-400">ID renúncia: {ren.id}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {!disputa && (
                <button onClick={() => handleCriarDisputa(g)} className="bg-purple-500 text-white px-3 py-1 rounded text-sm">
                  Criar disputa
                </button>
              )}
              {disputa && disputa.status === "inscricoes" && (
                <button onClick={() => handleIniciarDisputa(g)} className="bg-orange-500 text-white px-3 py-1 rounded text-sm">
                  Iniciar disputa
                </button>
              )}
              {disputa && (
                <button onClick={() => handleEncerrarDisputa(g)} className="bg-gray-500 text-white px-3 py-1 rounded text-sm">
                  Encerrar disputa
                </button>
              )}

              {ren && (
                <>
                  <button
                    onClick={() => handleConfirmarRenuncia(g, ren)}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
                    title="Confirmar renúncia, abrir disputa (se não existir) e limpar liderança"
                  >
                    Confirmar renúncia
                  </button>
                  <button
                    onClick={() => handleCancelarRenuncia(g, ren)}
                    className="bg-red-600 text-white px-3 py-1 rounded text-sm"
                    title="Cancelar a renúncia"
                  >
                    Cancelar renúncia
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
