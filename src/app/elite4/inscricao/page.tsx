"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  setDoc,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

type Liga = { id: string; nome: string };

type Ginasio = {
  id: string;
  nome: string;
  liga?: string;
  lider_uid?: string;
  tipo?: string; // tipo do ginásio (Fogo, Água, etc.)
};

type Campeonato = {
  id: string;
  liga: string;
  status: "aberto" | "fechado";
  createdAt: number;
};

type Participacao = {
  id: string;
  campeonato_id: string;
  usuario_uid: string;
  ginasio_id: string;
  pontos: number;
  createdAt: number;
  ginasio_nome: string; // "Nome - Tipo"
};

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "seconds" in v) {
    const s = v.seconds ?? 0;
    const ns = v.nanoseconds ?? 0;
    return s * 1000 + Math.floor(ns / 1e6);
  }
  return Number(v) || 0;
}

export default function Elite4InscricaoPage() {
  const router = useRouter();

  const [uid, setUid] = useState<string | null>(null);
  const [, setLigas] = useState<Liga[]>([]);
  const [meusGinasios, setMeusGinasios] = useState<Ginasio[]>([]);
  const [abertosPorLiga, setAbertosPorLiga] = useState<
    Record<string, Campeonato | null>
  >({});
  const [minhasInscricoes, setMinhasInscricoes] = useState<Participacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

  // Auth
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        router.replace("/login");
        return;
      }
      setUid(current.uid);
    });
    return () => unsub();
  }, [router]);

  // Ligas (catálogo)
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const ls: Liga[] = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as any).nome || d.id,
      }));
      setLigas(ls);
    })();
  }, []);

  // Meus ginásios (onde sou líder)
  useEffect(() => {
    if (!uid) return;
    const qG = query(collection(db, "ginasios"), where("lider_uid", "==", uid));
    const unsub = onSnapshot(qG, (snap) => {
      const list: Ginasio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome || d.id,
          liga: data.liga || "",
          lider_uid: data.lider_uid || "",
          tipo: data.tipo || "",
        };
      });
      setMeusGinasios(list);
    });
    return () => unsub();
  }, [uid]);

  // Campeonatos ABERTOS por liga dos meus ginásios
  useEffect(() => {
    if (meusGinasios.length === 0) {
      setAbertosPorLiga({});
      return;
    }
    let cancel = false;
    (async () => {
      const ligasSet = Array.from(
        new Set(meusGinasios.map((g) => g.liga || "").filter(Boolean))
      );
      const out: Record<string, Campeonato | null> = {};
      // busca 1 por liga (o mais recente aberto)
      for (const ln of ligasSet) {
        const qC = query(
          collection(db, "campeonatos_elite4"),
          where("liga", "==", ln),
          where("status", "==", "aberto"),
          orderBy("createdAt", "desc")
        );
        const snap = await getDocs(qC);
        if (!snap.empty) {
          const c = snap.docs[0];
          const d = c.data() as any;
          out[ln] = {
            id: c.id,
            liga: d.liga,
            status: d.status,
            createdAt: toMillis(d.createdAt),
          };
        } else {
          out[ln] = null;
        }
      }
      if (!cancel) setAbertosPorLiga(out);
    })();
    return () => {
      cancel = true;
    };
  }, [meusGinasios]);

  // Minhas inscrições ativas (em campeonatos abertos)
  useEffect(() => {
    if (!uid) return;
    const qP = query(collectionGroup(db, "participantes"), where("usuario_uid", "==", uid));
    const unsub = onSnapshot(qP, async (snap) => {
      const campeonatosCache = new Map<string, any>();
      const ginasiosCache = new Map<string, string>();

      const items = await Promise.all(
        snap.docs.map(async (d) => {
          const x = d.data() as any;

          // campId do campo ou do pai
          const campId: string | undefined = x.campeonato_id || d.ref.parent.parent?.id;
          if (!campId) return null;

          // campeonato em cache
          let cData = campeonatosCache.get(campId);
          if (!cData) {
            const cDoc = await getDoc(doc(db, "campeonatos_elite4", campId));
            if (!cDoc.exists()) return null;
            cData = cDoc.data();
            campeonatosCache.set(campId, cData);
          }
          if (cData.status !== "aberto") return null;

          // ginasio_id válido
          const gId = String(x.ginasio_id || "");
          if (!gId) return null;

          // resolver nome do ginásio garantindo string
          const cached = ginasiosCache.get(gId);
          let gName: string;
          if (cached) {
            gName = cached;
          } else {
            const gDoc = await getDoc(doc(db, "ginasios", gId));
            if (gDoc.exists()) {
              const gd = gDoc.data() as any;
              const nome = gd.nome || gId;
              const tipo = gd.tipo as string | undefined;
              gName = tipo ? `${nome} - ${tipo}` : nome;
            } else {
              gName = gId;
            }
            ginasiosCache.set(gId, gName);
          }

          return {
            id: d.id, // aqui será = uid
            campeonato_id: campId,
            usuario_uid: x.usuario_uid,
            ginasio_id: gId,
            pontos: x.pontos ?? 0,
            createdAt: x.createdAt ? toMillis(x.createdAt) : 0,
            ginasio_nome: gName, // agora é sempre string
          } as Participacao;
        })
      );

      setMinhasInscricoes(items.filter(Boolean) as Participacao[]);
      setLoading(false);
    });
    return () => unsub();
  }, [uid]);

  // Mapas auxiliares – inscrição por liga
  const inscricaoPorLiga = useMemo(() => {
    const map: Record<string, Participacao | undefined> = {};
    for (const p of minhasInscricoes) {
      const ligaMatch = Object.entries(abertosPorLiga).find(
        ([, c]) => c?.id === p.campeonato_id
      );
      if (ligaMatch) map[ligaMatch[0]] = p;
    }
    return map;
  }, [minhasInscricoes, abertosPorLiga]);

  async function inscrever(g: Ginasio) {
    if (!uid) return;
    setMsg("");
    const liga = g.liga || "";
    const camp = abertosPorLiga[liga];
    if (!camp) {
      setMsg(`Não há campeonato aberto na liga ${liga}.`);
      return;
    }

    // doc único por usuário: campeonatos_elite4/{campId}/participantes/{uid}
    const partRef = doc(db, "campeonatos_elite4", camp.id, "participantes", uid);
    const partSnap = await getDoc(partRef);
    if (partSnap.exists()) {
      setMsg("Você já está inscrito neste campeonato.");
      return;
    }

    await setDoc(partRef, {
      campeonato_id: camp.id,        // mantém campo para buscas
      usuario_uid: uid,
      ginasio_id: g.id,
      liga,                          // grave a liga para passar nas regras de update
      pontos: 0,
      createdAt: Date.now(),
    });

    setMsg(
      `Inscrição feita na liga ${liga} usando o ginásio "${g.nome}${g.tipo ? ` - ${g.tipo}` : ""}".`
    );
  }

  async function trocarGinasio(ligaNome: string, novo: Ginasio) {
    if (!uid) return;
    const atual = inscricaoPorLiga[ligaNome];
    if (!atual) return;
    if (atual.ginasio_id === novo.id) return;

    const nomeAtual = atual.ginasio_nome || atual.ginasio_id;
    const nomeNovo = `${novo.nome}${novo.tipo ? ` - ${novo.tipo}` : ""}`;

    const ok = window.confirm(
      `Confirmar troca do ginásio representado na liga ${ligaNome}?\n\n` +
      `Atual: ${nomeAtual}\n` +
      `Novo: ${nomeNovo}\n\n` +
      `Se confirmar, seus pontos neste campeonato serão zerados.`
    );
    if (!ok) return;

    setMsg("");

    const ref = doc(db, "campeonatos_elite4", atual.campeonato_id, "participantes", uid);
    await updateDoc(ref, {
      ginasio_id: novo.id,
      pontos: 0,
    });

    setMsg(
      `Atualizado: agora você representa o ginásio "${nomeNovo}" na liga ${ligaNome}. Pontos deste campeonato foram zerados.`
    );
  }

  if (!uid || loading) return <p className="p-6">Carregando…</p>;

  // Agrupa meus ginásios por liga
  const gByLiga = meusGinasios.reduce<Record<string, Ginasio[]>>((acc, g) => {
    const ln = g.liga || "Sem liga";
    if (!acc[ln]) acc[ln] = [];
    acc[ln].push(g);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Campeonato Elite 4 — Inscrição do Líder
          </h1>
          <p className="text-sm text-gray-500">
            Inscreva-se no campeonato aberto da sua liga. 1 inscrição por liga.
          </p>
        </div>
      </div>

      {msg && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm">
          {msg}
        </div>
      )}

      {Object.keys(gByLiga).length === 0 ? (
        <div className="p-4 bg-white rounded shadow">
          <p className="text-sm text-gray-600">
            Você não lidera nenhum ginásio no momento.
          </p>
        </div>
      ) : (
        Object.entries(gByLiga).map(([ligaNome, gs]) => {
          const camp = abertosPorLiga[ligaNome];
          const inscricao = inscricaoPorLiga[ligaNome];
          return (
            <div
              key={ligaNome}
              className="bg-white p-4 rounded shadow space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{ligaNome}</h2>
                  <p className="text-xs text-gray-500">
                    Campeonato: {camp ? "ABERTO" : "— sem campeonato aberto —"}
                  </p>
                </div>
                {camp && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                    {camp.createdAt
                      ? new Date(camp.createdAt).toLocaleString()
                      : "—"}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {gs.map((g) => {
                  const jaInscritoNesteCamp = Boolean(inscricao);
                  const representandoEste = inscricao?.ginasio_id === g.id;
                  return (
                    <div
                      key={g.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border rounded px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {g.nome}
                          {g.tipo ? ` - ${g.tipo}` : ""}
                        </p>
                        <p className="text-xs text-gray-500">ID: {g.id}</p>
                      </div>

                      {!camp ? (
                        <span className="text-xs text-gray-500">
                          Aguardando abertura do campeonato…
                        </span>
                      ) : jaInscritoNesteCamp ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {representandoEste ? (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                              Você está inscrito representando este ginásio
                            </span>
                          ) : (
                            <button
                              onClick={() => trocarGinasio(ligaNome, g)}
                              className="text-xs px-2 py-1 rounded bg-slate-200 hover:bg-slate-300"
                            >
                              Trocar para este ginásio
                            </button>
                          )}
                          <a
                            className="text-xs text-blue-600 underline"
                            href={`/elite4/placar?liga=${encodeURIComponent(
                              ligaNome
                            )}`}
                          >
                            Ver placar
                          </a>
                        </div>
                      ) : (
                        <button
                          onClick={() => inscrever(g)}
                          className="text-sm px-3 py-2 rounded bg-purple-600 text-white hover:bg-purple-700"
                        >
                          Inscrever-me por este ginásio
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {minhasInscricoes.length > 0 && (
        <div className="bg-white p-4 rounded shadow">
          <h3 className="text-lg font-semibold mb-2">
            Minhas inscrições ativas
          </h3>
          <ul className="space-y-2">
            {minhasInscricoes.map((p) => (
              <li
                key={p.id}
                className="text-sm bg-gray-50 border rounded px-3 py-2"
              >
                Campeonato: {p.campeonato_id} · Ginásio: {p.ginasio_nome} ·
                Pontos: {p.pontos ?? 0}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
