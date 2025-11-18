"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  getDoc,
  doc,
  orderBy,
  updateDoc,
  addDoc,
  deleteDoc,
} from "firebase/firestore";

// ==== Tipos ====
type Resultado = {
  id: string;
  disputa_id: string;
  ginasio_id: string;
  tipo?: "empate";
  vencedor_uid?: string;
  perdedor_uid?: string;
  jogador1_uid?: string;
  jogador2_uid?: string;
  declarado_por: string;
  status: "pendente" | "confirmado" | "contestado";
  createdAtMs: number | null;
};

type Desafio = {
  id: string;
  ginasio_id: string;
  liga?: string;
  lider_uid: string;
  desafiante_uid: string;
  status: "pendente" | "conflito" | "concluido";
  resultado_lider: "lider" | "desafiante" | null;
  resultado_desafiante: "lider" | "desafiante" | null;
  createdAtMs: number | null;
};

type Renuncia = {
  id: string;
  ginasio_id: string;
  liga?: string;
  lider_uid: string;
  status: "pendente" | "confirmado" | "cancelado";
  createdAtMs: number | null;
  motivo?: string;
  criadoPorUid?: string;
};

type GymInfo = {
  nome: string;
  liga?: string;
  tipo?: string;
  lider_uid?: string;
  insignia_icon?: string;
  derrotas_seguidas?: number;
};
type UserInfo = { display: string };

type Temporada = { id: string; nome?: string } | null;

// ==== Utils ====
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

// --------- Helpers (purga + liderança) ----------
async function purgeDisputa(disputaId: string) {
  // participantes
  const pSnap = await getDocs(
    query(
      collection(db, "disputas_ginasio_participantes"),
      where("disputa_id", "==", disputaId)
    )
  );
  for (const d of pSnap.docs) {
    try {
      await deleteDoc(d.ref);
    } catch {
      await updateDoc(d.ref, { removido: true });
    }
  }

  // resultados
  const rSnap = await getDocs(
    query(
      collection(db, "disputas_ginasio_resultados"),
      where("disputa_id", "==", disputaId)
    )
  );
  for (const d of rSnap.docs) {
    try {
      await deleteDoc(d.ref);
    } catch {
      await updateDoc(d.ref, { status: "limpo" });
    }
  }

  // disputa
  const dRef = doc(db, "disputas_ginasio", disputaId);
  try {
    await deleteDoc(dRef);
  } catch {
    await updateDoc(dRef, {
      status: "finalizado",
      encerradaEm: Date.now(),
      purgada: true,
    });
  }
}

async function closeAndPurgeActiveDisputes(ginasioId: string) {
  const snap = await getDocs(
    query(
      collection(db, "disputas_ginasio"),
      where("ginasio_id", "==", ginasioId),
      where("status", "in", ["inscricoes", "batalhando"])
    )
  );
  for (const d of snap.docs) {
    await purgeDisputa(d.id);
  }
}

async function endActiveLeadership(ginasioId: string) {
  const snap = await getDocs(
    query(
      collection(db, "ginasios_liderancas"),
      where("ginasio_id", "==", ginasioId),
      where("endedAt", "==", null)
    )
  );
  for (const d of snap.docs) {
    await updateDoc(d.ref, {
      endedAt: Date.now(),
      endedByAdminUid: auth.currentUser?.uid || null,
    });
  }
}
// ---------------------------------------------------

export default function DevDisputasPage() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // seção 1
  const [resultados, setResultados] = useState<Resultado[]>([]);
  // seção 2
  const [desafios1lado, setDesafios1lado] = useState<Desafio[]>([]);
  // seção 3
  const [renuncias, setRenuncias] = useState<Renuncia[]>([]);

  const [gMap, setGMap] = useState<Record<string, GymInfo>>({});
  const [uMap, setUMap] = useState<Record<string, UserInfo>>({});

  const [ligaFiltro, setLigaFiltro] = useState<string>("");
  const [textoBusca, setTextoBusca] = useState<string>("");
  const [ligasDisponiveis, setLigasDisponiveis] = useState<string[]>([]);

  const [temporada, setTemporada] = useState<Temporada>(null);

  // auth + super (compatível com as rules: superusers/{uid})
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setIsAdmin(null);
        router.replace("/login");
        return;
      }
      try {
        const supSnap = await getDoc(doc(db, "superusers", user.uid));
        if (!supSnap.exists()) {
          setIsAdmin(false);
          router.replace("/");
          return;
        }
        setIsAdmin(true);
      } catch {
        setIsAdmin(false);
        router.replace("/");
      }
    });
    return () => unsub();
  }, [router]);

  // temporada ativa
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

  // resultados pendentes
  useEffect(() => {
    if (isAdmin !== true) return;
    const qRes = query(
      collection(db, "disputas_ginasio_resultados"),
      where("status", "==", "pendente"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(qRes, (snap) => {
      const list: Resultado[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          disputa_id: x.disputa_id,
          ginasio_id: x.ginasio_id,
          tipo: x.tipo,
          vencedor_uid: x.vencedor_uid,
          perdedor_uid: x.perdedor_uid,
          jogador1_uid: x.jogador1_uid,
          jogador2_uid: x.jogador2_uid,
          declarado_por: x.declarado_por,
          status: x.status || "pendente",
          createdAtMs: toMillis(x.createdAt),
        };
      });
      setResultados(list);
    });
    return () => unsub();
  }, [isAdmin]);

  // desafios 1 lado
  useEffect(() => {
    if (isAdmin !== true) return;
    const qD = query(
      collection(db, "desafios_ginasio"),
      where("status", "==", "pendente"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(qD, (snap) => {
      const list: Desafio[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            ginasio_id: x.ginasio_id,
            liga: x.liga || "",
            lider_uid: x.lider_uid,
            desafiante_uid: x.desafiante_uid,
            status: x.status,
            resultado_lider: x.resultado_lider ?? null,
            resultado_desafiante: x.resultado_desafiante ?? null,
            createdAtMs: toMillis(x.createdAt),
          };
        })
        .filter((d) => {
          const a = d.resultado_lider;
          const b = d.resultado_desafiante;
          return (a && !b) || (!a && b);
        });
      setDesafios1lado(list);
    });
    return () => unsub();
  }, [isAdmin]);

  // renúncias pendentes
  useEffect(() => {
    if (isAdmin !== true) return;
    const qR = query(
      collection(db, "renuncias_ginasio"),
      where("status", "==", "pendente"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(qR, (snap) => {
      const list: Renuncia[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          liga: x.liga || "",
          lider_uid: x.lider_uid,
          status: x.status || "pendente",
          createdAtMs: toMillis(x.createdAt),
          motivo: x.motivo || "",
          criadoPorUid: x.criadoPorUid || "",
        };
      });
      setRenuncias(list);
    });
    return () => unsub();
  }, [isAdmin]);

  // carregar gyms + ligas
  useEffect(() => {
    if (isAdmin !== true) return;
    const gymIds = new Set<string>();
    resultados.forEach((r) => gymIds.add(r.ginasio_id));
    desafios1lado.forEach((d) => gymIds.add(d.ginasio_id));
    renuncias.forEach((r) => gymIds.add(r.ginasio_id));

    (async () => {
      const entries: Array<[string, GymInfo]> = await Promise.all(
        Array.from(gymIds).map(async (gid) => {
          const g = await getDoc(doc(db, "ginasios", gid));
          if (g.exists()) {
            const gd = g.data() as any;
            return [
              gid,
              {
                nome: gd.nome || gid,
                liga: gd.liga || gd.liga_nome || "",
                tipo: gd.tipo || "",
                lider_uid: gd.lider_uid || "",
                insignia_icon: gd.insignia_icon || "",
                derrotas_seguidas: gd.derrotas_seguidas ?? 0,
              },
            ] as const;
          }
          return [gid, { nome: gid }] as const;
        })
      );

      const next: Record<string, GymInfo> = {};
      const ligas = new Set<string>();
      for (const [gid, info] of entries) {
        next[gid] = info;
        if (info.liga) ligas.add(info.liga);
      }
      setGMap(next);
      setLigasDisponiveis(Array.from(ligas).sort());
    })();
  }, [resultados, desafios1lado, renuncias, isAdmin]);

  // carregar nomes
  useEffect(() => {
    if (isAdmin !== true) return;
    const uids = new Set<string>();
    resultados.forEach((r) => {
      if (r.vencedor_uid) uids.add(r.vencedor_uid);
      if (r.perdedor_uid) uids.add(r.perdedor_uid);
      if (r.jogador1_uid) uids.add(r.jogador1_uid);
      if (r.jogador2_uid) uids.add(r.jogador2_uid);
      if (r.declarado_por) uids.add(r.declarado_por);
    });
    desafios1lado.forEach((d) => {
      uids.add(d.lider_uid);
      uids.add(d.desafiante_uid);
    });
    renuncias.forEach((r) => {
      uids.add(r.lider_uid);
      if (r.criadoPorUid) uids.add(r.criadoPorUid);
    });

    (async () => {
      const kvs = await Promise.all(
        Array.from(uids).map(async (uid) => {
          const u = await getDoc(doc(db, "usuarios", uid));
          if (u.exists()) {
            const ud = u.data() as any;
            return [uid, { display: ud.nome || ud.email || uid }] as const;
          }
          return [uid, { display: uid }] as const;
        })
      );
      const next: Record<string, UserInfo> = {};
      for (const [k, v] of kvs) next[k] = v;
      setUMap(next);
    })();
  }, [resultados, desafios1lado, renuncias, isAdmin]);

  // filtros
  const resultadosFiltrados = useMemo(() => {
    return resultados.filter((r) => {
      const liga = gMap[r.ginasio_id]?.liga || "";
      if (ligaFiltro && liga !== ligaFiltro) return false;

      if (textoBusca.trim()) {
        const t = textoBusca.trim().toLowerCase();
        const gymName = (gMap[r.ginasio_id]?.nome || r.ginasio_id).toLowerCase();
        const a = (uMap[r.vencedor_uid || r.jogador1_uid || ""]?.display || "").toLowerCase();
        const b = (uMap[r.perdedor_uid || r.jogador2_uid || ""]?.display || "").toLowerCase();
        if (!gymName.includes(t) && !a.includes(t) && !b.includes(t)) return false;
      }
      return true;
    });
  }, [resultados, gMap, uMap, ligaFiltro, textoBusca]);

  const desafiosFiltrados = useMemo(() => {
    return desafios1lado.filter((d) => {
      const liga = gMap[d.ginasio_id]?.liga || d.liga || "";
      if (ligaFiltro && liga !== ligaFiltro) return false;

      if (textoBusca.trim()) {
        const t = textoBusca.trim().toLowerCase();
        const gymName = (gMap[d.ginasio_id]?.nome || d.ginasio_id).toLowerCase();
        const desafiante = (uMap[d.desafiante_uid]?.display || "").toLowerCase();
        const lider = (uMap[d.lider_uid]?.display || "").toLowerCase();
        if (!gymName.includes(t) && !desafiante.includes(t) && !lider.includes(t)) return false;
      }
      return true;
    });
  }, [desafios1lado, gMap, uMap, ligaFiltro, textoBusca]);

  const renunciasFiltradas = useMemo(() => {
    return renuncias.filter((r) => {
      const liga = gMap[r.ginasio_id]?.liga || r.liga || "";
      if (ligaFiltro && liga !== ligaFiltro) return false;

      if (textoBusca.trim()) {
        const t = textoBusca.trim().toLowerCase();
        const gymName = (gMap[r.ginasio_id]?.nome || r.ginasio_id).toLowerCase();
        const liderName = (uMap[r.lider_uid]?.display || "").toLowerCase();
        if (!gymName.includes(t) && !liderName.includes(t)) return false;
      }
      return true;
    });
  }, [renuncias, gMap, uMap, ligaFiltro, textoBusca]);

  // ações: resultados de disputa (liga)
  async function confirmarResultadoLiga(r: Resultado) {
    await updateDoc(doc(db, "disputas_ginasio_resultados", r.id), {
      status: "confirmado",
      confirmadoPorAdminUid: auth.currentUser?.uid || null,
      confirmadoPorAdminEm: Date.now(),
    });
  }
  async function contestarResultadoLiga(r: Resultado) {
    await updateDoc(doc(db, "disputas_ginasio_resultados", r.id), {
      status: "contestado",
      atualizadoPorAdminUid: auth.currentUser?.uid || null,
      atualizadoPorAdminEm: Date.now(),
    });
  }

  // ações: desafios 1 lado
  async function confirmarDesafio(d: Desafio) {
    const declarado = d.resultado_lider ?? d.resultado_desafiante;
    const ref = doc(db, "desafios_ginasio", d.id);
    if (!declarado) return;

    const patch: any = {};
    if (d.resultado_lider == null) patch["resultado_lider"] = declarado;
    if (d.resultado_desafiante == null) patch["resultado_desafiante"] = declarado;
    patch["confirmadoPorAdminUid"] = auth.currentUser?.uid || null;
    patch["confirmadoPorAdminEm"] = Date.now();

    await updateDoc(ref, patch);
    await tentarFinalizarDesafio(ref);
  }

  async function contestarDesafio(d: Desafio) {
    const ref = doc(db, "desafios_ginasio", d.id);
    await updateDoc(ref, {
      status: "conflito",
      atualizadoPorAdminUid: auth.currentUser?.uid || null,
      atualizadoPorAdminEm: Date.now(),
    });
    await addDoc(collection(db, "alertas_conflito"), {
      desafio_id: d.id,
      ginasio_id: d.ginasio_id,
      lider_uid: d.lider_uid,
      desafiante_uid: d.desafiante_uid,
      createdAt: Date.now(),
      marcadoPorAdminUid: auth.currentUser?.uid || null,
    });
    await clearDesafioChat(d.id);
  }

  // ações: renúncia
  async function confirmarRenuncia(r: Renuncia) {
    const renRef = doc(db, "renuncias_ginasio", r.id);

    // encerra liderança atual
    await endActiveLeadership(r.ginasio_id);

    // limpa disputas abertas
    await closeAndPurgeActiveDisputes(r.ginasio_id);

    // info do ginásio
    const gRef = doc(db, "ginasios", r.ginasio_id);
    const gSnap = await getDoc(gRef);
    const gData = gSnap.exists() ? (gSnap.data() as any) : null;

    // abre disputa por renúncia (vazia/limpa)
    await addDoc(collection(db, "disputas_ginasio"), {
      ginasio_id: r.ginasio_id,
      status: "inscricoes",
      tipo_original: gData?.tipo || "",
      lider_anterior_uid: gData?.lider_uid || r.lider_uid || "",
      temporada_id: temporada?.id || "",
      temporada_nome: temporada?.nome || "",
      liga: gData?.liga || r.liga || "",
      createdAt: Date.now(),
      origem: "renuncia",
    });

    // zera liderança
    await updateDoc(gRef, {
      lider_uid: "",
      em_disputa: true,
      derrotas_seguidas: 0,
    });

    // fecha renúncia
    await updateDoc(renRef, {
      status: "confirmado",
      confirmadoPorAdminUid: auth.currentUser?.uid || null,
      confirmadoPorAdminEm: Date.now(),
    });
  }

  async function cancelarRenuncia(r: Renuncia) {
    await updateDoc(doc(db, "renuncias_ginasio", r.id), {
      status: "cancelado",
      canceladoPorAdminUid: auth.currentUser?.uid || null,
      canceladoPorAdminEm: Date.now(),
    });
  }

  // finalização do DESAFIO (badge/3 derrotas → abre disputa limpa)
  async function tentarFinalizarDesafio(ref: any) {
    const dSnap = await getDoc(ref);
    if (!dSnap.exists()) return;
    const d = dSnap.data() as any;

    const rl = d.resultado_lider;
    const rd = d.resultado_desafiante;
    if (!rl || !rd) return;

    const gRef = doc(db, "ginasios", d.ginasio_id);
    const gSnap = await getDoc(gRef);
    const gData = gSnap.exists() ? (gSnap.data() as any) : null;

    if (rl === rd) {
      if (rl === "desafiante") {
        await addDoc(collection(db, "insignias"), {
          usuario_uid: d.desafiante_uid,
          ginasio_id: d.ginasio_id,
          ginasio_nome: gData?.nome || "",
          ginasio_tipo: gData?.tipo || "",
          insignia_icon: gData?.insignia_icon || "",
          temporada_id: temporada?.id || "",
          temporada_nome: temporada?.nome || "",
          liga: gData?.liga || d.liga || "",
          createdAt: Date.now(),
          concedidaPorAdminUid: auth.currentUser?.uid || null,
          lider_derrotado_uid: d.lider_uid,
        });

        await addDoc(collection(db, "bloqueios_ginasio"), {
          ginasio_id: d.ginasio_id,
          desafiante_uid: d.desafiante_uid,
          proximo_desafio: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        if (gSnap.exists()) {
          const derrotas = Number(gData?.derrotas_seguidas ?? 0) + 1;
          if (derrotas >= 3) {
            // encerra liderança e limpa disputas abertas
            await endActiveLeadership(d.ginasio_id);
            await closeAndPurgeActiveDisputes(d.ginasio_id);

            await addDoc(collection(db, "disputas_ginasio"), {
              ginasio_id: d.ginasio_id,
              status: "inscricoes",
              tipo_original: gData?.tipo || "",
              lider_anterior_uid: gData?.lider_uid || "",
              temporada_id: temporada?.id || "",
              temporada_nome: temporada?.nome || "",
              liga: gData?.liga || d.liga || "",
              createdAt: Date.now(),
              origem: "3_derrotas",
            });
            await updateDoc(gRef, {
              lider_uid: "",
              em_disputa: true,
              derrotas_seguidas: 0,
            });
          } else {
            await updateDoc(gRef, { derrotas_seguidas: derrotas });
          }
        }
      } else {
        await updateDoc(gRef, { derrotas_seguidas: 0 });
        await addDoc(collection(db, "bloqueios_ginasio"), {
          ginasio_id: d.ginasio_id,
          desafiante_uid: d.desafiante_uid,
          proximo_desafio: Date.now() + 15 * 24 * 60 * 60 * 1000,
        });
      }

      await updateDoc(ref, { status: "concluido" });
      await clearDesafioChat(ref.id);
    } else {
      await updateDoc(ref, { status: "conflito" });
      await addDoc(collection(db, "alertas_conflito"), {
        desafio_id: ref.id,
        ginasio_id: d.ginasio_id,
        lider_uid: d.lider_uid,
        desafiante_uid: d.desafiante_uid,
        createdAt: Date.now(),
      });
      await clearDesafioChat(ref.id);
    }
  }

  async function clearDesafioChat(desafioId: string) {
    const snap = await getDocs(collection(db, "desafios_ginasio", desafioId, "mensagens"));
    await Promise.all(
      snap.docs.map((m) =>
        deleteDoc(doc(db, "desafios_ginasio", desafioId, "mensagens", m.id))
      )
    );
  }

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dev / Disputas & Desafios (declarações pendentes)</h1>
          <p className="text-sm text-gray-500">
            Resultados pendentes de disputa (liga), desafios (jogador × líder) com um lado declarado e renúncias de liderança.
          </p>
        </div>
        <button onClick={() => router.push("/dev")} className="text-sm text-blue-600 underline">
          Voltar ao painel
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 rounded shadow grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Liga</label>
          <select
            value={ligaFiltro}
            onChange={(e) => setLigaFiltro(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-full"
          >
            <option value="">Todas</option>
            {ligasDisponiveis.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <input
            value={textoBusca}
            onChange={(e) => setTextoBusca(e.target.value)}
            placeholder="Buscar por ginásio ou jogadores"
            className="border rounded px-2 py-1 text-sm w-full"
          />
        </div>
      </div>

      {/* A: Resultados de disputa */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Disputas de liga — declarações pendentes</h2>
        {resultadosFiltrados.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma declaração pendente de disputas.</p>
        ) : (
          resultadosFiltrados.map((r) => {
            const gym = gMap[r.ginasio_id];
            const liga = gym?.liga || "Sem liga";
            const gymName = gym?.nome || r.ginasio_id;

            const created = r.createdAtMs ? tempoRelativo(r.createdAtMs) : "indeterminado";
            const dias = r.createdAtMs ? Math.floor((Date.now() - r.createdAtMs) / 86400000) : null;
            const velho = dias !== null && dias >= 7;

            const aUid = r.tipo === "empate" ? r.jogador1_uid! : r.vencedor_uid!;
            const bUid = r.tipo === "empate" ? r.jogador2_uid! : r.perdedor_uid!;
            const aName = uMap[aUid]?.display || aUid;
            const bName = uMap[bUid]?.display || bUid;

            return (
              <div key={r.id} className="bg-white rounded shadow p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-semibold">
                    {r.tipo === "empate" ? (
                      <>Empate declarado por {uMap[r.declarado_por]?.display || r.declarado_por}</>
                    ) : (
                      <>
                        Vitória de <span className="text-green-700">{aName}</span> sobre{" "}
                        <span className="text-red-700">{bName}</span>{" "}
                        <span className="text-xs text-gray-500">
                          (declarado por {uMap[r.declarado_por]?.display || r.declarado_por})
                        </span>
                      </>
                    )}
                  </p>
                  {r.tipo === "empate" && (
                    <p className="text-sm text-gray-700">Jogadores: {aName} vs {bName}</p>
                  )}
                  <p className="text-sm text-gray-700">
                    Ginásio: <span className="font-medium">{gymName}</span>{" "}
                    <span className="text-gray-500">· Liga: {liga}</span>
                  </p>
                  <p className="text-xs text-gray-600">
                    Criado há {created} {velho && <span className="text-red-600">(7+ dias)</span>}
                  </p>
                  <p className="text-[10px] text-gray-400">ID resultado: {r.id}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => confirmarResultadoLiga(r)}
                    className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
                    title="Confirmar em nome do outro jogador"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => contestarResultadoLiga(r)}
                    className="px-3 py-1 rounded bg-red-600 text-white text-sm"
                    title="Marcar como contestado"
                  >
                    Contestar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* B: Desafios um lado declarou */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Desafios — um lado declarou</h2>
        {desafiosFiltrados.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum desafio com 1 só declaração.</p>
        ) : (
          desafiosFiltrados.map((d) => {
            const gym = gMap[d.ginasio_id];
            const liga = gym?.liga || d.liga || "Sem liga";
            const gymName = gym?.nome || d.ginasio_id;

            const created = d.createdAtMs ? tempoRelativo(d.createdAtMs) : "indeterminado";
            const dias = d.createdAtMs ? Math.floor((Date.now() - d.createdAtMs) / 86400000) : null;
            const velho = dias !== null && dias >= 7;

            const desafiante = uMap[d.desafiante_uid]?.display || d.desafiante_uid;
            const lider = uMap[d.lider_uid]?.display || d.lider_uid;

            const quemDeclarou =
              d.resultado_lider ? "Líder" : d.resultado_desafiante ? "Desafiante" : "—";
            const valorDeclarado = d.resultado_lider || d.resultado_desafiante || "—";

            return (
              <div key={d.id} className="bg-white rounded shadow p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-semibold">
                    {desafiante} vs {lider} — <span className="text-gray-700">{gymName}</span>{" "}
                    <span className="text-gray-500">· Liga: {liga}</span>
                  </p>
                  <p className="text-sm text-gray-700">
                    Declarado por: <span className="font-medium">{quemDeclarou}</span>{" "}
                    (<span className="italic">{valorDeclarado}</span>)
                  </p>
                  <p className="text-xs text-gray-600">
                    Criado há {created} {velho && <span className="text-red-600">(7+ dias)</span>}
                  </p>
                  <p className="text:[10px] text-gray-400">ID desafio: {d.id}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => confirmarDesafio(d)}
                    className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
                    title="Confirmar em nome do outro lado e finalizar"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => contestarDesafio(d)}
                    className="px-3 py-1 rounded bg-red-600 text-white text-sm"
                    title="Marcar como conflito"
                  >
                    Contestar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* C: Renúncias pendentes */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Renúncias de liderança — pendentes</h2>
        {renunciasFiltradas.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma renúncia pendente.</p>
        ) : (
          renunciasFiltradas.map((r) => {
            const gym = gMap[r.ginasio_id];
            const gymName = gym?.nome || r.ginasio_id;
            const liga = gym?.liga || r.liga || "Sem liga";
            const lider = uMap[r.lider_uid]?.display || r.lider_uid;
            const criado = r.createdAtMs ? tempoRelativo(r.createdAtMs) : "indeterminado";

            return (
              <div key={r.id} className="bg-white rounded shadow p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-semibold">
                    {lider} solicitou renúncia em <span className="text-gray-700">{gymName}</span>{" "}
                    <span className="text-gray-500">· Liga: {liga}</span>
                  </p>
                  {r.motivo && <p className="text-sm text-gray-700">Motivo: {r.motivo}</p>}
                  <p className="text-xs text-gray-600">Criado há {criado}</p>
                  <p className="text-[10px] text-gray-400">ID renúncia: {r.id}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => confirmarRenuncia(r)}
                    className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
                    title="Confirmar renúncia, abrir disputa e limpar liderança"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => cancelarRenuncia(r)}
                    className="px-3 py-1 rounded bg-red-600 text-white text-sm"
                    title="Cancelar a renúncia"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
